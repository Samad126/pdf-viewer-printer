package com.pdfprinter.print

import android.content.Context
import android.net.Uri
import android.print.PrintAttributes
import android.print.PrintManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

class PrintModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * Hands the rebuilt, font-free PDF to Android's PrintManager via our own
     * [PdfPrintDocumentAdapter]. We never delegate to a third-party print library: this adapter is
     * the only thing standing between the file on disk and the print spooler, so we control every
     * byte written to the job.
     *
     * printManager.print() shows the system print UI and returns immediately - it does not wait
     * for the user to finish configuring/confirming the job or for the job to complete, so this
     * promise resolves once the job has been handed off, not once it has finished printing.
     */
    @ReactMethod
    fun printPdf(filePath: String, jobName: String, pageCount: Double, promise: Promise) {
        try {
            val file = resolveFile(filePath)
            if (!file.exists()) {
                promise.reject("E_FILE_NOT_FOUND", "No file at ${file.absolutePath}")
                return
            }

            // PrintManager.print() requires an Activity context - it throws
            // IllegalStateException("Can only print from an activity") if given the application
            // context, since it needs to attach the system print UI to the calling activity.
            val activity = reactContext.currentActivity
            if (activity == null) {
                promise.reject("E_NO_ACTIVITY", "No foreground activity to print from")
                return
            }

            val printManager = activity.getSystemService(Context.PRINT_SERVICE) as? PrintManager
            if (printManager == null) {
                promise.reject("E_NO_PRINT_SERVICE", "PrintManager is unavailable on this device")
                return
            }

            val attributes = PrintAttributes.Builder().setColorMode(PrintAttributes.COLOR_MODE_COLOR).build()
            val declaredPageCount = if (pageCount.isNaN() || pageCount <= 0) -1 else pageCount.toInt()
            val adapter = PdfPrintDocumentAdapter(file, declaredPageCount)
            val printJob = printManager.print(jobName, adapter, attributes)

            val result = Arguments.createMap()
            result.putBoolean("started", printJob != null)
            result.putString("jobId", printJob?.id?.toString())
            promise.resolve(result)
        } catch (error: Exception) {
            promise.reject("E_PRINT_FAILED", error.message, error)
        }
    }

    // file:// URIs are percent-encoded per RFC 3986 (spaces, non-ASCII filenames), but the real
    // path on disk is not - Uri.path decodes it, a plain removePrefix does not.
    private fun resolveFile(filePath: String): File =
        if (filePath.startsWith("file://")) File(Uri.parse(filePath).path!!) else File(filePath)

    companion object {
        const val NAME = "PrintModule"
    }
}
