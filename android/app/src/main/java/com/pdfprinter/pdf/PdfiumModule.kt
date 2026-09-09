package com.pdfprinter.pdf

import android.graphics.Bitmap
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import io.legere.pdfiumandroid.PdfPasswordException
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID

private const val MIN_DPI = 36
private const val MAX_DPI = 1200

class PdfiumModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun openDocument(filePath: String, password: String?, promise: Promise) {
        PdfWorkExecutors.io.execute {
            val file = resolveFile(filePath)
            if (!file.exists()) {
                promise.reject("E_FILE_NOT_FOUND", "No file at ${file.absolutePath}")
                return@execute
            }

            val permissionInfo = PdfPermissionInspector.inspect(file)

            try {
                val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                val pdfiumDocument =
                    try {
                        PdfDocumentRegistry.core.newDocument(pfd, password)
                    } catch (passwordError: PdfPasswordException) {
                        pfd.close()
                        promise.resolve(
                            buildResult(
                                handle = null,
                                canOpen = false,
                                pageCount = 0,
                                requiresPassword = true,
                                passwordIncorrect = password != null,
                                permissionInfo = permissionInfo,
                            ),
                        )
                        return@execute
                    }

                val handle = UUID.randomUUID().toString()
                PdfDocumentRegistry.put(handle, OpenPdfDocument(pdfiumDocument, file.absolutePath))
                promise.resolve(
                    buildResult(
                        handle = handle,
                        canOpen = true,
                        pageCount = pdfiumDocument.getPageCount(),
                        requiresPassword = permissionInfo.isEncrypted,
                        passwordIncorrect = false,
                        permissionInfo = permissionInfo,
                    ),
                )
            } catch (error: IOException) {
                promise.reject("E_OPEN_FAILED", error.message, error)
            } catch (error: Exception) {
                promise.reject("E_OPEN_FAILED", error.message, error)
            }
        }
    }

    @ReactMethod
    fun closeDocument(handle: String, promise: Promise) {
        PdfWorkExecutors.io.execute {
            try {
                PdfDocumentRegistry.remove(handle)?.pdfiumDocument?.close()
                promise.resolve(null)
            } catch (error: Exception) {
                promise.reject("E_CLOSE_FAILED", error.message, error)
            }
        }
    }

    @ReactMethod
    fun getPageSize(handle: String, pageIndex: Double, dpi: Double, promise: Promise) {
        PdfWorkExecutors.io.execute {
            val entry = PdfDocumentRegistry.get(handle)
            if (entry == null) {
                promise.reject("E_INVALID_HANDLE", "No open document for handle $handle")
                return@execute
            }
            try {
                val screenDpi = clampDpi(dpi)
                entry.pdfiumDocument.openPage(pageIndex.toInt()).use { page ->
                    val size = page.getPageSize(screenDpi)
                    val result = Arguments.createMap()
                    result.putInt("width", size.width)
                    result.putInt("height", size.height)
                    promise.resolve(result)
                }
            } catch (error: Exception) {
                promise.reject("E_PAGE_SIZE_FAILED", error.message, error)
            }
        }
    }

    @ReactMethod
    fun renderPageToFile(handle: String, pageIndex: Double, dpi: Double, outputPath: String, promise: Promise) {
        PdfWorkExecutors.io.execute {
            val entry = PdfDocumentRegistry.get(handle)
            if (entry == null) {
                promise.reject("E_INVALID_HANDLE", "No open document for handle $handle")
                return@execute
            }
            var bitmap: Bitmap? = null
            try {
                val screenDpi = clampDpi(dpi)
                val outFile = File(outputPath)
                outFile.parentFile?.mkdirs()

                entry.pdfiumDocument.openPage(pageIndex.toInt()).use { page ->
                    val size = page.getPageSize(screenDpi)
                    val width = size.width.coerceAtLeast(1)
                    val height = size.height.coerceAtLeast(1)
                    bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                    page.renderPageBitmap(bitmap, 0, 0, width, height, renderAnnot = true)

                    FileOutputStream(outFile).use { stream ->
                        bitmap?.compress(Bitmap.CompressFormat.PNG, PNG_QUALITY, stream)
                    }

                    val result = Arguments.createMap()
                    result.putInt("pageIndex", pageIndex.toInt())
                    result.putInt("width", width)
                    result.putInt("height", height)
                    result.putString("outputPath", outFile.absolutePath)
                    promise.resolve(result)
                }
            } catch (error: Exception) {
                promise.reject("E_RENDER_FAILED", "Page ${pageIndex.toInt()}: ${error.message}", error)
            } finally {
                bitmap?.recycle()
            }
        }
    }

    private fun buildResult(
        handle: String?,
        canOpen: Boolean,
        pageCount: Int,
        requiresPassword: Boolean,
        passwordIncorrect: Boolean,
        permissionInfo: PdfPermissionInfo,
    ): WritableMap {
        val map = Arguments.createMap()
        map.putString("handle", handle)
        map.putBoolean("canOpen", canOpen)
        map.putInt("pageCount", pageCount)
        map.putBoolean("requiresPassword", requiresPassword)
        map.putBoolean("passwordIncorrect", passwordIncorrect)
        map.putBoolean("isEncrypted", permissionInfo.isEncrypted)
        map.putInt("encryptionVersion", permissionInfo.encryptionVersion)
        map.putInt("securityHandlerRevision", permissionInfo.securityHandlerRevision)
        map.putBoolean("canPrint", permissionInfo.canPrint)
        map.putBoolean("canPrintHighRes", permissionInfo.canPrintHighRes)
        map.putBoolean("canModify", permissionInfo.canModify)
        map.putBoolean("canCopy", permissionInfo.canCopy)
        map.putBoolean("canModifyAnnotations", permissionInfo.canModifyAnnotations)
        map.putBoolean("canFillForms", permissionInfo.canFillForms)
        map.putBoolean("canExtractForAccessibility", permissionInfo.canExtractForAccessibility)
        map.putBoolean("canAssemble", permissionInfo.canAssemble)
        return map
    }

    // file:// URIs are percent-encoded per RFC 3986 (spaces, non-ASCII filenames), but the real
    // path on disk is not - Uri.path decodes it, a plain removePrefix does not.
    private fun resolveFile(filePath: String): File =
        if (filePath.startsWith("file://")) File(Uri.parse(filePath).path!!) else File(filePath)

    private fun clampDpi(dpi: Double): Int = dpi.toInt().coerceIn(MIN_DPI, MAX_DPI)

    companion object {
        const val NAME = "PdfiumModule"
        private const val PNG_QUALITY = 100
    }
}
