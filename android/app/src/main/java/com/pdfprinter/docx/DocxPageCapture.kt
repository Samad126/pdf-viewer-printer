package com.pdfprinter.docx

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfDocument
import android.os.Handler
import android.webkit.WebView
import com.pdfprinter.pdf.PdfWorkExecutors
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Turns the document already rendered in [webView] into a PDF, one page at a time.
 *
 * Rasterizing is not the first choice here, it is the only one. The obvious alternative - driving
 * the WebView's own [android.print.PrintDocumentAdapter] into a file, which would keep real
 * selectable text - is not possible from an application: the adapter takes its callbacks as
 * `PrintDocumentAdapter.LayoutResultCallback` and `WriteResultCallback`, both of which have
 * package-private constructors, so the only code that can ever call `onLayout` or `onWrite` is the
 * print framework itself. Going through the framework means `PrintManager`, which means the system
 * print sheet and a user choosing "Save as PDF" - not a conversion the app can perform on its own.
 *
 * So the rendered page is captured and rebuilt with [PdfDocument], which is the same rasterize ->
 * recompose pipeline this app already uses for print and for annotate (see `PdfRebuildModule` and
 * `AnnotationModule`). What that costs is text: a converted Word document has no selectable or
 * searchable text in it. What it buys is that the conversion needs no print UI, no print service
 * and no user interaction, and that everything downstream - the viewer, both print paths,
 * draw/annotate, export and share - works on the result exactly as it does on any other PDF.
 *
 * The page box is [geometry], and the document is already laid out as pages by the time this runs:
 * the viewer page is served with a stylesheet that makes the rendered content a multi-column
 * container one page wide and one page tall, so the browser fills a column to the page height and
 * starts the next. A page is therefore a column, and this reads them off left to right.
 *
 * Everything here is main-thread state, because every WebView call is.
 */
