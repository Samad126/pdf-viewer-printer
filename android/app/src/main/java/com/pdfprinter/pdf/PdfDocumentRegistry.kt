package com.pdfprinter.pdf

import io.legere.pdfiumandroid.PdfiumCore
import java.util.concurrent.ConcurrentHashMap
import io.legere.pdfiumandroid.PdfDocument as PdfiumDocument

data class OpenPdfDocument(
    val pdfiumDocument: PdfiumDocument,
    val filePath: String,
)

/**
 * Keeps PDFium documents open across separate native-module calls (open -> inspect -> rasterize
 * -> rebuild -> close) so a document is parsed once instead of once per call. Shared by
 * [PdfiumModule] and [PdfRebuildModule].
 */
object PdfDocumentRegistry {

    private val documents = ConcurrentHashMap<String, OpenPdfDocument>()

    val core: PdfiumCore by lazy { PdfiumCore() }

    fun put(handle: String, document: OpenPdfDocument) {
        documents[handle] = document
    }

    fun get(handle: String): OpenPdfDocument? = documents[handle]

    fun remove(handle: String): OpenPdfDocument? = documents.remove(handle)

    fun closeAll() {
        documents.keys.toList().forEach { handle ->
            documents.remove(handle)?.pdfiumDocument?.close()
        }
    }
}
