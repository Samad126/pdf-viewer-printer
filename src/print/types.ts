import type { PdfInspectionResult, PdfPageResult } from '../pdf/types';

export type PrintStage =
  | 'idle'
  | 'inspecting'
  | 'rasterizing'
  | 'submitting'
  | 'done'
  | 'error';

export interface PrintPipelineState {
  stage: PrintStage;
  inspection: PdfInspectionResult | null;
  currentPage: number;
  totalPages: number;
  pageResults: PdfPageResult[];
  errorMessage: string | null;
  rebuiltPdfPath: string | null;
  printJobId: string | null;
}

export const INITIAL_PRINT_PIPELINE_STATE: PrintPipelineState = {
  stage: 'idle',
  inspection: null,
  currentPage: 0,
  totalPages: 0,
  pageResults: [],
  errorMessage: null,
  rebuiltPdfPath: null,
  printJobId: null,
};
