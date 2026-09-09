package com.pdfprinter.printers

import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.pdfprinter.pdf.PdfWorkExecutors
import com.pdfprinter.printers.ipp.IppCancellationRegistry
import com.pdfprinter.printers.ipp.IppEncoder
import com.pdfprinter.printers.ipp.IppHttpClient
import com.pdfprinter.printers.ipp.IppPrintException
import com.pdfprinter.printers.ipp.IppPrintJobRequest
import java.io.File
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class IppPrintModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * Submits a print job directly to a printer's IPP endpoint over plain HTTP via
     * [IppHttpClient], bypassing android.print.PrintManager entirely. This is a new, additive
     * path only - it never touches PrintModule/PdfPrintDocumentAdapter, so the existing
     * PrintManager-based flow keeps working exactly as it does today.
     */
    @ReactMethod
    fun submitPrintJob(
        host: String,
        port: Double,
        resourcePath: String,
        filePath: String,
        jobName: String,
        requestToken: String,
        copies: Double?,
        sides: String?,
        orientationRequested: Double?,
        printColorMode: String?,
        promise: Promise,
    ) {
        PdfWorkExecutors.io.execute {
            val file = resolveFile(filePath)
            if (!file.exists()) {
                promise.reject("E_FILE_NOT_FOUND", "No file at ${file.absolutePath}")
                return@execute
            }

            try {
                val response =
                    IppHttpClient.submitPrintJob(
                        IppPrintJobRequest(
                            host = host,
                            port = port.toInt(),
                            resourcePath = resourcePath,
                            documentFile = file,
                            jobName = jobName,
                            requestToken = requestToken,
                            copies = copies?.toInt(),
                            sides = sides,
                            orientationRequested = orientationRequested?.toInt(),
                            printColorMode = printColorMode,
                        ),
                    )

                if (!response.isSuccessful) {
                    val statusHex = response.statusCode.toString(16)
                    promise.reject(
                        "E_IPP_REJECTED",
                        response.statusMessage ?: "Printer rejected the job (status 0x$statusHex)",
                    )
                    return@execute
                }

                val result = Arguments.createMap()
                result.putBoolean("success", true)
                result.putInt("statusCode", response.statusCode)
                result.putString("statusMessage", response.statusMessage)
                if (response.jobId != null) {
                    result.putInt("jobId", response.jobId)
                } else {
                    result.putNull("jobId")
                }
                promise.resolve(result)
            } catch (error: IppPrintException) {
                // IppHttpClient wraps the network-level exceptions below into IppPrintException
                // (preserving the original as `cause`) so callers only have to catch one type,
                // but the specific cause still lets us surface a more precise error code than a
                // blanket "rejected" to JS.
                if (error.cancelled) {
                    promise.reject("E_CANCELLED", error.message, error)
                    return@execute
                }
                when (error.cause) {
                    is UnknownHostException, is ConnectException ->
                        promise.reject("E_PRINTER_UNREACHABLE", error.message, error)
                    is SocketTimeoutException -> promise.reject("E_PRINTER_TIMEOUT", error.message, error)
                    else -> promise.reject("E_IPP_REJECTED", error.message, error)
                }
            } catch (error: UnknownHostException) {
                promise.reject("E_PRINTER_UNREACHABLE", error.message, error)
            } catch (error: ConnectException) {
                promise.reject("E_PRINTER_UNREACHABLE", error.message, error)
            } catch (error: SocketTimeoutException) {
                promise.reject("E_PRINTER_TIMEOUT", error.message, error)
            } catch (error: Exception) {
                promise.reject("E_IPP_SUBMIT_FAILED", error.message, error)
            }
        }
    }

    /**
     * Cancels a submitPrintJob call that is still uploading/waiting on a response, identified by
     * the same requestToken passed into that call. Resolves immediately either way; `cancelled`
     * tells the caller whether a matching in-flight connection was actually found and torn down
     * (it may already have finished, successfully or not, by the time this arrives).
     */
    @ReactMethod
    fun cancelSubmit(requestToken: String, promise: Promise) {
        val cancelled = IppCancellationRegistry.cancel(requestToken)
        val result = Arguments.createMap()
        result.putBoolean("cancelled", cancelled)
        promise.resolve(result)
    }

    /**
     * Sends IPP Cancel-Job (RFC 8011 section 4.3.3) for a job the printer has already accepted -
     * complementary to [cancelSubmit], which only helps while the job is still being uploaded.
     */
    @ReactMethod
    fun cancelPrintJob(
        host: String,
        port: Double,
        resourcePath: String,
        jobId: Double,
        requestingUserName: String,
        promise: Promise,
    ) {
        PdfWorkExecutors.io.execute {
            try {
                val printerUri = IppHttpClient.buildPrinterUri(host, port.toInt(), resourcePath)
                val requestBytes =
                    IppEncoder.buildCancelJobRequest(
                        printerUri = printerUri,
                        jobId = jobId.toInt(),
                        requestingUserName = requestingUserName,
                    )
                val response = IppHttpClient.cancelJob(host, port.toInt(), resourcePath, requestBytes)

                if (!response.isSuccessful) {
                    val statusHex = response.statusCode.toString(16)
                    promise.reject(
                        "E_CANCEL_FAILED",
                        response.statusMessage ?: "Printer rejected the cancel request (status 0x$statusHex)",
                    )
                    return@execute
                }

                val result = Arguments.createMap()
                result.putBoolean("success", true)
                result.putInt("statusCode", response.statusCode)
                result.putString("statusMessage", response.statusMessage)
                promise.resolve(result)
            } catch (error: IppPrintException) {
                when (error.cause) {
                    is UnknownHostException, is ConnectException ->
                        promise.reject("E_PRINTER_UNREACHABLE", error.message, error)
                    is SocketTimeoutException -> promise.reject("E_PRINTER_TIMEOUT", error.message, error)
                    else -> promise.reject("E_CANCEL_FAILED", error.message, error)
                }
            } catch (error: UnknownHostException) {
                promise.reject("E_PRINTER_UNREACHABLE", error.message, error)
            } catch (error: ConnectException) {
                promise.reject("E_PRINTER_UNREACHABLE", error.message, error)
            } catch (error: SocketTimeoutException) {
                promise.reject("E_PRINTER_TIMEOUT", error.message, error)
            } catch (error: Exception) {
                promise.reject("E_CANCEL_FAILED", error.message, error)
            }
        }
    }

    /**
     * Polls the printer for a job's current state (RFC 8011 section 5.3.7) so the UI can tell a
     * job that has actually finished printing apart from one that's merely been accepted and may
     * still be queued or in progress - Print-Job's own response only confirms acceptance.
     */
    @ReactMethod
    fun getJobStatus(
        host: String,
        port: Double,
        resourcePath: String,
        jobId: Double,
        requestingUserName: String,
        promise: Promise,
    ) {
        PdfWorkExecutors.io.execute {
            try {
                val printerUri = IppHttpClient.buildPrinterUri(host, port.toInt(), resourcePath)
                val requestBytes =
                    IppEncoder.buildGetJobAttributesRequest(
                        printerUri = printerUri,
                        jobId = jobId.toInt(),
                        requestingUserName = requestingUserName,
                    )
                val response = IppHttpClient.getJobAttributes(host, port.toInt(), resourcePath, requestBytes)

                val result = Arguments.createMap()
                result.putBoolean("success", response.isSuccessful)
                if (response.jobState != null) {
                    result.putInt("jobState", response.jobState)
                } else {
                    result.putNull("jobState")
                }
                result.putString("statusMessage", response.statusMessage)
                promise.resolve(result)
            } catch (error: IppPrintException) {
                when (error.cause) {
                    is UnknownHostException, is ConnectException ->
                        promise.reject("E_PRINTER_UNREACHABLE", error.message, error)
                    is SocketTimeoutException -> promise.reject("E_PRINTER_TIMEOUT", error.message, error)
                    else -> promise.reject("E_JOB_STATUS_FAILED", error.message, error)
                }
            } catch (error: Exception) {
                promise.reject("E_JOB_STATUS_FAILED", error.message, error)
            }
        }
    }

    // file:// URIs are percent-encoded per RFC 3986 (spaces, non-ASCII filenames), but the real
    // path on disk is not - Uri.path decodes it, a plain removePrefix does not.
    private fun resolveFile(filePath: String): File =
        if (filePath.startsWith("file://")) File(Uri.parse(filePath).path!!) else File(filePath)

    companion object {
        const val NAME = "IppPrintModule"
    }
}
