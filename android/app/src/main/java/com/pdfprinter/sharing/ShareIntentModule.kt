package com.pdfprinter.sharing

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.pdfprinter.pdf.PdfWorkExecutors

private const val PDF_MIME_TYPE = "application/pdf"
private const val DOCX_MIME_TYPE =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
private const val DOC_MIME_TYPE = "application/msword"

/**
 * The document types this app can open. A Word document is converted to PDF once it is in, but that
 * happens after this module has already decided whether to surface the intent at all - which is why
 * this has to list every format rather than deferring to the conversion path.
 */
private val SUPPORTED_MIME_TYPES = setOf(PDF_MIME_TYPE, DOCX_MIME_TYPE, DOC_MIME_TYPE)

/**
 * Surfaces a document the app was opened or shared with from another app (file manager "Open
 * with", a browser download, an email attachment's "Share" action, ...) via the VIEW/SEND
 * intent-filters declared in AndroidManifest.xml. RN's own Linking module only ever surfaces a
 * VIEW intent's data URI, not a SEND intent's EXTRA_STREAM, so both are handled here instead for
 * one consistent JS-side API.
 */
class ShareIntentModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun getSharedDocumentFile(promise: Promise) {
        PdfWorkExecutors.io.execute {
            val activity = reactContext.currentActivity
            val intent = activity?.intent
            val uri = intent?.let { extractDocumentUri(it) }

            if (uri == null || intent == null) {
                promise.resolve(null)
                return@execute
            }

            val result = Arguments.createMap()
            result.putString("uri", uri.toString())
            result.putString("name", resolveDisplayName(uri, intent.type))

            // Consume it: without this, resuming the app from recents later (no new intent
            // delivered, so this Intent object is still the one onNewIntent last set) would keep
            // re-surfacing the same shared file indefinitely.
            intent.data = null
            intent.removeExtra(Intent.EXTRA_STREAM)

            promise.resolve(result)
        }
    }

    private fun extractDocumentUri(intent: Intent): Uri? =
        when (intent.action) {
            // A VIEW intent's data is whatever the sending app addressed us with, and the manifest
            // filter has already constrained it to a supported MIME type.
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> if (intent.type in SUPPORTED_MIME_TYPES) extractSendStreamUri(intent) else null
            else -> null
        }

    private fun extractSendStreamUri(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
        }

    /**
     * The name this file will be opened under, which is load-bearing rather than cosmetic: the
     * JS side decides whether a file needs converting by its extension, so a Word document whose
     * name lost its `.docx` would be handed to the PDF viewer as-is and fail there.
     */
    private fun resolveDisplayName(uri: Uri, mimeType: String?): String {
        if (uri.scheme == "content") {
            try {
                reactContext.contentResolver
                    .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                    ?.use { cursor ->
                        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (nameIndex >= 0 && cursor.moveToFirst()) {
                            val name = cursor.getString(nameIndex)
                            if (!name.isNullOrBlank()) return name
                        }
                    }
            } catch (_: Exception) {
                // Some document providers don't support this query at all - fall through to the
                // path-segment fallback below rather than failing the whole open.
            }
        }
        val lastSegment = uri.lastPathSegment ?: return defaultNameFor(mimeType)
        // A provider that reports a bare name with no extension at all still has to end up with a
        // recognisable one, and the intent's MIME type is the only thing left that says which.
        return if (lastSegment.contains('.')) lastSegment else "$lastSegment${extensionFor(mimeType)}"
    }

    private fun defaultNameFor(mimeType: String?): String = "Shared document${extensionFor(mimeType)}"

    /**
     * The one place that maps an intent's MIME type onto an extension, so the fallback name above
     * cannot drift out of step with it. Getting this wrong is not cosmetic: an unrecognised Word
     * document lands on `.pdf` and is then handed to the PDF viewer, which fails on it.
     */
    private fun extensionFor(mimeType: String?): String = when (mimeType) {
        DOCX_MIME_TYPE -> ".docx"
        DOC_MIME_TYPE -> ".doc"
        else -> ".pdf"
    }

    companion object {
        const val NAME = "ShareIntentModule"
    }
}
