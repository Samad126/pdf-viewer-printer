package com.pdfprinter.print

import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentAdapter.LayoutResultCallback
import android.print.PrintDocumentAdapter.WriteResultCallback
import android.print.PrintDocumentInfo
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException

private const val COPY_BUFFER_SIZE = 8192

/**
 * Wraps the already-rasterized, font-free PDF produced by [com.pdfprinter.pdf.PdfRebuildModule].
 * There is no page-range slicing here on purpose: the file PrintManager receives is already
 * exactly what should be printed, so onWrite always streams the whole thing regardless of which
 * PageRange the print framework asks for.
 */
class PdfPrintDocumentAdapter(
    private val pdfFile: File,
    private val declaredPageCount: Int,
) : PrintDocumentAdapter() {

    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes,
        cancellationSignal: CancellationSignal?,
        callback: LayoutResultCallback,
        extras: Bundle?,
    ) {
        if (cancellationSignal?.isCanceled == true) {
            callback.onLayoutCancelled()
            return
        }

        if (!pdfFile.exists()) {
            callback.onLayoutFailed("Rebuilt PDF not found at ${pdfFile.absolutePath}")
            return
        }

        val pageCount = if (declaredPageCount > 0) declaredPageCount else PrintDocumentInfo.PAGE_COUNT_UNKNOWN
        val info =
            PrintDocumentInfo.Builder(pdfFile.name)
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount(pageCount)
                .build()

        callback.onLayoutFinished(info, oldAttributes != newAttributes)
    }

    override fun onWrite(
        pages: Array<out PageRange>,
        destination: ParcelFileDescriptor,
        cancellationSignal: CancellationSignal?,
        callback: WriteResultCallback,
    ) {
        try {
            FileInputStream(pdfFile).use { input ->
                FileOutputStream(destination.fileDescriptor).use { output ->
                    val buffer = ByteArray(COPY_BUFFER_SIZE)
                    while (true) {
                        if (cancellationSignal?.isCanceled == true) {
                            callback.onWriteCancelled()
                            return
                        }
                        val bytesRead = input.read(buffer)
                        if (bytesRead < 0) break
                        output.write(buffer, 0, bytesRead)
                    }
                    output.flush()
                }
            }
            callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
        } catch (error: IOException) {
            callback.onWriteFailed(error.message)
        }
    }
}
