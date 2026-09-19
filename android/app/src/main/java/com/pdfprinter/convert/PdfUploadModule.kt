package com.pdfprinter.convert

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Uploads a Word document to the conversion service and writes the PDF it returns to a file.
 *
 * This exists because the JavaScript HTTP client could not do it reliably. With a response
 * destination configured, react-native-blob-util decides the download finished by comparing the
 * bytes it counted against the response's Content-Length, reading through a stream that wraps the
 * body in a fresh InputStream on every read. On a real device against a real server that check
 * reported "Download interrupted." every single time, while the server logged a completed
 * conversion and a 200 - a body of 33 KB that had plainly arrived in full. Every alternative
 * explanation was eliminated first: the same document at the same non-ASCII filename converts
 * correctly, so do a 167-page one and a 9.7 MB image-heavy one, the response is not compressed,
 * the destination directory is created by the library itself, and the read timeout is disabled for
 * file downloads, so nothing here was timing out.
 *
 * Rather than keep guessing at that check, this does the exchange directly. It is deliberately
 * plain: HttpURLConnection, a hand-built multipart body, the response streamed to disk. There is
 * precedent for exactly this in the project - [com.pdfprinter.printers.ipp.IppHttpClient] streams a
 * file to a printer the same way - and no new dependency is introduced.
 *
 * It also reports what actually happened, which the JavaScript layer needs: the HTTP status, the
 * response's content type, and the server's own error body when there is one, so a failure can be
 * described rather than guessed at.
 */
class PdfUploadModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    /** The in-flight connection, so it can be aborted. Only ever one; the conversion modal blocks. */
    @Volatile
    private var active: HttpURLConnection? = null

    /**
     * Set by [cancel] and read by the worker when deciding how to report a failure. The exception
     * an aborted connection throws says nothing about why it was aborted, so the reason is kept
     * here rather than inferred from the error.
     */
    @Volatile
    private var cancelled = false

    override fun getName(): String = NAME

    /**
     * Sends `sourcePath` to `url` as a single multipart part named `file`, and writes the response
     * body to `destinationPath` when the server answers with a success.
     *
     * Resolves with the exchange's outcome - including for a rejection by the server, which is a
     * result rather than a failure of this call - and rejects only when the request itself could
     * not be completed.
     */
    @ReactMethod
    fun upload(
        url: String,
        sourcePath: String,
        fileName: String,
        destinationPath: String,
        promise: Promise,
    ) {
        val source = File(sourcePath)
        if (!source.isFile) {
            promise.reject(
                ERROR_SOURCE_MISSING,
                "The document could not be read. It may have been moved or deleted.",
            )
            return
        }

        val destination = File(destinationPath)
        // The parent is the conversion cache directory, which may not exist on a first run.
        destination.parentFile?.mkdirs()
        cancelled = false

        // Off the JS thread: this is a network round trip that can take a minute, and a conversion
        // is allowed to take that long.
        Thread {
            try {
                promise.resolve(exchange(url, source, fileName, destination))
            } catch (error: Exception) {
                if (cancelled) {
                    promise.reject(ERROR_CANCELLED, "The upload was cancelled.")
                } else {
                    promise.reject(
                        ERROR_REQUEST_FAILED,
                        error.message ?: "The request to the conversion server failed.",
                        error,
                    )
                }
            } finally {
                active = null
            }
        }.start()
    }

    /** Aborts the in-flight upload, if any. Safe to call when nothing is running. */
    @ReactMethod
    fun cancel(promise: Promise) {
        cancelled = true
        val connection = active
        active = null
        connection?.disconnect()
        promise.resolve(null)
    }

    private fun exchange(
        url: String,
        source: File,
        fileName: String,
        destination: File,
    ): WritableMap {
        val boundary = "----PdfPrinterBoundary${UUID.randomUUID().toString().replace("-", "")}"

        // Built by hand rather than with a multipart library, because there is one part and its
        // three header lines are the whole of the format. Written as UTF-8 bytes: filenames here
        // routinely carry non-ASCII characters, and the server picks its import filter from this
        // name, so mangling it would misread the document.
        val prefix = buildString {
            append("--").append(boundary).append(CRLF)
            append("Content-Disposition: form-data; name=\"file\"; filename=\"")
            append(headerSafeFileName(fileName))
            append("\"").append(CRLF)
            append("Content-Type: application/octet-stream").append(CRLF)
            append(CRLF)
        }.toByteArray(Charsets.UTF_8)
        val suffix = "$CRLF--$boundary--$CRLF".toByteArray(Charsets.UTF_8)

        var connection: HttpURLConnection? = null
        try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = CONNECT_TIMEOUT_MS
                // Zero, meaning no limit. The server gives up after 90 seconds and this side owns a
                // longer deadline of its own; a read timeout here would only ever fire first and
                // replace a good server message with a bare socket error.
                readTimeout = 0
                setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                setRequestProperty("Accept", "application/pdf, application/json")
                // Declared up front so the request is not buffered in memory before being sent -
                // a 25 MB document would otherwise be held twice.
                setFixedLengthStreamingMode(prefix.size.toLong() + source.length() + suffix.size)
            }

            active = connection
            val live = connection

            live.outputStream.use { output ->
                output.write(prefix)
                source.inputStream().use { input -> input.copyTo(output, COPY_BUFFER_SIZE) }
                output.write(suffix)
                output.flush()
            }

            val status = live.responseCode
            val result = Arguments.createMap()
            result.putInt("status", status)
            result.putString("contentType", live.getHeaderField("Content-Type"))

            if (status in 200..299) {
                live.inputStream.use { input ->
                    destination.outputStream().use { output ->
                        input.copyTo(output, COPY_BUFFER_SIZE)
                    }
                }
                result.putBoolean("written", true)
            } else {
                // Read into the result rather than thrown: the server's message is written for a
                // person to read and is shown to them as-is.
                result.putString("errorBody", readErrorBody(live))
                result.putBoolean("written", false)
            }
            return result
        } finally {
            connection?.disconnect()
        }
    }

    /**
     * The server's error body, or null when there is not one.
     *
     * Capped, because this is only ever a short JSON envelope and an error page from a proxy in
     * front of the server could be arbitrarily long. `inputStream` is a second attempt only for the
     * case where a server sent a body without a matching error stream; on a rejection it throws
     * instead, which is not worth surfacing over the status that already explains the failure.
     */
    private fun readErrorBody(connection: HttpURLConnection): String? {
        val stream =
            connection.errorStream
                ?: try {
                    connection.inputStream
                } catch (error: IOException) {
                    return null
                }
        return stream.use { input ->
            val buffer = ByteArray(MAX_ERROR_BODY_BYTES)
            val read = input.read(buffer)
            if (read > 0) String(buffer, 0, read, Charsets.UTF_8) else null
        }
    }

    /**
     * A filename that cannot break out of the header line it is written into.
     *
     * Every character here would otherwise end the quoted string, start a new header, or split the
     * header from the body. The name is the document's own, so it is attacker-adjacent rather than
     * trusted. Non-ASCII is deliberately left alone - it is written as UTF-8, which is what the
     * multipart format specifies and what the server reads.
     */
    private fun headerSafeFileName(name: String): String =
        name.replace("\r", " ")
            .replace("\n", " ")
            .replace("\\", "_")
            .replace("\"", "_")
            .ifEmpty { FALLBACK_FILE_NAME }

    companion object {
        const val NAME = "PdfUpload"

        private const val CRLF = "\r\n"
        private const val CONNECT_TIMEOUT_MS = 30_000
        private const val COPY_BUFFER_SIZE = 64 * 1024
        private const val MAX_ERROR_BODY_BYTES = 8 * 1024
        private const val FALLBACK_FILE_NAME = "document.docx"

        /** The source file is not there or is not a file. */
        const val ERROR_SOURCE_MISSING = "E_UPLOAD_SOURCE_MISSING"

        /** The upload was aborted, either by the user or by this side's deadline. */
        const val ERROR_CANCELLED = "E_UPLOAD_CANCELLED"

        /** The request could not be completed: no connection, DNS, TLS, or a broken exchange. */
        const val ERROR_REQUEST_FAILED = "E_UPLOAD_REQUEST_FAILED"
    }
}
