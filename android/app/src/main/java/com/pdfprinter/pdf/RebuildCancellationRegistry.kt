package com.pdfprinter.pdf

import java.util.concurrent.ConcurrentHashMap

/**
 * Tracks rebuilds cancelled by the user while still rasterizing, keyed by the PDFium document
 * handle they apply to. Only one rebuild ever runs per handle at a time in this app's flow (open
 * -> inspect -> rasterize -> rebuild -> close is sequential per document), so a handle-keyed set
 * is enough - no per-request token needed here, unlike [com.pdfprinter.printers.ipp.IppCancellationRegistry]
 * where independent uploads could in principle overlap.
 */
object RebuildCancellationRegistry {

    private val cancelled = ConcurrentHashMap.newKeySet<String>()

    fun cancel(handle: String) {
        cancelled.add(handle)
    }

    fun isCancelled(handle: String): Boolean = cancelled.contains(handle)

    fun clear(handle: String) {
        cancelled.remove(handle)
    }
}
