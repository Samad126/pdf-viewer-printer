package com.pdfprinter.printers.ipp

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets

// Value tags from RFC 8010 section 3.5.2. Only the ones this encoder actually emits are named
// here - IPP defines many more (boolean, dateTime, ...) that this encoder never needs.
private const val TAG_OPERATION_ATTRIBUTES = 0x01
private const val TAG_END_OF_ATTRIBUTES = 0x03
private const val TAG_INTEGER = 0x21
private const val TAG_ENUM = 0x23
private const val TAG_NAME_WITHOUT_LANGUAGE = 0x42
private const val TAG_KEYWORD = 0x44
private const val TAG_URI = 0x45
private const val TAG_CHARSET = 0x47
private const val TAG_NATURAL_LANGUAGE = 0x48
private const val TAG_MIME_MEDIA_TYPE = 0x49

private const val OPERATION_ID_PRINT_JOB = 0x0002
private const val OPERATION_ID_CANCEL_JOB = 0x0008
private const val OPERATION_ID_GET_JOB_ATTRIBUTES = 0x0009
private const val IPP_VERSION_MAJOR = 1
private const val IPP_VERSION_MINOR = 1

/**
 * Builds IPP/1.1 request bodies per RFC 8010 section 3.5's binary attribute encoding. Pure JDK -
 * no Android framework types - so it can be exercised without an Android runtime. For
 * Print-Job, the returned bytes do NOT include the PDF itself: [IppHttpClient] streams that
 * separately, immediately after the header, so a multi-hundred-page PDF is never held fully in
 * memory to build one giant request buffer. Cancel-Job has no document body at all.
 */
object IppEncoder {

    /**
     * copies/sides/orientationRequested/printColorMode are standard IPP Job Template attributes
     * (RFC 8011 section 5.2). A Print-Job *request* has no separate job-attributes-group (that
     * only appears in responses), so they are encoded into the same operation-attributes-group as
     * printer-uri/job-name/etc, per RFC 8011 section 5.2 - this is standard client behaviour, not
     * a shortcut.
     */
    fun buildPrintJobRequest(
        printerUri: String,
        requestingUserName: String,
        jobName: String,
        documentFormat: String = "application/pdf",
        requestId: Int = 1,
        copies: Int? = null,
        sides: String? = null,
        orientationRequested: Int? = null,
        printColorMode: String? = null,
    ): ByteArray {
        val out = ByteArrayOutputStream()

        // version-number is 2 octets total (1 byte major + 1 byte minor), not two 2-byte shorts -
        // writeShort here would misalign every field that follows.
        out.write(IPP_VERSION_MAJOR)
        out.write(IPP_VERSION_MINOR)
        writeShort(out, OPERATION_ID_PRINT_JOB)
        writeInt(out, requestId)

        out.write(TAG_OPERATION_ATTRIBUTES)
        writeAttribute(out, TAG_CHARSET, "attributes-charset", "utf-8")
        writeAttribute(out, TAG_NATURAL_LANGUAGE, "attributes-natural-language", "en")
        writeAttribute(out, TAG_URI, "printer-uri", printerUri)
        writeAttribute(out, TAG_NAME_WITHOUT_LANGUAGE, "requesting-user-name", requestingUserName)
        writeAttribute(out, TAG_NAME_WITHOUT_LANGUAGE, "job-name", jobName)
        writeAttribute(out, TAG_MIME_MEDIA_TYPE, "document-format", documentFormat)
        if (copies != null) writeIntegerAttribute(out, TAG_INTEGER, "copies", copies)
        if (sides != null) writeAttribute(out, TAG_KEYWORD, "sides", sides)
        if (orientationRequested != null) {
            writeIntegerAttribute(out, TAG_ENUM, "orientation-requested", orientationRequested)
        }
        if (printColorMode != null) writeAttribute(out, TAG_KEYWORD, "print-color-mode", printColorMode)

        out.write(TAG_END_OF_ATTRIBUTES)

        return out.toByteArray()
    }

