package com.pdfprinter.pdf

import android.graphics.Bitmap
import android.graphics.pdf.PdfDocument.PageInfo
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import android.graphics.pdf.PdfDocument as AndroidPdfDocument

private const val MIN_DPI = 36
private const val MAX_DPI = 1200
private const val PROGRESS_EVENT = "PdfPrinter:RebuildProgress"

/**
 * Rasterizes pages of an already-open PDFium document (see [PdfDocumentRegistry]) and reassembles
 * them into a brand-new, font-free PDF using android.graphics.pdf.PdfDocument - the *writer* API
 * used to compose a PDF from Canvas drawing, not android.graphics.pdf.PdfRenderer (the
 * reader/rasterizer API this project deliberately never touches). Only one page's bitmap is held
 * in memory at a time and it is recycled before the next page is rendered, so a large PDF does
 * not require holding every rendered page in memory simultaneously. When `pageIndices` is null,
 * every page of the source document is processed in order (the historical, still-default
 * behaviour); when non-null, only those 0-based source page indices are rasterized, in the given
 * order - this is how page-range selection is implemented, entirely client-side, rather than by
 * trusting a printer's IPP page-ranges support.
 */
class PdfRebuildModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    // NativeEventEmitter on the JS side checks for these two methods and warns if they're
    // missing. The actual event emission goes through RCTDeviceEventEmitter directly (see
    // emitProgress below), so there's no listener bookkeeping to do here.
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Double) {}

    @ReactMethod
    fun buildPrintReadyPdf(
        handle: String,
        dpi: Double,
        outputPath: String,
        pageIndices: ReadableArray?,
        promise: Promise,
    ) {
        PdfWorkExecutors.io.execute {
            val entry = PdfDocumentRegistry.get(handle)
            if (entry == null) {
                promise.reject("E_INVALID_HANDLE", "No open document for handle $handle")
                return@execute
            }

            val screenDpi = dpi.toInt().coerceIn(MIN_DPI, MAX_DPI)
            val sourcePageCount = entry.pdfiumDocument.getPageCount()
            val indicesToProcess: List<Int> =
                pageIndices?.let { array -> (0 until array.size()).map { i -> array.getInt(i) } }
                    ?: (0 until sourcePageCount).toList()
            val outFile = File(outputPath)
            outFile.parentFile?.mkdirs()

            val androidDocument = AndroidPdfDocument()
            val pageResults: WritableArray = Arguments.createArray()
            var succeededPages = 0
            var failedPages = 0
            var wasCancelled = false

            for ((outputPosition, sourcePageIndex) in indicesToProcess.withIndex()) {
                if (RebuildCancellationRegistry.isCancelled(handle)) {
                    wasCancelled = true
                    break
                }
                var bitmap: Bitmap? = null
                try {
                    entry.pdfiumDocument.openPage(sourcePageIndex).use { page ->
                        val size = page.getPageSize(screenDpi)
                        val width = size.width.coerceAtLeast(1)
                        val height = size.height.coerceAtLeast(1)
                        bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                        page.renderPageBitmap(bitmap, 0, 0, width, height, renderAnnot = true)

                        val pageInfo = PageInfo.Builder(width, height, outputPosition + 1).create()
                        val androidPage = androidDocument.startPage(pageInfo)
                        androidPage.canvas.drawBitmap(bitmap ?: return@use, 0f, 0f, null)
                        androidDocument.finishPage(androidPage)
                    }
                    succeededPages++
                    pageResults.pushMap(
                        Arguments.createMap().apply {
                            putInt("pageIndex", sourcePageIndex)
                            putBoolean("success", true)
                        },
                    )
                    emitProgress(outputPosition, indicesToProcess.size, success = true, error = null)
                } catch (pageError: Exception) {
                    failedPages++
                    val message = pageError.message ?: pageError.javaClass.simpleName
                    pageResults.pushMap(
                        Arguments.createMap().apply {
                            putInt("pageIndex", sourcePageIndex)
                            putBoolean("success", false)
                            putString("error", message)
                        },
                    )
                    emitProgress(outputPosition, indicesToProcess.size, success = false, error = message)
                } finally {
                    bitmap?.recycle()
                }
            }

            if (wasCancelled) {
                androidDocument.close()
                outFile.delete()
                RebuildCancellationRegistry.clear(handle)
                promise.reject("E_CANCELLED", "Rebuild cancelled")
                return@execute
            }

            try {
                FileOutputStream(outFile).use { stream -> androidDocument.writeTo(stream) }
            } catch (writeError: Exception) {
                androidDocument.close()
                RebuildCancellationRegistry.clear(handle)
                promise.reject("E_REBUILD_WRITE_FAILED", writeError.message, writeError)
                return@execute
            }
            androidDocument.close()
            RebuildCancellationRegistry.clear(handle)

            val result = Arguments.createMap()
            result.putString("outputPath", outFile.absolutePath)
            result.putInt("pageCount", indicesToProcess.size)
            result.putInt("succeededPages", succeededPages)
            result.putInt("failedPages", failedPages)
            result.putArray("pageResults", pageResults)
            promise.resolve(result)
        }
    }

    /**
     * Requests that an in-progress buildPrintReadyPdf call for this handle stop after its current
     * page. Resolves immediately - the actual stop happens asynchronously in the running loop,
     * which rejects that call's own promise with E_CANCELLED once it notices.
     */
    @ReactMethod
    fun cancelRebuild(handle: String, promise: Promise) {
        RebuildCancellationRegistry.cancel(handle)
        promise.resolve(null)
    }

    private fun emitProgress(pageIndex: Int, totalPages: Int, success: Boolean, error: String?) {
        val payload = Arguments.createMap().apply {
            putInt("pageIndex", pageIndex)
            putInt("totalPages", totalPages)
            putBoolean("success", success)
            putString("error", error)
        }
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(PROGRESS_EVENT, payload)
    }

    companion object {
        const val NAME = "PdfRebuildModule"
        const val EVENT_NAME = PROGRESS_EVENT
    }
}
