export interface IppDiscoveredPrinter {
  name: string;
  host: string;
  port: number;
  resourcePath: string;
  txtRecord: Record<string, string>;
}

export interface IppPrinterTarget {
  host: string;
  port: number;
  resourcePath: string;
}

export interface IppSubmitResult {
  success: boolean;
  statusCode: number;
  statusMessage: string | null;
  jobId: number | null;
}

// RFC 8011 section 5.3.7 job-state enum values used by getJobStatus polling. Only these three
// are terminal - anything else (pending/pending-held/processing/processing-stopped) still counts
// as cancellable/in-progress.
export const IPP_JOB_STATE_CANCELED = 7;
export const IPP_JOB_STATE_ABORTED = 8;
export const IPP_JOB_STATE_COMPLETED = 9;

export function isTerminalJobState(jobState: number): boolean {
  return (
    jobState === IPP_JOB_STATE_CANCELED ||
    jobState === IPP_JOB_STATE_ABORTED ||
    jobState === IPP_JOB_STATE_COMPLETED
  );
}

export interface IppJobStatus {
  success: boolean;
  jobState: number | null;
  statusMessage: string | null;
}

export type IppDiscoveryStage = 'idle' | 'discovering' | 'stopped' | 'unavailable';

export interface IppDiscoveryState {
  stage: IppDiscoveryStage;
  printers: IppDiscoveredPrinter[];
  errorMessage: string | null;
}

export const INITIAL_IPP_DISCOVERY_STATE: IppDiscoveryState = {
  stage: 'idle',
  printers: [],
  errorMessage: null,
};

/**
 * Matches the options Android's own print dialog offers. `sides` uses the actual IPP/1.1 keyword
 * values (RFC 8011 section 5.2.4) verbatim, since they are passed straight through to
 * IppEncoder.buildPrintJobRequest with no remapping.
 */
export interface IppPrintOptions {
  copies: number;
  pageRange: string;
  colorMode: 'color' | 'monochrome';
  sides: 'one-sided' | 'two-sided-long-edge' | 'two-sided-short-edge';
  orientation: 'portrait' | 'landscape';
}

export const DEFAULT_IPP_PRINT_OPTIONS: IppPrintOptions = {
  copies: 1,
  pageRange: '',
  colorMode: 'color',
  sides: 'one-sided',
  orientation: 'portrait',
};

// The native side hardcodes this same literal as the IPP requesting-user-name for submitPrintJob
// (see IppHttpClient.submitPrintJob) - a later cancelPrintJob call has to send the same value so
// the printer recognises it as coming from the job's owner.
export const IPP_REQUESTING_USER_NAME = 'PDFPrinter';

export type IppPrintStage =
  | 'idle'
  | 'inspecting'
  | 'rasterizing'
  | 'submitting'
  | 'done'
  | 'cancelled'
  | 'error';

export type IppPrintErrorKind = 'unreachable' | 'timeout' | 'rejected' | 'permission_denied' | 'unknown';

export interface IppPrintPipelineState {
  stage: IppPrintStage;
  totalPages: number;
  currentPage: number;
  errorMessage: string | null;
  errorKind: IppPrintErrorKind | null;
  submitResult: IppSubmitResult | null;
  jobId: number | null;
  // null until the first successful getJobStatus poll after the printer accepts the job (or
  // forever, if the printer doesn't support Get-Job-Attributes) - see useIppPrintPipeline.
  jobState: number | null;
}

export const INITIAL_IPP_PRINT_PIPELINE_STATE: IppPrintPipelineState = {
  stage: 'idle',
  totalPages: 0,
  currentPage: 0,
  errorMessage: null,
  errorKind: null,
  submitResult: null,
  jobId: null,
  jobState: null,
};