    /**
     * Cancel-Job (RFC 8011 section 4.3.3, operation-id 0x0008) targets a job the printer has
     * already accepted, identified by the job-id a prior Print-Job response returned. No document
     * body follows - see [IppHttpClient.cancelJob].
     */
    fun buildCancelJobRequest(
        printerUri: String,
        jobId: Int,
        requestingUserName: String,
        requestId: Int = 1,
    ): ByteArray {
        val out = ByteArrayOutputStream()

        out.write(IPP_VERSION_MAJOR)
        out.write(IPP_VERSION_MINOR)
        writeShort(out, OPERATION_ID_CANCEL_JOB)
        writeInt(out, requestId)

        out.write(TAG_OPERATION_ATTRIBUTES)
        writeAttribute(out, TAG_CHARSET, "attributes-charset", "utf-8")
        writeAttribute(out, TAG_NATURAL_LANGUAGE, "attributes-natural-language", "en")
        writeAttribute(out, TAG_URI, "printer-uri", printerUri)
        writeIntegerAttribute(out, TAG_INTEGER, "job-id", jobId)
        writeAttribute(out, TAG_NAME_WITHOUT_LANGUAGE, "requesting-user-name", requestingUserName)

        out.write(TAG_END_OF_ATTRIBUTES)

        return out.toByteArray()
    }

    /**
     * Get-Job-Attributes (RFC 8011 section 4.3.4, operation-id 0x0009) is polled after a
     * successful Print-Job to learn the printer's own job-state, since IPP's Print-Job response
     * only confirms the printer *accepted* the job, not that it has finished printing. No
     * requested-attributes is sent, so the printer returns its full default attribute set, which
     * always includes job-state - no document body follows, same as Cancel-Job.
     */
    fun buildGetJobAttributesRequest(
        printerUri: String,
        jobId: Int,
        requestingUserName: String,
        requestId: Int = 1,
    ): ByteArray {
        val out = ByteArrayOutputStream()

        out.write(IPP_VERSION_MAJOR)
        out.write(IPP_VERSION_MINOR)
        writeShort(out, OPERATION_ID_GET_JOB_ATTRIBUTES)
        writeInt(out, requestId)

        out.write(TAG_OPERATION_ATTRIBUTES)
        writeAttribute(out, TAG_CHARSET, "attributes-charset", "utf-8")
        writeAttribute(out, TAG_NATURAL_LANGUAGE, "attributes-natural-language", "en")
        writeAttribute(out, TAG_URI, "printer-uri", printerUri)
        writeIntegerAttribute(out, TAG_INTEGER, "job-id", jobId)
        writeAttribute(out, TAG_NAME_WITHOUT_LANGUAGE, "requesting-user-name", requestingUserName)

        out.write(TAG_END_OF_ATTRIBUTES)

        return out.toByteArray()
    }

    private fun writeAttribute(out: ByteArrayOutputStream, tag: Int, name: String, value: String) {
        out.write(tag)
        writeLengthPrefixed(out, name.toByteArray(StandardCharsets.UTF_8))
        writeLengthPrefixed(out, value.toByteArray(StandardCharsets.UTF_8))
    }

    private fun writeIntegerAttribute(out: ByteArrayOutputStream, tag: Int, name: String, value: Int) {
        out.write(tag)
        writeLengthPrefixed(out, name.toByteArray(StandardCharsets.UTF_8))
        writeShort(out, 4)
        writeInt(out, value)
    }

    private fun writeLengthPrefixed(out: ByteArrayOutputStream, bytes: ByteArray) {
        writeShort(out, bytes.size)
        out.write(bytes)
    }

    private fun writeShort(out: ByteArrayOutputStream, value: Int) {
        out.write((value ushr 8) and 0xFF)
        out.write(value and 0xFF)
    }

    private fun writeInt(out: ByteArrayOutputStream, value: Int) {
        out.write((value ushr 24) and 0xFF)
        out.write((value ushr 16) and 0xFF)
        out.write((value ushr 8) and 0xFF)
        out.write(value and 0xFF)
    }
}
