import ReactNativeBlobUtil from 'react-native-blob-util';
import { closePdfDocument, openPdfDocument } from '../pdf/NativePdfiumModule';
import { buildPrintReadyPdf, subscribeToRebuildProgress } from '../pdf/NativePdfRebuildModule';
import { DEFAULT_PRINT_DPI } from '../pdf/types';
import type { PdfInspectionResult, PdfRebuildProgressEvent, PdfRebuildResult } from '../pdf/types';
import { printPdf } from './NativePrintModule';

export interface PrintPipelineCallbacks {
  onInspected?: (inspection: PdfInspectionResult) => void;
  onPageProgress?: (event: PdfRebuildProgressEvent) => void;
  onRebuildComplete?: (rebuild: PdfRebuildResult) => void;
}

export interface PrintPipelineOptions {
  password?: string | null;
  dpi?: number;
  jobName?: string;
  callbacks?: PrintPipelineCallbacks;
  /**
   * Optional hook called right after inspection succeeds (so `pageCount` is known) to compute
   * which 0-based page indices to pass into buildPrintReadyPdf. Returning `undefined` (or leaving
   * this unset) processes every page, unchanged from this pipeline's original behaviour - only
   * the direct-IPP pipeline currently supplies this, so runPrintPipeline (the PrintManager flow)
   * is unaffected.
   */
  resolvePageIndices?: (pageCount: number) => number[] | undefined;
}

export interface PrintPipelineResult {
  inspection: PdfInspectionResult;
  rebuild: PdfRebuildResult;
  printJobId: string | null;
}

export interface PrintReadyPdf {
  inspection: PdfInspectionResult;
  rebuild: PdfRebuildResult;
  handle: string;
}

class PasswordRequiredError extends Error {
  constructor(public readonly passwordIncorrect: boolean) {
    super(passwordIncorrect ? 'Incorrect password for this PDF.' : 'This PDF requires a password.');
    this.name = 'PasswordRequiredError';
  }
}

class DocumentUnreadableError extends Error {
  constructor() {
    super('PDFium could not open this file. It may be corrupted or not a valid PDF.');
    this.name = 'DocumentUnreadableError';
  }
}

export { PasswordRequiredError, DocumentUnreadableError };

// sourceFilePath is typically a file:// URI (percent-encoded per RFC 3986), so a raw
// path segment can still contain %20 etc. - decode it for anything shown to the user or
// written as a new file name.
function safeDecodeFileName(rawSegment: string): string {
  try {
    return decodeURIComponent(rawSegment);
  } catch {
    return rawSegment;
  }
}

function buildOutputPath(sourceFilePath: string): string {
  const baseName = safeDecodeFileName(sourceFilePath.split('/').pop() ?? 'document.pdf');
  const stamp = Date.now();
  return `${ReactNativeBlobUtil.fs.dirs.CacheDir}/print-ready-${stamp}-${baseName}`;
}

/**
 * Runs the inspect -> rasterize -> rebuild portion of the print pipeline only: opens the PDFium
 * document, surfaces password/unreadable errors, and produces the rebuilt, font-free PDF. Leaves
 * the PDFium handle open on success (the caller decides when to close it, since it may still be
 * needed - e.g. by both the PrintManager path and the direct-IPP path built on top of this
 * helper) and does not submit anything to a printer. On failure *after* the handle has been
 * opened, this still closes it before rethrowing, matching the cleanup guarantee
 * runPrintPipeline has always made.
 */
export async function prepareRebuiltPdf(
  sourceFilePath: string,
  options: PrintPipelineOptions = {},
): Promise<PrintReadyPdf> {
  const dpi = options.dpi ?? DEFAULT_PRINT_DPI;
  const password = options.password ?? null;

  const inspection = await openPdfDocument(sourceFilePath, password);
  options.callbacks?.onInspected?.(inspection);

  if (inspection.requiresPassword && !inspection.canOpen) {
    throw new PasswordRequiredError(inspection.passwordIncorrect);
  }
  if (!inspection.canOpen || !inspection.handle) {
    throw new DocumentUnreadableError();
  }

  const handle = inspection.handle;
  const pageIndices = options.resolvePageIndices?.(inspection.pageCount) ?? null;
  const unsubscribe = options.callbacks?.onPageProgress
    ? subscribeToRebuildProgress(options.callbacks.onPageProgress)
    : null;

  try {
    const outputPath = buildOutputPath(sourceFilePath);
    const rebuild = await buildPrintReadyPdf(handle, dpi, outputPath, pageIndices);
    options.callbacks?.onRebuildComplete?.(rebuild);
    return { inspection, rebuild, handle };
  } catch (error) {
    await closePdfDocument(handle).catch(() => undefined);
    throw error;
  } finally {
    unsubscribe?.();
  }
}

/**
 * Runs the full rasterize -> rebuild -> print pipeline for a single PDF file. Never touches
 * android.graphics.pdf.PdfRenderer: rasterization goes through PdfiumModule/PdfRebuildModule,
 * which are backed by PDFium.
 */
export async function runPrintPipeline(
  sourceFilePath: string,
  options: PrintPipelineOptions = {},
): Promise<PrintPipelineResult> {
  const jobName = options.jobName ?? safeDecodeFileName(sourceFilePath.split('/').pop() ?? 'Document');
  const { inspection, rebuild, handle } = await prepareRebuiltPdf(sourceFilePath, options);

  try {
    const printJob = await printPdf(rebuild.outputPath, jobName, rebuild.pageCount);
    return { inspection, rebuild, printJobId: printJob.jobId };
  } finally {
    await closePdfDocument(handle).catch(() => undefined);
  }
}
