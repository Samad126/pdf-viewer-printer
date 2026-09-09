package com.pdfprinter.printers.ipp

import java.nio.charset.StandardCharsets

private const val TAG_END_OF_ATTRIBUTES = 0x03
private const val MAX_GROUP_TAG = 0x0F
private const val TAG_INTEGER = 0x21
private const val TAG_ENUM = 0x23
private const val TAG_TEXT_WITHOUT_LANGUAGE = 0x41
private const val STATUS_MESSAGE_ATTRIBUTE_NAME = "status-message"
private const val JOB_ID_ATTRIBUTE_NAME = "job-id"
private const val JOB_STATE_ATTRIBUTE_NAME = "job-state"
private const val SUCCESSFUL_STATUS_MAX = 0x00FF
private const val MIN_RESPONSE_HEADER_SIZE = 8

// RFC 8011 section 5.3.7 job-state enum values. 7/8/9 are the only terminal states - a job in
// any other state (or one whose state this app never learned) is still treated as cancellable.
const val IPP_JOB_STATE_CANCELED = 7
const val IPP_JOB_STATE_ABORTED = 8
const val IPP_JOB_STATE_COMPLETED = 9

fun isTerminalJobState(jobState: Int): Boolean =
    jobState == IPP_JOB_STATE_CANCELED || jobState == IPP_JOB_STATE_ABORTED || jobState == IPP_JOB_STATE_COMPLETED

data class IppResponse(
    val statusCode: Int,
    val requestId: Int,
    val isSuccessful: Boolean,
    val statusMessage: String?,
    val jobId: Int?,
    val jobState: Int?,
)

/**
 * Parses just enough of an IPP response (RFC 8010 section 3.5 framing, RFC 8011 section 13.1.2
 * status codes) to know whether the job was accepted and, if not, why - plus the job-id a
 * successful Print-Job response returns (RFC 8011 section 5.2, job-attributes-group), which is
 * needed later to send a Cancel-Job for that job. Deliberately does not attempt to decode every
 * attribute of every group; it only walks far enough to pick out status-message and job-id.
 * Attribute values are only converted to a Kotlin type (String or Int) for the specific
 * (tag, name) pairs this parser actually cares about - every other attribute's raw bytes are
 * skipped over untouched, since blindly treating every value as UTF-8 text would garble any
 * integer/enum-tagged attribute value (job-id chief among them).
 */
object IppResponseParser {

    fun parse(bytes: ByteArray): IppResponse {
        if (bytes.size < MIN_RESPONSE_HEADER_SIZE) {
            return IppResponse(
                statusCode = -1,
                requestId = -1,
                isSuccessful = false,
                statusMessage = null,
                jobId = null,
                jobState = null,
            )
        }

        var offset = 2 // skip version-number
        val statusCode = readShort(bytes, offset)
        offset += 2
        val requestId = readInt(bytes, offset)
        offset += 4

        var statusMessage: String? = null
        var jobId: Int? = null
        var jobState: Int? = null
        var lastAttributeName: String? = null

        while (offset < bytes.size) {
            val tag = bytes[offset].toInt() and 0xFF
            offset += 1

            if (tag == TAG_END_OF_ATTRIBUTES) {
                break
            }
            if (tag <= MAX_GROUP_TAG) {
                // Group delimiter (operation-attributes-tag, job-attributes-tag, ...) - the
                // attributes belonging to it are just a normal run of value-tag/name/value
                // triples that follows, so nothing to consume here beyond the tag byte itself.
                lastAttributeName = null
                continue
            }

            if (offset + 2 > bytes.size) break
            val nameLength = readShort(bytes, offset)
            offset += 2

            val name: String?
            if (nameLength > 0) {
                if (offset + nameLength > bytes.size) break
                name = String(bytes, offset, nameLength, StandardCharsets.UTF_8)
                offset += nameLength
            } else {
                // Zero-length name means "additional value of the previous attribute" (a
                // multi-valued IPP attribute), per RFC 8010 section 3.5.
                name = lastAttributeName
            }
            lastAttributeName = name

            if (offset + 2 > bytes.size) break
            val valueLength = readShort(bytes, offset)
            offset += 2
            if (offset + valueLength > bytes.size) break
            val valueStart = offset
            offset += valueLength

            if (tag == TAG_INTEGER && name == JOB_ID_ATTRIBUTE_NAME && valueLength == 4) {
                jobId = readInt(bytes, valueStart)
            } else if (tag == TAG_ENUM && name == JOB_STATE_ATTRIBUTE_NAME && valueLength == 4) {
                jobState = readInt(bytes, valueStart)
            } else if (tag == TAG_TEXT_WITHOUT_LANGUAGE && name == STATUS_MESSAGE_ATTRIBUTE_NAME) {
                statusMessage = String(bytes, valueStart, valueLength, StandardCharsets.UTF_8)
            }
        }

        return IppResponse(
            statusCode = statusCode,
            requestId = requestId,
            isSuccessful = statusCode in 0..SUCCESSFUL_STATUS_MAX,
            statusMessage = statusMessage,
            jobId = jobId,
            jobState = jobState,
        )
    }

    private fun readShort(bytes: ByteArray, offset: Int): Int =
        ((bytes[offset].toInt() and 0xFF) shl 8) or (bytes[offset + 1].toInt() and 0xFF)

    private fun readInt(bytes: ByteArray, offset: Int): Int =
        ((bytes[offset].toInt() and 0xFF) shl 24) or
            ((bytes[offset + 1].toInt() and 0xFF) shl 16) or
            ((bytes[offset + 2].toInt() and 0xFF) shl 8) or
            (bytes[offset + 3].toInt() and 0xFF)
}
