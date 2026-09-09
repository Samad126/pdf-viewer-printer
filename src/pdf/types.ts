/**
 * Permission flags come from a direct read of the PDF's own /Encrypt dictionary rather than a
 * PDFium API call - see the comment on PdfPermissionInspector.kt for why. `isEncrypted` is
 * corroborated by PDFium's own open-with-password behaviour in PdfiumModule.
 */
export interface PdfPermissionInfo {
  isEncrypted: boolean;
  encryptionVersion: number;
  securityHandlerRevision: number;
  canPrint: boolean;
  canPrintHighRes: boolean;
  canModify: boolean;
  canCopy: boolean;
  canModifyAnnotations: boolean;
  canFillForms: boolean;
  canExtractForAccessibility: boolean;
  canAssemble: boolean;
}

export interface PdfInspectionResult extends PdfPermissionInfo {
  /** Opaque id for the open PDFium document. Null when the document could not be opened. */
  handle: string | null;
  canOpen: boolean;
  pageCount: number;
  requiresPassword: boolean;
  passwordIncorrect: boolean;
}

export interface PdfPageSize {
  width: number;
  height: number;
}

export interface PdfRenderedPage {
  pageIndex: number;
  width: number;
  height: number;
  outputPath: string;
}

export interface PdfPageResult {
  pageIndex: number;
  success: boolean;
  error?: string;
}

export interface PdfRebuildResult {
  outputPath: string;
  pageCount: number;
  succeededPages: number;
  failedPages: number;
  pageResults: PdfPageResult[];
}

export interface PdfRebuildProgressEvent {
  pageIndex: number;
  totalPages: number;
  success: boolean;
  error: string | null;
}

/** Default print resolution. 300 DPI is the usual "looks sharp on paper" threshold. */
export const DEFAULT_PRINT_DPI = 300;
