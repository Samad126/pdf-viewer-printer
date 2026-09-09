package com.pdfprinter.annotate

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.pdf.PdfDocument.PageInfo
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.pdfprinter.pdf.PdfDocumentRegistry
import com.pdfprinter.pdf.PdfWorkExecutors
import java.io.File
import java.io.FileOutputStream
import android.graphics.pdf.PdfDocument as AndroidPdfDocument

private const val MIN_DPI = 36
private const val MAX_DPI = 1200
private const val DEFAULT_PAGE_DPI = 150.0
private const val MIN_STROKE_WIDTH_PX = 1f

private data class AnnotationPoint(val x: Float, val y: Float)

private data class AnnotationStroke(
    val points: List<AnnotationPoint>,
    val color: String,
    val strokeWidthDp: Float,
)

private data class AnnotationPage(val pageDpi: Double, val strokes: List<AnnotationStroke>)

/**
 * Rasterizes every page of an already-open PDFium document (see [PdfDocumentRegistry]) at a given
 * print DPI, composites any freehand strokes onto the pages that have them, and reassembles the
 * result into a brand-new PDF using android.graphics.pdf.PdfDocument - the *writer* API, never
 * android.graphics.pdf.PdfRenderer. This intentionally duplicates PdfRebuildModule's
 * rasterize/reassemble technique rather than sharing code with it, so the print pipeline stays
 * completely unaffected by this feature. Only one page's bitmap is held in memory at a time.
 */
class AnnotationModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun saveAnnotatedPdf(
        handle: String,
        dpi: Double,
        outputPath: String,
        pageAnnotations: ReadableArray,
        promise: Promise,
    ) {
        PdfWorkExecutors.io.execute {
            val entry = PdfDocumentRegistry.get(handle)
            if (entry == null) {
                promise.reject("E_INVALID_HANDLE", "No open document for handle $handle")
                return@execute
            }

            val outputDpi = dpi.toInt().coerceIn(MIN_DPI, MAX_DPI)
            val annotationsByPage = parsePageAnnotations(pageAnnotations)
            val outFile = resolveFile(outputPath)
            outFile.parentFile?.mkdirs()

            val androidDocument = AndroidPdfDocument()
            try {
                val pageCount = entry.pdfiumDocument.getPageCount()
                for (pageIndex in 0 until pageCount) {
                    var bitmap: Bitmap? = null
                    try {
                        entry.pdfiumDocument.openPage(pageIndex).use { page ->
                            val size = page.getPageSize(outputDpi)
                            val width = size.width.coerceAtLeast(1)
                            val height = size.height.coerceAtLeast(1)
                            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                            val renderedBitmap = bitmap ?: return@use
                            page.renderPageBitmap(renderedBitmap, 0, 0, width, height, renderAnnot = true)

                            val pageAnnotation = annotationsByPage[pageIndex]
                            if (pageAnnotation != null) {
                                drawAnnotations(renderedBitmap, pageAnnotation, outputDpi.toDouble())
                            }

                            val pageInfo = PageInfo.Builder(width, height, pageIndex + 1).create()
                            val androidPage = androidDocument.startPage(pageInfo)
                            androidPage.canvas.drawBitmap(renderedBitmap, 0f, 0f, null)
                            androidDocument.finishPage(androidPage)
                        }
                    } finally {
                        bitmap?.recycle()
                    }
                }

                FileOutputStream(outFile).use { stream -> androidDocument.writeTo(stream) }
                androidDocument.close()

                val result = Arguments.createMap()
                result.putString("outputPath", outFile.absolutePath)
                result.putInt("pageCount", pageCount)
                promise.resolve(result)
            } catch (error: Exception) {
                androidDocument.close()
                outFile.delete()
                promise.reject("E_ANNOTATE_SAVE_FAILED", error.message, error)
            }
        }
    }

    private fun parsePageAnnotations(array: ReadableArray): Map<Int, AnnotationPage> {
        val result = mutableMapOf<Int, AnnotationPage>()
        for (i in 0 until array.size()) {
            val pageMap = array.getMap(i) ?: continue
            val pageIndex = pageMap.getInt("pageIndex")
            val pageDpi = if (pageMap.hasKey("pageDpi")) pageMap.getDouble("pageDpi") else DEFAULT_PAGE_DPI
            val strokesArray = pageMap.getArray("strokes") ?: continue

            val strokes = mutableListOf<AnnotationStroke>()
            for (j in 0 until strokesArray.size()) {
                val strokeMap = strokesArray.getMap(j) ?: continue
                val pointsArray = strokeMap.getArray("points") ?: continue

                val points = mutableListOf<AnnotationPoint>()
                for (k in 0 until pointsArray.size()) {
                    val pointMap = pointsArray.getMap(k) ?: continue
                    points.add(AnnotationPoint(pointMap.getDouble("x").toFloat(), pointMap.getDouble("y").toFloat()))
                }
                if (points.isEmpty()) continue

                val color = strokeMap.getString("color") ?: "#000000"
                val strokeWidthDp = strokeMap.getDouble("strokeWidthDp").toFloat()
                strokes.add(AnnotationStroke(points, color, strokeWidthDp))
            }

            if (strokes.isNotEmpty()) {
                result[pageIndex] = AnnotationPage(pageDpi, strokes)
            }
        }
        return result
    }

    // strokes were captured against an on-screen canvas whose coordinate space corresponds to
    // `pageDpi` (the *effective* dpi of however that canvas was displayed, tracked by the caller -
    // not necessarily the dpi any background preview image was literally rasterized at). Since a
    // page rasterized at dpi D has pixel dimensions proportional to D, a point captured in a
    // pageDpi-space coordinate system lands at the same physical spot on a bitmap rendered at
    // outputDpi once scaled by outputDpi / pageDpi - this single ratio is the crux of the mapping.
    private fun drawAnnotations(bitmap: Bitmap, page: AnnotationPage, outputDpi: Double) {
        val canvas = Canvas(bitmap)
        val scale = outputDpi / page.pageDpi
        for (stroke in page.strokes) {
            val paint =
                Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    style = Paint.Style.STROKE
                    strokeCap = Paint.Cap.ROUND
                    strokeJoin = Paint.Join.ROUND
                    color =
                        try {
                            Color.parseColor(stroke.color)
                        } catch (error: IllegalArgumentException) {
                            Color.BLACK
                        }
                    strokeWidth = (stroke.strokeWidthDp * scale).toFloat().coerceAtLeast(MIN_STROKE_WIDTH_PX)
                }
            canvas.drawPath(buildStrokePath(stroke.points, scale), paint)
        }
    }

    // Quadratic-bezier-through-midpoints smoothing: the standard technique for turning sparse,
    // jagged touch-move samples into a visually smooth freehand line. Mirrored on the JS side
    // (DrawingCanvas's SVG preview) so the on-screen preview and the saved PDF look the same.
    private fun buildStrokePath(points: List<AnnotationPoint>, scale: Double): Path {
        val path = Path()
        val scaled = points.map { (it.x * scale).toFloat() to (it.y * scale).toFloat() }
        if (scaled.isEmpty()) return path

        val (firstX, firstY) = scaled.first()
        path.moveTo(firstX, firstY)

        if (scaled.size == 1) {
            path.lineTo(firstX, firstY)
            return path
        }

        for (i in 1 until scaled.size - 1) {
            val (currentX, currentY) = scaled[i]
            val (nextX, nextY) = scaled[i + 1]
            val midX = (currentX + nextX) / 2f
            val midY = (currentY + nextY) / 2f
            path.quadTo(currentX, currentY, midX, midY)
        }
        val (lastX, lastY) = scaled.last()
        path.lineTo(lastX, lastY)
        return path
    }

    // file:// URIs are percent-encoded per RFC 3986 (spaces, non-ASCII filenames), but the real
    // path on disk is not - Uri.path decodes it, a plain removePrefix does not.
    private fun resolveFile(filePath: String): File =
        if (filePath.startsWith("file://")) File(Uri.parse(filePath).path!!) else File(filePath)

    companion object {
        const val NAME = "AnnotationModule"
    }
}
