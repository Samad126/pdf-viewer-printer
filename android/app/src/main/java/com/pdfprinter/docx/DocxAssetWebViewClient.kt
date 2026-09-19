package com.pdfprinter.docx

import android.content.res.AssetManager
import android.net.Uri
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream

/**
 * Serves the bundled viewer page and the .docx being converted under a synthetic
 * `https://docx.local` origin, and refuses every other http(s) request.
 *
 * The WebView hosting docx-preview has to be treated as hostile, because it renders content taken
 * straight out of an untrusted document: docx-preview builds DOM from the package's XML, and
 * `renderSymbol` interpolates an unvalidated XML attribute into an `innerHTML` template. Treating
 * the page as untrusted is also why [DocxModule]'s JS bridge is capability-free and why the output
 * path never crosses it - a document that manages to run script can only lie about being finished,
 * not reach anything.
 *
 * A synthetic https origin (rather than `file:///android_asset/` or `loadDataWithBaseURL`) is what
 * makes this work at all: it gives the page a secure, non-opaque, same-origin context, so
 * `fetch('/document.docx')` is a plain same-origin request with no CORS involvement and no need for
 * `allowUniversalAccessFromFileURLs`. `androidx.webkit`'s WebViewAssetLoader is the official
 * version of this trick; it is hand-rolled here to avoid pulling in a new dependency for ~40 lines.
 *
 * `shouldInterceptRequest` is called on a WebView-owned background thread, so the blocking file IO
 * below is fine and nothing here touches the UI thread.
 */
