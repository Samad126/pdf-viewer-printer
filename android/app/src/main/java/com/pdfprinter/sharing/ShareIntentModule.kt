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
private const val DEFAULT_SHARED_FILE_NAME = "Shared document.pdf"

/**
 * Surfaces a PDF the app was opened or shared with from another app (file manager "Open with",
 * a browser download, an email attachment's "Share" action, ...) via the VIEW/SEND intent-filters
 * declared in AndroidManifest.xml. RN's own Linking module only ever surfaces a VIEW intent's
 * data URI, not a SEND intent's EXTRA_STREAM, so both are handled here instead for one consistent
 * JS-side API.
 */
class ShareIntentModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun getSharedPdfFile(promise: Promise) {
        PdfWorkExecutors.io.execute {
            val activity = reactContext.currentActivity
            val intent = activity?.intent
            val uri = intent?.let { extractPdfUri(it) }

            if (uri == null) {
                promise.resolve(null)
                return@execute
            }

            // Consume it: without this, resuming the app from recents later (no new intent
            // delivered, so this Intent object is still the one onNewIntent last set) would keep
            // re-surfacing the same shared file indefinitely.
            intent.data = null
            intent.removeExtra(Intent.EXTRA_STREAM)

            val result = Arguments.createMap()
            result.putString("uri", uri.toString())
            result.putString("name", resolveDisplayName(uri))
            promise.resolve(result)
        }
    }

    private fun extractPdfUri(intent: Intent): Uri? =
        when (intent.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> if (intent.type == PDF_MIME_TYPE) extractSendStreamUri(intent) else null
            else -> null
        }

    private fun extractSendStreamUri(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
        }

    private fun resolveDisplayName(uri: Uri): String {
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
        val lastSegment = uri.lastPathSegment ?: return DEFAULT_SHARED_FILE_NAME
        return if (lastSegment.endsWith(".pdf", ignoreCase = true)) lastSegment else "$lastSegment.pdf"
    }

    companion object {
        const val NAME = "ShareIntentModule"
    }
}
