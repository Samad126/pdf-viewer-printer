package com.pdfprinter.pdf

data class PdfPermissionInfo(
    val isEncrypted: Boolean,
    val encryptionVersion: Int,
    val securityHandlerRevision: Int,
    val canPrint: Boolean,
    val canPrintHighRes: Boolean,
    val canModify: Boolean,
    val canCopy: Boolean,
    val canModifyAnnotations: Boolean,
    val canFillForms: Boolean,
    val canExtractForAccessibility: Boolean,
    val canAssemble: Boolean,
) {
    companion object {
        val UNRESTRICTED = PdfPermissionInfo(
            isEncrypted = false,
            encryptionVersion = 0,
            securityHandlerRevision = 0,
            canPrint = true,
            canPrintHighRes = true,
            canModify = true,
            canCopy = true,
            canModifyAnnotations = true,
            canFillForms = true,
            canExtractForAccessibility = true,
            canAssemble = true,
        )
    }
}
