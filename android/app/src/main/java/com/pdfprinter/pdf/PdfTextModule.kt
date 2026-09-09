package com.pdfprinter.pdf

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import io.legere.pdfiumandroid.PdfDocument as PdfiumDocument

private const val MAX_FIND_RESULTS = 200
private const val SNIPPET_CONTEXT_CHARS = 40

/**
 * Full-text extraction and search over an already-open PDFium document (see
 * [PdfDocumentRegistry]). Matching is done in Kotlin against each page's plain text rather than
 * through the library's native PdfTextPage.findStart/FindResult pair: that API reports a match
 * only as a character offset within a single page, which would still require re-extracting the
 * surrounding text to build a human-readable snippet. Since both findText and extractAllText
 * already need the full per-page text anyway, extracting it once with textPageGetText and
 * matching against it directly is simpler and avoids two separate code paths over the same data.
 */
class PdfTextModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun findText(handle: String, query: String, matchCase: Boolean, matchWholeWord: Boolean, promise: Promise) {
        PdfWorkExecutors.io.execute {
            val entry = PdfDocumentRegistry.get(handle)
            if (entry == null) {
                promise.reject("E_INVALID_HANDLE", "No open document for handle $handle")
                return@execute
            }
            if (query.isEmpty()) {
                promise.resolve(Arguments.createArray())
                return@execute
            }

            try {
                val matches: WritableArray = Arguments.createArray()
                val pageCount = entry.pdfiumDocument.getPageCount()
                var resultCount = 0

                pageLoop@ for (pageIndex in 0 until pageCount) {
                    if (resultCount >= MAX_FIND_RESULTS) break

                    val pageText = extractPageText(entry.pdfiumDocument, pageIndex)
                    if (pageText.isEmpty()) continue

                    for (matchStart in findAllOccurrences(pageText, query, matchCase, matchWholeWord)) {
                        if (resultCount >= MAX_FIND_RESULTS) break@pageLoop
                        matches.pushMap(
                            Arguments.createMap().apply {
                                putInt("pageIndex", pageIndex)
                                putString("snippet", buildSnippet(pageText, matchStart, query.length))
                            },
                        )
                        resultCount++
                    }
                }

                promise.resolve(matches)
            } catch (error: Exception) {
                promise.reject("E_FIND_FAILED", error.message, error)
            }
        }
    }

    @ReactMethod
    fun extractAllText(handle: String, promise: Promise) {
        PdfWorkExecutors.io.execute {
            val entry = PdfDocumentRegistry.get(handle)
            if (entry == null) {
                promise.reject("E_INVALID_HANDLE", "No open document for handle $handle")
                return@execute
            }

            try {
                val pageCount = entry.pdfiumDocument.getPageCount()
                val builder = StringBuilder()
                for (pageIndex in 0 until pageCount) {
                    if (pageIndex > 0) builder.append("\n\n")
                    builder.append("--- Page ${pageIndex + 1} ---\n\n")
                    builder.append(extractPageText(entry.pdfiumDocument, pageIndex))
                }
                promise.resolve(builder.toString())
            } catch (error: Exception) {
                promise.reject("E_EXTRACT_TEXT_FAILED", error.message, error)
            }
        }
    }

    private fun extractPageText(document: PdfiumDocument, pageIndex: Int): String =
        document.openPage(pageIndex).use { page ->
            page.openTextPage().use { textPage ->
                val charCount = textPage.textPageCountChars()
                if (charCount <= 0) "" else textPage.textPageGetText(0, charCount) ?: ""
            }
        }

    private fun findAllOccurrences(
        haystack: String,
        query: String,
        matchCase: Boolean,
        matchWholeWord: Boolean,
    ): List<Int> {
        val offsets = mutableListOf<Int>()
        val haystackToSearch = if (matchCase) haystack else haystack.lowercase()
        val queryToSearch = if (matchCase) query else query.lowercase()
        var fromIndex = 0
        while (true) {
            val foundAt = haystackToSearch.indexOf(queryToSearch, fromIndex)
            if (foundAt < 0) break
            if (!matchWholeWord || isWholeWordMatch(haystack, foundAt, query.length)) {
                offsets.add(foundAt)
            }
            fromIndex = foundAt + 1
        }
        return offsets
    }

    private fun isWholeWordMatch(text: String, start: Int, length: Int): Boolean {
        val before = start - 1
        val after = start + length
        val beforeOk = before < 0 || !text[before].isLetterOrDigit()
        val afterOk = after >= text.length || !text[after].isLetterOrDigit()
        return beforeOk && afterOk
    }

    private fun buildSnippet(text: String, matchStart: Int, matchLength: Int): String {
        val start = (matchStart - SNIPPET_CONTEXT_CHARS).coerceAtLeast(0)
        val end = (matchStart + matchLength + SNIPPET_CONTEXT_CHARS).coerceAtMost(text.length)
        val prefix = if (start > 0) "…" else ""
        val suffix = if (end < text.length) "…" else ""
        return (prefix + text.substring(start, end) + suffix).replace(Regex("\\s+"), " ").trim()
    }

    companion object {
        const val NAME = "PdfTextModule"
    }
}
