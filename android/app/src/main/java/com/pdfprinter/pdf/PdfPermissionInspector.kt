package com.pdfprinter.pdf

import java.io.File
import java.io.RandomAccessFile

/**
 * io.legere:pdfiumandroid (like every other maintained PDFium binding we evaluated) does not
 * expose PDFium's native FPDF_GetDocPermissions/FPDF_GetSecurityHandlerRevision calls through its
 * public Kotlin API - the native document pointer needed to call them lives on an internal class
 * that isn't reachable outside the library's own Gradle module. Reaching into PDFium's raw C
 * symbols ourselves would require hand-written JNI/NDK code linked against the .so bundled inside
 * that AAR, which can't be verified in an environment without the Android NDK.
 *
 * Instead we read the encryption dictionary directly, the same one PDFium itself reads
 * (ISO 32000-1 7.6.3): a PDF's /Encrypt entry (and the /P permission bitmask inside it) always
 * lives in the trailer, or in the xref-stream dictionary for cross-reference-stream PDFs. This is
 * a best-effort, bounded scan for debugging/surfacing purposes, not a full PDF parser: it only
 * looks at the tail of the file (where the trailer/xref always is) and, if /Encrypt is an indirect
 * reference, does a linear scan for that object. Encryption state (isEncrypted) is corroborated by
 * PdfiumModule via PDFium's own open-with-password behaviour.
 */
object PdfPermissionInspector {

    private const val MAX_SCAN_BYTES = 5L * 1024 * 1024

    private const val BIT_PRINT = 1 shl 2
    private const val BIT_MODIFY = 1 shl 3
    private const val BIT_COPY = 1 shl 4
    private const val BIT_ANNOTATE = 1 shl 5
    private const val BIT_FILL_FORMS = 1 shl 8
    private const val BIT_EXTRACT_ACCESSIBILITY = 1 shl 9
    private const val BIT_ASSEMBLE = 1 shl 10
    private const val BIT_PRINT_HIGH_RES = 1 shl 11

    private val encryptRefPattern = Regex("""/Encrypt\s+(\d+)\s+(\d+)\s+R""")
    private val versionPattern = Regex("""/V\s+(-?\d+)""")
    private val revisionPattern = Regex("""/R\s+(-?\d+)""")
    private val permissionsPattern = Regex("""/P\s+(-?\d+)""")

    fun inspect(file: File): PdfPermissionInfo =
        try {
            val text = readTail(file)
            val dictText = locateEncryptDictionary(text)
            if (dictText == null) PdfPermissionInfo.UNRESTRICTED else parseEncryptDictionary(dictText)
        } catch (error: Exception) {
            PdfPermissionInfo.UNRESTRICTED
        }

    private fun readTail(file: File): String {
        val length = file.length()
        val readSize = minOf(length, MAX_SCAN_BYTES).toInt()
        if (readSize <= 0) return ""
        RandomAccessFile(file, "r").use { raf ->
            val offset = (length - readSize).coerceAtLeast(0)
            raf.seek(offset)
            val buffer = ByteArray(readSize)
            raf.readFully(buffer)
            return String(buffer, Charsets.ISO_8859_1)
        }
    }

    private fun locateEncryptDictionary(text: String): String? {
        val refMatch = encryptRefPattern.find(text) ?: return locateInlineEncryptDictionary(text)
        val objectNumber = refMatch.groupValues[1]
        val objPattern = Regex("""(?<![0-9])$objectNumber\s+\d+\s+obj\b""")
        val objMatch = objPattern.find(text) ?: return null
        val dictStart = text.indexOf("<<", objMatch.range.last)
        if (dictStart < 0) return null
        return extractBalancedDict(text, dictStart)
    }

    private fun locateInlineEncryptDictionary(text: String): String? {
        val encryptIndex = text.indexOf("/Encrypt")
        if (encryptIndex < 0) return null
        val dictStart = text.indexOf("<<", encryptIndex)
        if (dictStart < 0) return null
        return extractBalancedDict(text, dictStart)
    }

    private fun extractBalancedDict(text: String, start: Int): String? {
        var depth = 0
        var i = start
        while (i < text.length - 1) {
            when {
                text[i] == '<' && text[i + 1] == '<' -> {
                    depth++
                    i += 2
                }
                text[i] == '>' && text[i + 1] == '>' -> {
                    depth--
                    i += 2
                    if (depth == 0) return text.substring(start, i)
                }
                else -> i++
            }
        }
        return null
    }

    private fun parseEncryptDictionary(dict: String): PdfPermissionInfo {
        val version = versionPattern.find(dict)?.groupValues?.get(1)?.toIntOrNull() ?: 0
        val revision = revisionPattern.find(dict)?.groupValues?.get(1)?.toIntOrNull() ?: 0
        val permissions = permissionsPattern.find(dict)?.groupValues?.get(1)?.toIntOrNull() ?: -1
        return PdfPermissionInfo(
            isEncrypted = true,
            encryptionVersion = version,
            securityHandlerRevision = revision,
            canPrint = permissions and BIT_PRINT != 0,
            canPrintHighRes = permissions and BIT_PRINT_HIGH_RES != 0,
            canModify = permissions and BIT_MODIFY != 0,
            canCopy = permissions and BIT_COPY != 0,
            canModifyAnnotations = permissions and BIT_ANNOTATE != 0,
            canFillForms = permissions and BIT_FILL_FORMS != 0,
            canExtractForAccessibility = permissions and BIT_EXTRACT_ACCESSIBILITY != 0,
            canAssemble = permissions and BIT_ASSEMBLE != 0,
        )
    }
}
