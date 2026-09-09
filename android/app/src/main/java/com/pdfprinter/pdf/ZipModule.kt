package com.pdfprinter.pdf

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Bundles a set of files (in practice, the per-page PNGs produced by PdfiumModule.renderPageToFile
 * during an "export as images" run) into a single .zip, since @react-native-documents/picker's
 * saveDocuments can only save one file per call on Android.
 */
class ZipModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun zipFiles(filePaths: ReadableArray, outputPath: String, promise: Promise) {
        PdfWorkExecutors.io.execute {
            try {
                val outFile = File(outputPath)
                outFile.parentFile?.mkdirs()

                ZipOutputStream(FileOutputStream(outFile)).use { zipStream ->
                    for (i in 0 until filePaths.size()) {
                        val path = filePaths.getString(i)
                        if (path == null) continue
                        val sourceFile = File(path)
                        if (!sourceFile.exists()) {
                            promise.reject("E_FILE_NOT_FOUND", "No file at ${sourceFile.absolutePath}")
                            return@execute
                        }
                        zipStream.putNextEntry(ZipEntry(sourceFile.name))
                        BufferedInputStream(FileInputStream(sourceFile)).use { input -> input.copyTo(zipStream) }
                        zipStream.closeEntry()
                    }
                }

                promise.resolve(outFile.absolutePath)
            } catch (error: Exception) {
                promise.reject("E_ZIP_FAILED", error.message, error)
            }
        }
    }

    companion object {
        const val NAME = "ZipModule"
    }
}
