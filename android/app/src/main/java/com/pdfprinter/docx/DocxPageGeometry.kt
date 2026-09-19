package com.pdfprinter.docx

import java.io.InputStream
import java.io.InputStreamReader
import kotlin.math.roundToInt

/**
 * The page box a Word document lays out in, as declared by its own `<w:sectPr><w:pgSz>`.
 *
 * Native owns the page size rather than the viewer page, because native is what cuts the rendered
 * document into pages: the raster it captures and the PDF page it draws that raster onto both have
 * to be derived from the same numbers, and reading them out of the document is the only way the PDF
 * ends up the size the author set instead of whatever A4 happens to be.
 *
 * The same box is expressed three ways - CSS pixels for the renderer's layout viewport, device
 * pixels for the raster capture, and PostScript points for the PDF page - and all three are
 * derived here so they cannot drift apart.
 */
class DocxPageGeometry(val widthPt: Float, val heightPt: Float) {

    /** CSS pixels are 1/96 inch and points are 1/72, so a point is exactly 4/3 of a CSS pixel. */
    val widthCssPx: Int get() = (widthPt * CSS_PX_PER_POINT).roundToInt()
    val heightCssPx: Int get() = (heightPt * CSS_PX_PER_POINT).roundToInt()

    /**
     * Device pixels per CSS pixel for a raster captured at [dpi]. This is the scale the WebView is
     * laid out at, so a page box of [widthCssPx] becomes [rasterWidthPx] device pixels wide and the
     * PDF page ends up genuinely [dpi] dots per inch rather than merely claiming to be.
     */
    fun rasterWidthPx(dpi: Int): Int = (widthCssPx * dpi / 96f).roundToInt()
    fun rasterHeightPx(dpi: Int): Int = (heightCssPx * dpi / 96f).roundToInt()

    companion object {
        const val CSS_PX_PER_POINT = 4f / 3f

        /** A4 portrait - what Word gives a document whose section properties declare no page size. */
        val A4_PORTRAIT = DocxPageGeometry(595.28f, 841.89f)

        private const val PG_SZ = "<w:pgSz"
        private const val TWIPS_PER_POINT = 20f

        // A `w:pgSz` element is around 40 characters, so carrying this much of each chunk over
        // into the next is enough that the start of any element whose end lands in the next chunk
        // is still in the window. It is what lets document.xml be scanned without being held.
        private const val WINDOW_CHARS = 256
        private const val CHUNK_CHARS = 8 * 1024

        private val ATTRIBUTES = Regex("""w:(w|h|orient)\s*=\s*"([^"]*)"""")

        /**
         * Reads the page box out of a `word/document.xml`, which can be tens of megabytes, so it is
         * scanned in chunks and only the last `w:pgSz` is kept.
         *
         * The last one is the body-level section properties, which is the section the document as a
         * whole is laid out in. A document with several differently-sized sections is rendered into
         * this one box - docx-preview reflows the whole document into a single column either way, so
         * per-section page sizes are not something this conversion could honour.
         */
        fun fromDocumentXml(input: InputStream): DocxPageGeometry {
            var lastTag: String? = null
            var carry = ""
            val chunk = CharArray(CHUNK_CHARS)

            InputStreamReader(input, Charsets.UTF_8).use { reader ->
                while (true) {
                    val read = reader.read(chunk)
                    if (read <= 0) break

                    val window = carry + String(chunk, 0, read)
                    var from = 0
                    while (true) {
                        val start = window.indexOf(PG_SZ, from)
                        if (start < 0) break
                        val end = window.indexOf('>', start)
                        // An unterminated element at the end of the window is simply carried over.
                        if (end < 0) break
                        lastTag = window.substring(start, end + 1)
                        from = end + 1
                    }

                    carry = window.substring(maxOf(0, window.length - WINDOW_CHARS))
                }
            }

            return lastTag?.let(::parse) ?: A4_PORTRAIT
        }

        private fun parse(tag: String): DocxPageGeometry {
            val values = mutableMapOf<String, String>()
            for (match in ATTRIBUTES.findAll(tag)) values[match.groupValues[1]] = match.groupValues[2]

            val width = values["w"]?.toIntOrNull() ?: return A4_PORTRAIT
            val height = values["h"]?.toIntOrNull() ?: return A4_PORTRAIT
            if (width <= 0 || height <= 0) return A4_PORTRAIT

            // Word writes w/h as the physical dimensions and `w:orient` as a record of which way
            // round they already are, but other producers write portrait dimensions plus
            // orient="landscape" and expect the reader to swap them. Honouring the swap only when
            // the dimensions disagree with the attribute covers both conventions.
            val swap = values["orient"].equals("landscape", ignoreCase = true) && height > width
            return DocxPageGeometry(
                (if (swap) height else width) / TWIPS_PER_POINT,
                (if (swap) width else height) / TWIPS_PER_POINT,
            )
        }
    }
}
