import { closePdfDocument } from '../pdf/NativePdfiumModule';
import type { PdfInspectionResult, PdfRebuildProgressEvent, PdfRebuildResult } from '../pdf/types';
import { DocumentUnreadableError, PasswordRequiredError, prepareRebuiltPdf } from '../print/PrintOrchestrator';
import { cancelPrintJob, cancelSubmit, getJobStatus, submitPrintJob } from './NativeIppPrintModule';
import { parsePageRangeInput } from './pageRange';
import type { IppPrintOptions, IppPrinterTarget, IppSubmitResult } from './types';

export { PasswordRequiredError, DocumentUnreadableError, cancelPrintJob, cancelSubmit, getJobStatus };

export interface IppRequestPreparedInfo {
  handle: string;
  requestToken: string;
}

export interface IppPrintPipelineCallbacks {
  onInspected?: (inspection: PdfInspectionResult) => void;
  onPageProgress?: (event: PdfRebuildProgressEvent) => void;
  onRebuildComplete?: (rebuild: PdfRebuildResult) => void;
  /**
   * Fired once the PDFium handle is known and a fresh requestToken has been generated, right
   * before the rebuilt PDF is handed to submitPrintJob - this is the seam a caller needs to learn
   * both values in order to later call cancelRebuild(handle) or cancelSubmit(requestToken).
   */
  onRequestPrepared?: (info: IppRequestPreparedInfo) => void;
}

export interface IppPrintPipelineOptions {
  password?: string | null;
  dpi?: number;
  jobName?: string;
  printOptions: IppPrintOptions;
  callbacks?: IppPrintPipelineCallbacks;
}

export interface IppPrintPipelineResult {
  inspection: PdfInspectionResult;
  rebuild: PdfRebuildResult;
  submitResult: IppSubmitResult;
}

/**
 * Runs the same inspect -> rasterize -> rebuild pipeline as PrintOrchestrator's runPrintPipeline
 * (reusing prepareRebuiltPdf rather than duplicating it), then submits the rebuilt PDF directly
 * to a printer's IPP endpoint over plain HTTP via IppPrintModule instead of handing it to
 * android.print.PrintManager. This never touches PrintModule/PdfPrintDocumentAdapter, so the
 * existing PrintManager-based flow is unaffected.
 *
 * The requested page range (`printOptions.pageRange`) is resolved into concrete page indices and
 * handed to prepareRebuiltPdf so only the selected pages are ever rasterized - the printer never
 * sees an IPP page-ranges attribute, since this app controls exactly which pages get sent rather
 * than trusting a printer to honour one.
 */
export async function runIppPrintPipeline(
  sourceFilePath: string,
  target: IppPrinterTarget,
  options: IppPrintPipelineOptions,
): Promise<IppPrintPipelineResult> {
  const jobName = options.jobName ?? safeDecodeFileName(sourceFilePath.split('/').pop() ?? 'Document');
  const printOptions = options.printOptions;

  const { inspection, rebuild, handle } = await prepareRebuiltPdf(sourceFilePath, {
    password: options.password,
    dpi: options.dpi,
    callbacks: options.callbacks,
    resolvePageIndices: pageCount => parsePageRangeInput(printOptions.pageRange, pageCount),
  });

  try {
    const requestToken = generateRequestToken();
    options.callbacks?.onRequestPrepared?.({ handle, requestToken });
    const submitResult = await submitPrintJob(target, rebuild.outputPath, jobName, requestToken, printOptions);
    return { inspection, rebuild, submitResult };
  } finally {
    await closePdfDocument(handle).catch(() => undefined);
  }
}

// No UUID-capable dependency is otherwise pulled into this project, and a full UUID isn't needed
// here - the token only has to be unique enough to identify one in-flight HTTP connection in
// IppCancellationRegistry, so 16 random bytes as hex is sufficient.
function generateRequestToken(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// sourceFilePath is typically a file:// URI (percent-encoded per RFC 3986), so a raw path
// segment can still contain %20 etc. - decode it for anything shown to the user or sent as the
// IPP job-name.
function safeDecodeFileName(rawSegment: string): string {
  try {
    return decodeURIComponent(rawSegment);
  } catch {
    return rawSegment;
  }
}
