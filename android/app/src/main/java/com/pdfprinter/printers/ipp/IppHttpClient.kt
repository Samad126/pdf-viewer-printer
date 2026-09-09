package com.pdfprinter.printers.ipp

import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException

private const val COPY_BUFFER_SIZE = 8192
private const val CONNECT_TIMEOUT_MS = 8000
private const val READ_TIMEOUT_MS = 30000
private const val IPP_CONTENT_TYPE = "application/ipp"

class IppPrintException(
    message: String,
    val ippStatusCode: Int? = null,
    cause: Throwable? = null,
    val cancelled: Boolean = false,
) : Exception(message, cause)

data class IppPrintJobRequest(
    val host: String,
    val port: Int,
    val resourcePath: String,
    val documentFile: File,
    val jobName: String,
    val requestToken: String,
    val copies: Int? = null,
    val sides: String? = null,
    val orientationRequested: Int? = null,
    val printColorMode: String? = null,
)

/**
 * Speaks IPP directly over plain HTTP using java.net.HttpURLConnection - no OkHttp dependency,
 * no TLS negotiation of any kind. This exists because Android's own print service negotiates
 * encrypted IPP (IPPS) with some printers and then shows an opaque system dialog asking the user
 * to consent to a fallback to an unencrypted job - a dialog this app cannot suppress or
 * customize, since it is generated entirely inside the AOSP print service process. By speaking
 * IPP to the printer directly and never offering encryption in the first place, there is nothing
 * to downgrade and nothing to ask consent about.
 */
object IppHttpClient {

    fun submitPrintJob(request: IppPrintJobRequest): IppResponse {
        val resourcePath = request.resourcePath.trimStart('/')
        val url = URL("http", request.host, request.port, "/$resourcePath")
        val printerUri = buildPrinterUri(request.host, request.port, resourcePath)
        val header =
            IppEncoder.buildPrintJobRequest(
                printerUri = printerUri,
                requestingUserName = "PDFPrinter",
                jobName = request.jobName,
                copies = request.copies,
                sides = request.sides,
                orientationRequested = request.orientationRequested,
                printColorMode = request.printColorMode,
            )

        var connection: HttpURLConnection? = null
        try {
            return runIppExchange(request.host, request.port, request.requestToken) {
                connection =
                    (url.openConnection() as HttpURLConnection).apply {
                        requestMethod = "POST"
                        doOutput = true
                        connectTimeout = CONNECT_TIMEOUT_MS
                        readTimeout = READ_TIMEOUT_MS
                        setRequestProperty("Content-Type", IPP_CONTENT_TYPE)
                        setFixedLengthStreamingMode(header.size.toLong() + request.documentFile.length())
                    }
                val activeConnection = connection!!
                IppCancellationRegistry.register(request.requestToken, activeConnection)

                activeConnection.outputStream.use { output ->
                    output.write(header)
                    FileInputStream(request.documentFile).use { input ->
                        val buffer = ByteArray(COPY_BUFFER_SIZE)
                        while (true) {
                            val bytesRead = input.read(buffer)
                            if (bytesRead < 0) break
                            output.write(buffer, 0, bytesRead)
                        }
                    }
                    output.flush()
                }

                // IPP-level errors frequently come back on top of a "successful" HTTP status -
                // the real status lives in the IPP response body's status-code field, not the
                // HTTP status line - so the body is read and parsed the same way no matter which
                // HTTP status came back.
                activeConnection.responseCode
                val responseBytes =
                    (activeConnection.errorStream ?: activeConnection.inputStream).use { it.readBytes() }
                IppResponseParser.parse(responseBytes)
            }
        } finally {
            IppCancellationRegistry.unregister(request.requestToken)
            IppCancellationRegistry.clearCancelled(request.requestToken)
            connection?.disconnect()
        }
    }

    /** Cancel-Job has no file to stream afterward - see [postDocumentlessRequest]. */
    fun cancelJob(host: String, port: Int, resourcePath: String, requestBytes: ByteArray): IppResponse =
        postDocumentlessRequest(host, port, resourcePath, requestBytes)

    /** Get-Job-Attributes, same shape as Cancel-Job: no document body. */
    fun getJobAttributes(host: String, port: Int, resourcePath: String, requestBytes: ByteArray): IppResponse =
        postDocumentlessRequest(host, port, resourcePath, requestBytes)

    private fun postDocumentlessRequest(
        host: String,
        port: Int,
        resourcePath: String,
        requestBytes: ByteArray,
    ): IppResponse {
        val url = URL("http", host, port, "/${resourcePath.trimStart('/')}")
        var connection: HttpURLConnection? = null
        try {
            return runIppExchange(host, port, requestToken = null) {
                connection =
                    (url.openConnection() as HttpURLConnection).apply {
                        requestMethod = "POST"
                        doOutput = true
                        connectTimeout = CONNECT_TIMEOUT_MS
                        readTimeout = READ_TIMEOUT_MS
                        setRequestProperty("Content-Type", IPP_CONTENT_TYPE)
                        setFixedLengthStreamingMode(requestBytes.size.toLong())
                    }
                val activeConnection = connection!!
                activeConnection.outputStream.use { output ->
                    output.write(requestBytes)
                    output.flush()
                }
                activeConnection.responseCode
                val responseBytes =
                    (activeConnection.errorStream ?: activeConnection.inputStream).use { it.readBytes() }
                IppResponseParser.parse(responseBytes)
            }
        } finally {
            connection?.disconnect()
        }
    }

    fun buildPrinterUri(host: String, port: Int, resourcePath: String): String =
        "ipp://$host:$port/${resourcePath.trimStart('/')}"

    /**
     * Runs [block] and maps the network-level exceptions java.net/HttpURLConnection can throw
     * into a single [IppPrintException] type, so callers only have to catch one thing. When
     * [requestToken] is non-null and [IppCancellationRegistry] shows that token was explicitly
     * cancelled, an IOException surfacing here is reported as [IppPrintException.cancelled]
     * rather than a generic transport failure - see [IppCancellationRegistry]'s doc comment for
     * why that distinction can't be made from the exception type alone.
     */
    private fun <T> runIppExchange(host: String, port: Int, requestToken: String?, block: () -> T): T {
        try {
            return block()
        } catch (error: UnknownHostException) {
            throw IppPrintException("Could not reach printer at $host:$port - unknown host", cause = error)
        } catch (error: ConnectException) {
            throw IppPrintException("Could not reach printer at $host:$port", cause = error)
        } catch (error: SocketTimeoutException) {
            throw IppPrintException("Printer at $host:$port did not respond in time", cause = error)
        } catch (error: IOException) {
            if (requestToken != null && IppCancellationRegistry.wasCancelled(requestToken)) {
                throw IppPrintException("Print job cancelled", cause = error, cancelled = true)
            }
            throw IppPrintException(error.message ?: "Failed to reach $host:$port", cause = error)
        }
    }
}
