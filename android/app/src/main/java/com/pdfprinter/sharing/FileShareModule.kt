package com.pdfprinter.sharing

import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * The *sending* side of sharing (see ShareIntentModule for the *receiving* side). Android throws
 * FileUriExposedException (API 24+) if a bare file:// URI is put into an Intent handed to another
 * app, so the local file is wrapped in a content:// URI via FileProvider (see the matching
 * <provider> entry in AndroidManifest.xml and res/xml/file_paths.xml) before being shared.
 */
class FileShareModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * Starts the system share sheet for the given file. Resolves once the chooser intent has been
     * handed off, not once the user actually picks a target app - the same "resolves on handoff"
     * convention PrintModule.printPdf already uses for its own fire-and-forget system UI launch.
     */
    @ReactMethod
    fun shareFile(filePath: String, mimeType: String, promise: Promise) {
        try {
            val file = resolveFile(filePath)
            if (!file.exists()) {
                promise.reject("E_FILE_NOT_FOUND", "No file at ${file.absolutePath}")
                return
            }

            val activity = reactContext.currentActivity
            if (activity == null) {
                promise.reject("E_NO_ACTIVITY", "No foreground activity to share from")
                return
            }

            val contentUri = FileProvider.getUriForFile(reactContext, "${reactContext.packageName}.fileprovider", file)
            val sendIntent =
                Intent(Intent.ACTION_SEND).apply {
                    type = mimeType
                    putExtra(Intent.EXTRA_STREAM, contentUri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
            activity.startActivity(Intent.createChooser(sendIntent, null))
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("E_SHARE_FAILED", error.message, error)
        }
    }

    // file:// URIs are percent-encoded per RFC 3986 (spaces, non-ASCII filenames), but the real
    // path on disk is not - Uri.path decodes it, a plain removePrefix does not.
    private fun resolveFile(filePath: String): File =
        if (filePath.startsWith("file://")) File(Uri.parse(filePath).path!!) else File(filePath)

    companion object {
        const val NAME = "FileShareModule"
    }
}