class DocxAssetWebViewClient(
    private val assets: AssetManager,
    private val docxFile: File,
    private val pageGeometry: DocxPageGeometry,
    private val captureDpi: Int,
    private val density: Float,
    private val onRenderProcessGone: (didCrash: Boolean) -> Unit,
    private val onMainFrameLoadFailed: (detail: String) -> Unit,
) : WebViewClient() {

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse? {
        val url: Uri = request.url

        // Anything that is not our synthetic origin fails closed. Returning null for an http(s)
        // URL means "let the normal network stack handle it", which is exactly what must never
        // happen here. blob:, data: and about: are renderer-local (images, and any srcdoc
        // iframe's own resources), so those pass through untouched.
        if (url.scheme != "https" || url.host != SYNTHETIC_HOST) {
            return when (url.scheme) {
                "http", "https" -> errorResponse(403, "Forbidden")
                else -> null
            }
        }

        // Matched on path only, so /viewer.html can carry a query string.
        return when (url.path) {
            "/viewer.html" -> viewerPage()
            "/docx-preview.min.js" -> asset("docx/docx-preview.min.js", "application/javascript")
            "/jszip.min.js" -> asset("docx/jszip.min.js", "application/javascript")
            "/document.docx" -> docx()
            else -> errorResponse(404, "Not Found")
        }
    }

    private fun asset(path: String, mimeType: String): WebResourceResponse =
        try {
            WebResourceResponse(mimeType, null, 200, "OK", NO_STORE, assets.open(path))
        } catch (missing: Exception) {
            // A missing asset is a build/packaging bug rather than a document bug. Surfacing it as
            // a 404 routes it through onReceivedHttpError into a clear native rejection instead of
            // a blank page that times out.
            errorResponse(404, "Not Found")
        }

    /**
     * Serves the viewer page with the page box substituted in: the viewport meta that sets the
     * width the document is laid out at, and the stylesheet that fragments it into page-sized
     * columns.
     *
     * The substitution happens here, as the page is served, rather than being passed as a query
     * string the page then applies at runtime: a viewport meta only takes effect when Chromium sees
     * it, and a meta inserted by script afterwards re-runs layout at the new size - which would
     * mean rendering the document twice to arrive where serving the right head once does. The
     * column stylesheet has to be here for the same reason: it decides the layout the document is
     * rendered into, so applying it afterwards would mean rendering the flow and then re-rendering
     * it as pages.
     *
     * `initial-scale` is the piece that needs the device: Android WebView measures a scale of 1 as
     * one CSS pixel per density-independent pixel, so the scale that puts one CSS pixel at
     * [captureDpi]'s worth of device pixels is that ratio. Leaving it out would render the page at
     * the screen's own density, which is a different size on every device - cropped on a dense
     * screen, letterboxed on a sparse one.
     */
    private fun viewerPage(): WebResourceResponse {
        val pixelsPerCssPx = captureDpi / 96f
        val initialScale = pixelsPerCssPx / density
        val injected = buildString {
            append("<meta name=\"viewport\" content=\"width=")
            append(pageGeometry.widthCssPx)
            append(", initial-scale=")
            append(initialScale)
            append("\">")
            append("<script>window.__DOCX_PAGE__={w:")
            append(pageGeometry.widthCssPx)
            append(",h:")
            append(pageGeometry.heightCssPx)
            append("};</script>")
            append("<style id=\"page-fragments\">")
            // This is what actually paginates the document. One column, exactly the page box, no
            // gap so column N starts at exactly N page widths, and column-fill: auto so a column is
            // filled to the page height before the next one begins. The rendered content is a
            // continuous flow with no idea where a page ends, and cutting that flow every page
            // height slices through whatever is there - through the middle of a line of text, in
            // practice. A fragmentainer is the only thing that moves the break to somewhere the
            // content can actually be divided.
            append("#docx-body{width:")
            append(pageGeometry.widthCssPx)
            append("px;height:")
            append(pageGeometry.heightCssPx)
            append("px;column-width:")
            append(pageGeometry.widthCssPx)
            append("px;column-gap:0;column-fill:auto;}")
            append("</style>")
        }

        val html = try {
            assets.open("docx/viewer.html").use { it.readBytes().toString(Charsets.UTF_8) }
        } catch (missing: Exception) {
            return errorResponse(404, "Not Found")
        }

        val body = html.replace(PAGE_GEOMETRY_MARKER, injected).toByteArray(Charsets.UTF_8)
        return WebResourceResponse(
            "text/html",
            "utf-8",
            200,
            "OK",
            NO_STORE,
            ByteArrayInputStream(body),
        )
    }

    private fun docx(): WebResourceResponse {
        if (!docxFile.isFile || !docxFile.canRead()) return errorResponse(404, "Not Found")

        // A fresh stream per request: WebResourceResponse takes ownership of the stream and closes
        // it when the response completes, so a cached stream would break the second request - which
        // really happens, since Chromium re-requests after a renderer process swap.
        val stream = FileInputStream(docxFile)
        val headers = mapOf(
            "Content-Type" to DOCX_MIME,
            // Lets fetch()/JSZip size their buffers up front instead of growing them repeatedly.
            "Content-Length" to docxFile.length().toString(),
            "Cache-Control" to "no-store",
        )
        return WebResourceResponse(DOCX_MIME, null, 200, "OK", headers, stream)
    }

    private fun errorResponse(status: Int, reason: String): WebResourceResponse =
        WebResourceResponse(
            "text/plain",
            "utf-8",
            status,
            reason,
            NO_STORE,
            ByteArrayInputStream(ByteArray(0)),
        )

    // The page never needs to navigate anywhere, and blocking navigation is cheap insurance
    // against a hyperlink in the document walking the WebView off to a real site.
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

    // Without this override the default implementation kills the whole app process when the
    // renderer dies, which on a large document (OOM) is a reachable outcome rather than a
    // theoretical one.
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        onRenderProcessGone(detail.didCrash())
        // true = handled. The WebView is unusable afterwards and must be destroyed by the caller.
        return true
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) {
            onMainFrameLoadFailed("${error.errorCode} ${error.description}")
        }
    }

    override fun onReceivedHttpError(
        view: WebView,
        request: WebResourceRequest,
        response: WebResourceResponse,
    ) {
        // Our own deliberate 403s for off-origin subresources must not fail the conversion - only
        // a failure of the page itself is fatal.
        if (request.isForMainFrame) {
            onMainFrameLoadFailed("HTTP ${response.statusCode} for ${request.url}")
        }
    }

    companion object {
        const val SYNTHETIC_HOST = "docx.local"
        const val DOCX_MIME =
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

        /** Kept in step with the matching comment in `assets/docx/viewer.html`. */
        private const val PAGE_GEOMETRY_MARKER = "<!--DOCX_PAGE_GEOMETRY-->"

        private val NO_STORE = mapOf("Cache-Control" to "no-store")
    }
}