class DocxPageCapture(
    private val mainHandler: Handler,
    private val webView: WebView,
    private val geometry: DocxPageGeometry,
    private val captureDpi: Int,
    private val pageCount: Int,
    private val tempFile: File,
    private val callbacks: Callbacks,
) {

    interface Callbacks {
        fun onProgress(pageIndex: Int, pageCount: Int)
        fun onCaptured(pageCount: Int, tempFile: File)
        fun onFailed(code: String, message: String)
    }

    /** Makes this capture settle exactly once, whichever of its several paths gets there first. */
    private val settled = AtomicBoolean(false)
    private val documentClosed = AtomicBoolean(false)

    private val document = PdfDocument()
    private val rasterWidth = geometry.rasterWidthPx(captureDpi)
    private val rasterHeight = geometry.rasterHeightPx(captureDpi)

    /** What the captured raster is scaled by to fill the PDF page it is drawn onto. */
    private val pointsPerRasterPixel = geometry.widthPt / rasterWidth

    private var pageIndex = 0

    // Sampled ink across the whole document, so a capture that painted nothing can be told from one
    // that worked. Counted rather than stored, so it stays one number for any page count.
    private var inkSamples = 0L

    /** Non-null only while waiting on the renderer's one and only paint. Main thread only. */
    private var paintTimer: Runnable? = null

    fun start() {
        if (pageCount <= 0) {
            fail("E_CAPTURE_EMPTY", "The document rendered no pages")
            return
        }

        // One wait for the whole capture, not one per page.
        //
        // Nothing about the view changes between pages - no scroll, no layout, no style - so the
        // renderer has nothing to paint after this point, and asking it to confirm a visual state
        // it is not going to change would only be asking to be told about the frame that is already
        // on screen. Waiting once, before the first page, is the whole synchronization this needs.
        //
        // The timer is the guard for the case where the paint never commits, and failing is the
        // only honest response to that: drawing a document that may not have been painted would
        // ship a blank PDF rather than an error.
        val timer = Runnable {
            fail("E_CAPTURE_STALLED", "The renderer did not finish painting the document")
        }
        paintTimer = timer
        mainHandler.postDelayed(timer, PAINT_TIMEOUT_MS)

        // Written out rather than as a lambda: VisualStateCallback is an abstract class, not an
        // interface, so Kotlin's SAM conversion does not apply to it.
        webView.postVisualStateCallback(
            VISUAL_STATE_REQUEST_ID,
            object : WebView.VisualStateCallback() {
                override fun onComplete(requestId: Long) {
                    if (settled.get()) return
                    mainHandler.removeCallbacks(timer)
                    paintTimer = null
                    capturePage()
                }
            },
        )
    }

    private fun capturePage() {
        if (settled.get()) return
        if (pageIndex >= pageCount) {
            writeDocument()
            return
        }

        val index = pageIndex
        val page = try {
            Bitmap.createBitmap(rasterWidth, rasterHeight, Bitmap.Config.ARGB_8888)
        } catch (outOfMemory: OutOfMemoryError) {
            fail(
                "E_CAPTURE_OUT_OF_MEMORY",
                "Not enough memory for a ${rasterWidth}x$rasterHeight page raster",
            )
            return
        }

        try {
            // A fresh bitmap is uninitialised memory, and the page box is paper.
            page.eraseColor(Color.WHITE)

            // This is the whole reason the capture does not scroll.
            //
            // WebView.onDraw paints the document from its own origin and ignores the view's scroll
            // offset: the scroll only decides what the framework composites on screen, never what
            // lands in a Canvas handed to draw(). So the view stays at scroll 0 for the entire
            // capture - which is also what makes the renderer record the document from its start -
            // and the page is selected by moving the canvas onto it instead.
            //
            // The document is laid out as columns, one per page, by the stylesheet the viewer page
            // is served with, so page N is a horizontal offset rather than a vertical one. That is
            // what puts the page break between two lines instead of through the middle of one: a
            // column is filled to the page height and the next one starts, which is a decision the
            // layout engine can make and a fixed slice of a continuous flow cannot.
            //
            // This only works because MainApplication calls WebView.enableSlowWholeDocumentDraw().
            // Without it the renderer records just the visible slice of the DOM, and pages past
            // the first - which are outside the view whatever the document's shape - draw nothing.
            val canvas = Canvas(page)
            val saved = canvas.save()
            canvas.translate(-(index.toLong() * rasterWidth).toFloat(), 0f)
            webView.draw(canvas)
            canvas.restoreToCount(saved)

            inkSamples += countInkSamples(page)

            // The raster is drawn onto a page measured in points, so this is where the capture's
            // dots-per-inch is decided: `rasterWidth` pixels across `geometry.widthPt` points is
            // exactly `captureDpi` by construction.
            val pageInfo = PdfDocument.PageInfo
                .Builder(geometry.widthPt.toInt(), geometry.heightPt.toInt(), index + 1)
                .create()
            val androidPage = document.startPage(pageInfo)
            val pageCanvas = androidPage.canvas
            val pageSaved = pageCanvas.save()
            // One factor for both axes: the raster and the page box are both derived from the same
            // page box, so they differ only by this scale and any rounding, and a single factor
            // keeps a half-pixel of rounding from becoming a stretched page.
            pageCanvas.scale(pointsPerRasterPixel, pointsPerRasterPixel)
            pageCanvas.drawBitmap(page, 0f, 0f, null)
            pageCanvas.restoreToCount(pageSaved)
            document.finishPage(androidPage)
        } catch (error: Exception) {
            fail("E_CAPTURE_FAILED", error.message ?: error.javaClass.simpleName)
            return
        } finally {
            page.recycle()
        }

        callbacks.onProgress(index + 1, pageCount)
        pageIndex = index + 1
        // Posted rather than called directly: capturing a long document should not be one
        // uninterrupted main-thread loop, and this keeps cancellation able to land between pages.
        mainHandler.post { capturePage() }
    }

    /**
     * Counts sampled pixels that are not paper-white, over a fixed grid.
     *
     * A WebView that paints nothing at all produces a perfectly valid, perfectly blank, completely
     * useless PDF, and nothing else in this class can tell that apart from a document that rendered.
     * Sampling a grid rather than reading every pixel keeps this cheap enough to run per page - the
     * question being answered is only "did anything get drawn at all", which a sparse grid answers
     * as well as a full scan.
     */
    private fun countInkSamples(page: Bitmap): Long {
        var ink = 0
        var y = 0
        while (y < page.height) {
            var x = 0
            while (x < page.width) {
                val pixel = page.getPixel(x, y)
                if (
                    Color.red(pixel) < INK_THRESHOLD ||
                    Color.green(pixel) < INK_THRESHOLD ||
                    Color.blue(pixel) < INK_THRESHOLD
                ) {
                    ink++
                }
                x += INK_SAMPLE_STEP
            }
            y += INK_SAMPLE_STEP
        }
        return ink.toLong()
    }

    private fun writeDocument() {
        if (inkSamples == 0L) {
            fail("E_CAPTURE_BLANK", "The document rendered as $pageCount blank page(s)")
            return
        }

        // writeTo walks every recorded page and is routinely tens of megabytes, so it does not
        // belong on the main thread.
        PdfWorkExecutors.io.execute {
            val failure: String? = try {
                FileOutputStream(tempFile).use { document.writeTo(it) }
                null
            } catch (error: Exception) {
                error.message ?: "Could not write ${tempFile.absolutePath}"
            }

            mainHandler.post { release() }
            if (failure != null) {
                fail("E_CAPTURE_WRITE_FAILED", failure)
            } else if (settled.compareAndSet(false, true)) {
                callbacks.onCaptured(pageCount, tempFile)
            }
        }
    }

    /**
     * Stops the capture without reporting anything. The caller is the one settling the caller's own
     * result, so this is the cancel half of the same single-shot contract [fail] settles.
     */
    fun cancel() {
        if (!settled.compareAndSet(false, true)) return
        mainHandler.post { release() }
    }

    private fun fail(code: String, message: String) {
        if (!settled.compareAndSet(false, true)) return
        mainHandler.post { release() }
        callbacks.onFailed(code, message)
    }

    private fun release() {
        paintTimer?.let { mainHandler.removeCallbacks(it) }
        paintTimer = null
        if (documentClosed.compareAndSet(false, true)) {
            try {
                document.close()
            } catch (ignored: Exception) {
                // Closing a document that never got a page is not itself a failure.
            }
        }
    }

    private companion object {
        // A document of any length should paint in well under a second per page; this only has to
        // be longer than a slow paint and shorter than the caller's own watchdog.
        const val PAINT_TIMEOUT_MS = 5_000L

        /** Arbitrary but non-zero, and only ever used for the one request this class makes. */
        const val VISUAL_STATE_REQUEST_ID = 1L

        const val INK_SAMPLE_STEP = 16

        // Anything not near-white counts. Text antialiasing, a table border and a stray glyph all
        // clear this comfortably, so only a genuinely empty raster fails to.
        const val INK_THRESHOLD = 250
    }
}
