package com.pdfprinter.docx

import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.pdfprinter.pdf.PdfWorkExecutors
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipFile
import kotlin.math.abs

private const val BRIDGE_NAME = "DocxBridge"

// One watchdog per conversion, re-armed as the phase advances. Two numbers rather than one because
// rendering a large document in Chromium and then rasterizing it page by page are very different
// amounts of work, and a single timeout would have to be set to the sum of the worst case for both.
private const val RENDER_TIMEOUT_MS = 45_000L
private const val CAPTURE_TIMEOUT_MS = 90_000L

// The resolution each page is rasterized at. This is the resolution the converted PDF is stuck with
// - the print path re-rasterizes it through PDFium at DEFAULT_PRINT_DPI, but that can only
// interpolate what is already here, so this is a print-quality ceiling rather than a tuning knob.
//
// 200 rather than the app's 300 for print, because the WebView has to software-render its whole
// page box at this resolution before it can be captured, and that renderer-side cost and the
// 4-bytes-per-pixel raster both grow with its square: 300dpi is 2.25x the memory of 200dpi for a
// difference that mostly disappears once PDFium and then the printer have resampled it again.
private const val CAPTURE_DPI = 200

// How far the renderer's own report of its layout width may differ from what it was asked for.
// Rounding is the only legitimate source of disagreement, and a viewport that ignored the injected
// meta misses by hundreds of pixels, so this only has to be wide enough to absorb the former.
private const val VIEWPORT_TOLERANCE_CSS_PX = 2

// The JS bridge payload is attacker-controlled and arrives on a WebView thread, so it is truncated
// before it is copied anywhere.
private const val MAX_BRIDGE_PAYLOAD = 2_000

/** `%PDF-`, the first five bytes of any PDF this module is willing to call a success. */
private val PDF_MAGIC = byteArrayOf(0x25, 0x50, 0x44, 0x46, 0x2D)

/** CFB/OLE2 container magic. Legacy `.doc` and password-protected OOXML both start with this. */
private val CFB_MAGIC = byteArrayOf(0xD0.toByte(), 0xCF.toByte(), 0x11, 0xE0.toByte(), 0xA1.toByte(), 0xB1.toByte(), 0x1A, 0xE1.toByte())

/** `PK\x03\x04` (a zip with at least one entry) and `PK\x05\x06` (an empty zip). */
private val ZIP_MAGIC = byteArrayOf(0x50, 0x4B, 0x03, 0x04)
private val ZIP_EMPTY_MAGIC = byteArrayOf(0x50, 0x4B, 0x05, 0x06)

/**
 * Renders a `.docx` to a real PDF on-device.
 *
 * This exists so that everything the app already does with a PDF - the viewer, both print paths,
 * draw/annotate, export and share - works on a Word document without any of them knowing Word
 * documents exist. The conversion is the entire DOCX feature; `convertToPdf` hands back a PDF path
 * and the rest of the app takes it from there.
 *
 * The rendering itself is done by docx-preview (bundled in `assets/docx/`) inside an offscreen
 * WebView, and the rendered pages are then rasterized into a new PDF by [DocxPageCapture].
 *
 * Rasterizing is a real limitation and worth stating plainly: a converted Word document has no
 * selectable or searchable text, unlike every PDF this app otherwise handles. It is not a choice
 * between that and keeping the text - the platform offers no way for an app to run a WebView's
 * print adapter into a file, which is what a text-preserving conversion would need. See
 * [DocxPageCapture] for why. The alternative that does preserve text is the system print sheet,
 * which is a thing the user drives, not a conversion the app can perform for them.
 *
 * There is deliberately no `androidx.webkit` dependency, no network access, and no new npm
 * dependency - the viewer page and both of its scripts are static assets.
 */
class DocxModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    override fun getName(): String = NAME

    // WebView is UI-thread-bound throughout - constructing it, every settings/client/bridge call,
    // attaching and detaching it, loadUrl, the capture pass, and the visual-state
    // callback each capture waits on. This is the first module in this app to use a Handler at all;
    // everything else stays on PdfWorkExecutors.io, where the blocking file IO, the page box read
    // and the PDF validation below still run.
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var active: Conversion? = null

    init {
        reactContext.addLifecycleEventListener(this)
    }

    @ReactMethod
    fun convertToPdf(docxPath: String, outputPath: String, promise: Promise) {
        if (active != null) {
            promise.reject("E_BUSY", "A DOCX conversion is already running")
            return
        }

        val conversion = Conversion(promise = promise, target = resolveFile(outputPath))
        active = conversion

        PdfWorkExecutors.io.execute {
            val source = resolveFile(docxPath)
            val preflightError = preflight(source, conversion.target, conversion)
            if (preflightError != null) {
                failConversion(conversion, preflightError.first, preflightError.second)
                return@execute
            }

            // Rendering writes to a sibling temp file rather than to outputPath directly, so that
            // "a file exists at outputPath" is only ever true for a file that validated. A
            // conversion that fails or is cancelled leaves the caller's path untouched.
            conversion.tempFile = File(conversion.target.absolutePath + PART_SUFFIX)
            try {
                conversion.tempFile?.delete()
            } catch (ignored: Exception) {
                // A leftover temp file from an interrupted run is overwritten below anyway.
            }

            mainHandler.post { beginRender(conversion, source) }
        }
    }

    /**
     * Cancels the in-flight conversion, if any. Resolves immediately - the conversion's own promise
     * is the one that rejects with E_CANCELLED, once its capture has stopped and its WebView has
     * been torn down. A no-op when nothing is running, so the JS side can call it unconditionally.
     */
    @ReactMethod
    fun cancelConversion(promise: Promise) {
        mainHandler.post {
            active?.let { conversion ->
                conversion.capture?.cancel()
                failConversion(conversion, "E_CANCELLED", "Conversion cancelled")
            }
            promise.resolve(null)
        }
    }

    override fun onHostDestroy() {
        // The activity is going away underneath an in-flight conversion; nothing can finish now,
        // and the WebView has to come down before the window does.
        mainHandler.post {
            active?.let { failConversion(it, "E_NO_ACTIVITY", "Activity was destroyed mid-conversion") }
        }
    }

    override fun onHostResume() = Unit

    override fun onHostPause() = Unit

    // ---------------------------------------------------------------------------------------------
    // Preflight - runs on the io executor, before any WebView exists
    // ---------------------------------------------------------------------------------------------

    /**
     * Returns a code/message pair when the source cannot possibly render, or null when it can, in
     * which case [Conversion.geometry] is also filled in.
     */
    private fun preflight(source: File, target: File, conversion: Conversion): Pair<String, String>? {
        if (!source.isFile || !source.canRead()) {
            return "E_DOCX_NOT_FOUND" to "No readable file at ${source.absolutePath}"
        }
        if (source.length() == 0L) {
            return "E_DOCX_EMPTY" to "File at ${source.absolutePath} is empty"
        }

        // Cheap magic sniff before anything tries to parse the file. This is what tells a legacy
        // .doc (or a password-protected .docx, which Word stores in the same CFB container) apart
        // from a real OOXML package - docx-preview can read neither, and both would otherwise fail
        // deep inside the render with an error that explains nothing.
        val magic = ByteArray(8)
        val read = try {
            FileInputStream(source).use { it.read(magic) }
        } catch (error: IOException) {
            return "E_DOCX_NOT_FOUND" to (error.message ?: "Could not read ${source.absolutePath}")
        }
        if (read >= CFB_MAGIC.size && magic.copyOf(CFB_MAGIC.size).contentEquals(CFB_MAGIC)) {
            return "E_DOCX_ENCRYPTED_OR_LEGACY" to
                "This looks like a legacy .doc file or a password-protected .docx. " +
                "Open it in Word and save it as an unprotected .docx first."
        }
        val isZip = (read >= ZIP_MAGIC.size && magic.copyOf(ZIP_MAGIC.size).contentEquals(ZIP_MAGIC)) ||
            (read >= ZIP_EMPTY_MAGIC.size && magic.copyOf(ZIP_EMPTY_MAGIC.size).contentEquals(ZIP_EMPTY_MAGIC))
        if (!isZip) {
            return "E_DOCX_NOT_A_DOCX" to "File at ${source.absolutePath} is not a .docx package"
        }

        // The magic says "a zip"; this says "a zip shaped like a Word document". Doing it here
        // means a corrupt or wrong-suffix file fails immediately instead of after a WebView
        // startup and a render.
        //
        // The page box is read out of the same entry while the package is already open: it is what
        // decides the raster size, the PDF page size and the layout viewport, all three of which
        // have to be known before the WebView is created. fromDocumentXml streams the entry rather
        // than reading it, since document.xml is routinely larger than the whole .docx the user
        // picked.
        try {
            ZipFile(source).use { zip ->
                val entry = zip.getEntry(WORD_DOCUMENT_XML)
                    ?: return "E_DOCX_NOT_A_DOCX" to
                        "The package has no $WORD_DOCUMENT_XML, so it is not a Word document"
                conversion.geometry = zip.getInputStream(entry).use {
                    DocxPageGeometry.fromDocumentXml(it)
                }
            }
        } catch (error: Exception) {
            return "E_DOCX_CORRUPT" to (error.message ?: "The .docx package could not be opened")
        }

        val parent = target.parentFile
        if (parent == null || (!parent.isDirectory && !parent.mkdirs())) {
            return "E_OUTPUT_NOT_WRITABLE" to "Could not create ${parent?.absolutePath ?: "the output directory"}"
        }

        return null
    }

    // ---------------------------------------------------------------------------------------------
    // Render - main thread from here on
    // ---------------------------------------------------------------------------------------------

    private fun beginRender(conversion: Conversion, source: File) {
        if (conversion.completed.get()) return

        val activity = reactContext.currentActivity
        if (activity == null || activity.isFinishing || activity.isDestroyed) {
            failConversion(conversion, "E_NO_ACTIVITY", "No foreground activity to render in")
            return
        }

        // android.R.id.content is the ContentFrameLayout that *contains* React's ReactRootView.
        // Attaching here rather than to the ReactRootView itself keeps the WebView outside the
        // subtree Fabric owns, so adding a sibling of it cannot collide with a React commit.
        val host = activity.findViewById<ViewGroup>(android.R.id.content)
        if (host == null) {
            failConversion(conversion, "E_NO_ACTIVITY", "Activity has no content view to render in")
            return
        }

        val geometry = conversion.geometry
        val rasterWidth = geometry.rasterWidthPx(CAPTURE_DPI)
        val rasterHeight = geometry.rasterHeightPx(CAPTURE_DPI)

        val webView = WebView(activity)
        conversion.webView = webView

        webView.settings.javaScriptEnabled = true
        // The page carries the page box as a viewport meta and is sized so that meta and this view
        // agree exactly, so the document must be laid out at the meta's width rather than refitted
        // to the view. overviewMode in particular would rescale the page to fit, undoing both.
        webView.settings.useWideViewPort = true
        webView.settings.loadWithOverviewMode = false
        // Nothing here is for a human to zoom or fling.
        webView.settings.setSupportZoom(false)
        webView.settings.builtInZoomControls = false
        webView.settings.displayZoomControls = false
        // The page is served from assets over a synthetic origin and needs no filesystem or
        // content-resolver access of its own, so it gets none.
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.settings.javaScriptCanOpenWindowsAutomatically = false
        webView.settings.setSupportMultipleWindows(false)
        @Suppress("DEPRECATION")
        webView.settings.allowFileAccessFromFileURLs = false
        @Suppress("DEPRECATION")
        webView.settings.allowUniversalAccessFromFileURLs = false
        // Note: settings.blockNetworkLoads is deliberately NOT set. It blocks the main-frame
        // navigation to our own synthetic origin too, so the page would never load. The network
        // boundary here is DocxAssetWebViewClient, which fails every off-origin request closed.

        webView.webViewClient = DocxAssetWebViewClient(
            assets = activity.assets,
            docxFile = source,
            pageGeometry = geometry,
            captureDpi = CAPTURE_DPI,
            density = activity.resources.displayMetrics.density,
            onRenderProcessGone = { didCrash ->
                mainHandler.post {
                    failConversion(
                        conversion,
                        "E_RENDERER_GONE",
                        if (didCrash) "The rendering process crashed" else "The rendering process was killed",
                    )
                }
            },
            onMainFrameLoadFailed = { detail ->
                mainHandler.post {
                    failConversion(conversion, "E_VIEWER_LOAD_FAILED", "Viewer page failed to load: $detail")
                }
            },
        )

        webView.addJavascriptInterface(
            DocxBridge { stage, payload ->
                // Called on a WebView-owned thread, not the UI thread, and the payload is
                // untrusted: truncate first, then hop.
                val safePayload = payload.take(MAX_BRIDGE_PAYLOAD)
                mainHandler.post { onBridgeSignal(conversion, stage, safePayload) }
            },
            BRIDGE_NAME,
        )

        // alpha = 0f rather than View.INVISIBLE: an invisible view tells Chromium the WebView is
        // not visible, which backgrounds the renderer and can get it killed mid-render. A
        // transparent view still swallows touches on its own, hence the touch listener below.
        webView.alpha = 0f
        webView.setBackgroundColor(Color.WHITE)
        webView.isFocusable = false
        webView.isClickable = false
        webView.isLongClickable = false
        webView.setOnTouchListener { _, _ -> true }
        webView.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        // Software rendering, because that is the only mode Chromium will paint into a Canvas this
        // module supplies. A hardware-accelerated WebView draws through its own RenderNode, so
        // View.draw() on it produces an untouched bitmap - a blank page, silently. The cost is that
        // the renderer rasterizes its whole page box in software, which is the reason CAPTURE_DPI
        // is where it is.
        webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null)

        // Exactly one page, in device pixels at CAPTURE_DPI. The width is what the injected
        // viewport meta is checked against, and it is also what gives the capture its resolution:
        // the raster is a page-sized canvas with this view drawn into it. The height only has to be
        // sane - the capture selects pages by moving the canvas, not by scrolling, so it does not
        // depend on the view being exactly one page tall.
        host.addView(webView, FrameLayout.LayoutParams(rasterWidth, rasterHeight))

        armWatchdog(conversion, RENDER_TIMEOUT_MS, "render")
        webView.loadUrl("https://${DocxAssetWebViewClient.SYNTHETIC_HOST}/viewer.html")
    }

    private fun onBridgeSignal(conversion: Conversion, stage: String, payload: String) {
        if (conversion.completed.get()) return

        when (stage) {
            "ready" -> {
                // Single-shot: the first ready wins, so a document that spams this costs a few
                // no-op posts rather than queueing up conversions.
                if (!conversion.signaled.compareAndSet(false, true)) return

                val webView = conversion.webView ?: return
                val tempFile = conversion.tempFile
                if (tempFile == null) {
                    failConversion(conversion, "E_OUTPUT_NOT_WRITABLE", "No temp file was prepared")
                    return
                }

                val meta = parseReadyMeta(payload)
                val geometry = conversion.geometry
                val disagree = layoutDisagreement(meta, geometry)
                if (disagree != null) {
                    failConversion(conversion, "E_VIEWER_LAYOUT_MISMATCH", disagree)
                    return
                }

                armWatchdog(conversion, CAPTURE_TIMEOUT_MS, "capture")
                val capture = DocxPageCapture(
                    mainHandler = mainHandler,
                    webView = webView,
                    geometry = geometry,
                    captureDpi = CAPTURE_DPI,
                    pageCount = meta.pageCount,
                    tempFile = tempFile,
                    callbacks = object : DocxPageCapture.Callbacks {
                        override fun onProgress(pageIndex: Int, pageCount: Int) {
                            conversion.lastStage = "capture:$pageIndex/$pageCount"
                        }

                        override fun onCaptured(pageCount: Int, tempFile: File) {
                            finishConversion(conversion, pageCount)
                        }

                        override fun onFailed(code: String, message: String) {
                            failConversion(conversion, code, message)
                        }
                    },
                )
                conversion.capture = capture
                capture.start()
            }

            "error" -> {
                if (!conversion.signaled.compareAndSet(false, true)) return
                failConversion(conversion, "E_DOCX_RENDER_FAILED", payload)
            }

            // Progress: kept for diagnostics only, so a timeout can say which stage hung.
            else -> conversion.lastStage = stage
        }
    }

    private fun parseReadyMeta(metaJson: String): ReadyMeta =
        try {
            val json = JSONObject(metaJson)
            ReadyMeta(
                pageCount = json.optInt("pageCount", 0),
                viewportWidth = json.optInt("viewportWidth", 0),
            )
        } catch (error: Exception) {
            // A payload we cannot read is one we cannot check the layout of, and an unchecked
            // layout is what this check exists to refuse. Zeroes fail it below.
            ReadyMeta(pageCount = 0, viewportWidth = 0)
        }

    /**
     * Returns a reason the renderer's layout cannot be cut into pages, or null when it can.
     *
     * The capture assumes each page occupies exactly [DocxPageGeometry.rasterWidthPx] device pixels
     * of the view. A viewport meta that did not take effect breaks that assumption silently: the
     * document reflows to whatever width the view happens to be in CSS pixels, every page comes out
     * cropped, and the result is still a PDF of the right page count. Comparing the width the page
     * actually laid out at against the one it was given is what catches it.
     *
     * Only the width is checked. The scale needs no check, because the view is sized to the page
     * box: the scale the injected meta asks for and the scale Chromium falls back to when it fits
     * the layout viewport to the view are the same number, so a scale that goes unchecked is still
     * a scale that cannot be wrong.
     */
    private fun layoutDisagreement(meta: ReadyMeta, geometry: DocxPageGeometry): String? {
        if (meta.pageCount <= 0) {
            return "The document rendered as no pages at all"
        }
        if (abs(meta.viewportWidth - geometry.widthCssPx) > VIEWPORT_TOLERANCE_CSS_PX) {
            return "The page laid out ${meta.viewportWidth} CSS px wide, not ${geometry.widthCssPx}"
        }
        return null
    }

    private fun finishConversion(conversion: Conversion, pageCount: Int) {
        val tempFile = conversion.tempFile
        if (tempFile == null) {
            failConversion(conversion, "E_OUTPUT_NOT_WRITABLE", "No temp file was prepared")
            return
        }

        // Validation and the rename are blocking IO, so they go back to the executor. The promise
        // has not settled yet, which is what keeps outputPath meaningful: it only ever receives a
        // file that passed the check below.
        PdfWorkExecutors.io.execute {
            val invalid = validatePdf(tempFile)
            if (invalid != null) {
                failConversion(conversion, "E_PDF_INVALID", invalid)
                return@execute
            }

            // renameTo onto a sibling path is a same-filesystem rename, so it is atomic in
            // practice. Some devices refuse it when the destination already exists, hence the
            // delete first.
            try {
                if (conversion.target.exists() && !conversion.target.delete()) {
                    failConversion(conversion, "E_OUTPUT_NOT_WRITABLE", "Could not replace ${conversion.target.absolutePath}")
                    return@execute
                }
                if (!tempFile.renameTo(conversion.target)) {
                    failConversion(conversion, "E_OUTPUT_NOT_WRITABLE", "Could not write to ${conversion.target.absolutePath}")
                    return@execute
                }
            } catch (error: Exception) {
                failConversion(conversion, "E_OUTPUT_NOT_WRITABLE", error.message ?: "Could not write the output file")
                return@execute
            }

            if (!settle(conversion)) return@execute

            mainHandler.post { teardown(conversion) }
            val result = Arguments.createMap()
            result.putString("outputPath", conversion.target.absolutePath)
            if (pageCount > 0) result.putInt("pageCount", pageCount)
            conversion.promise.resolve(result)
        }
    }

    /** Returns null when the file looks like a complete PDF, or a reason to believe it does not. */
    private fun validatePdf(file: File): String? {
        if (!file.isFile) return "The PDF was not written"
        if (file.length() < MIN_PDF_BYTES) return "The PDF is empty (${file.length()} bytes)"

        val header = ByteArray(PDF_MAGIC.size)
        FileInputStream(file).use { input ->
            if (input.read(header) != PDF_MAGIC.size) return "The PDF is truncated"
        }
        if (!header.contentEquals(PDF_MAGIC)) return "The output has no %PDF- header"

        // A file can have a valid header and still be a truncated write - a full disk surfaces as
        // exactly that. The trailer is the cheap way to tell the two apart.
        RandomAccessFile(file, "r").use { raf ->
            val tailSize = minOf(TAIL_SCAN_BYTES, raf.length()).toInt()
            raf.seek(raf.length() - tailSize)
            val tail = ByteArray(tailSize)
            raf.readFully(tail)
            if (!String(tail, Charsets.ISO_8859_1).contains("%%EOF")) {
                return "The PDF is incomplete (no %%EOF trailer)"
            }
        }
        return null
    }

    // ---------------------------------------------------------------------------------------------
    // Teardown
    // ---------------------------------------------------------------------------------------------

    private fun armWatchdog(conversion: Conversion, timeoutMs: Long, stage: String) {
        val previous = conversion.watchdog
        if (previous != null) mainHandler.removeCallbacks(previous)
        val watchdog = Runnable {
            if (conversion.completed.get()) return@Runnable
            // Naming the last stage the page reported is the difference between a five-minute and
            // a five-hour debugging session when a document hangs.
            val hint = if (conversion.lastStage == INITIAL_STAGE) {
                ""
            } else {
                " (page last reported: ${conversion.lastStage})"
            }
            failConversion(conversion, "E_RENDER_TIMEOUT", "Timed out after ${timeoutMs / 1000}s during $stage$hint")
        }
        conversion.watchdog = watchdog
        mainHandler.postDelayed(watchdog, timeoutMs)
    }

    /**
     * Claims the conversion's single settle point, whichever of the timeout, the bridge, a renderer
     * crash, an adapter failure, cancellation or activity destruction gets there first. Also
     * releases the single-flight slot, so a new conversion may start as soon as this one is
     * decided rather than only once its teardown has run.
     */
    private fun settle(conversion: Conversion): Boolean {
        if (!conversion.completed.compareAndSet(false, true)) return false
        if (active === conversion) active = null
        return true
    }

    /** Settles the promise with a failure exactly once, then tears everything down. */
    private fun failConversion(conversion: Conversion, code: String, message: String) {
        if (!settle(conversion)) return

        conversion.capture?.cancel()
        // Teardown touches the WebView, so it has to be on the UI thread - and failConversion is
        // reachable from the io executor (validation) and from WebView threads (the bridge), not
        // just from the main thread.
        mainHandler.post {
            teardown(conversion)
            deleteTemp(conversion)
        }
        conversion.promise.reject(code, message)
    }

    private fun teardown(conversion: Conversion) {
        conversion.watchdog?.let { mainHandler.removeCallbacks(it) }
        conversion.watchdog = null
        conversion.capture = null

        conversion.webView?.let { view ->
            // Must come off the hierarchy before destroy(), or the WebView leaks a window.
            (view.parent as? ViewGroup)?.removeView(view)
            view.stopLoading()
            view.removeJavascriptInterface(BRIDGE_NAME)
            view.destroy()
        }
        conversion.webView = null
    }

    private fun deleteTemp(conversion: Conversion) {
        val tempFile = conversion.tempFile ?: return
        try {
            if (tempFile.exists()) tempFile.delete()
        } catch (ignored: Exception) {
            // A stale .part file in the cache directory is harmless.
        }
    }

    // file:// URIs are percent-encoded per RFC 3986 (spaces, non-ASCII filenames), but the real
    // path on disk is not - Uri.path decodes it, a plain removePrefix does not.
    private fun resolveFile(filePath: String): File =
        if (filePath.startsWith("file://")) File(Uri.parse(filePath).path!!) else File(filePath)

    /** What the viewer page reports about the layout it settled into, once it has rendered. */
    private class ReadyMeta(val pageCount: Int, val viewportWidth: Int)

    private class Conversion(
        val promise: Promise,
        val target: File,
    ) {
        val completed = AtomicBoolean(false)
        val signaled = AtomicBoolean(false)
        var tempFile: File? = null
        var webView: WebView? = null
        var capture: DocxPageCapture? = null
        var watchdog: Runnable? = null
        var lastStage: String = INITIAL_STAGE

        // Read out of the document during preflight, on the io executor, and only then read by the
        // main thread - which is a happens-before edge the promise handoff does not provide on its
        // own, hence the volatile.
        @Volatile
        var geometry: DocxPageGeometry = DocxPageGeometry.A4_PORTRAIT
    }

    companion object {
        const val NAME = "DocxModule"

        private const val PART_SUFFIX = ".part"
        private const val WORD_DOCUMENT_XML = "word/document.xml"
        private const val MIN_PDF_BYTES = 64L
        private const val TAIL_SCAN_BYTES = 2048L
        private const val MATCH_PARENT = ViewGroup.LayoutParams.MATCH_PARENT
        private const val INITIAL_STAGE = "preflight"
    }
}

/**
 * The page's only way to talk to native. Three methods, none of which do anything but report a
 * stage name or a message - the document being rendered is untrusted, so a document that manages
 * to run script must not be able to reach anything beyond lying about its progress. In particular
 * the output path never crosses this boundary.
 *
 * The methods must be public and the class must be public: `addJavascriptInterface` resolves them
 * by reflection. They are invoked on a WebView-owned thread, so the caller is responsible for
 * posting to the main thread.
 *
 * A document that does manage to run script can reach [onReady] directly and claim to be finished
 * early, which yields a truncated PDF. That is the intended ceiling: the worst outcome available
 * here is a wrong document, never access to anything.
 */
class DocxBridge(private val onSignal: (stage: String, payload: String) -> Unit) {

    // Progress is namespaced rather than sent as a bare stage name so that it can never collide
    // with the two terminal signals, whatever the page passes in.
    @JavascriptInterface
    fun onProgress(stage: String) = onSignal("progress:$stage", "")

    @JavascriptInterface
    fun onReady(metaJson: String) = onSignal("ready", metaJson)

    @JavascriptInterface
    fun onError(message: String) = onSignal("error", message)
}
