export interface PdfFindMatch {
  pageIndex: number;
  snippet: string;
}

export type ExportKind = 'images' | 'text';

export type ExportStage = 'idle' | 'rendering' | 'zipping' | 'saving' | 'done' | 'error';

export interface ExportPipelineState {
  stage: ExportStage;
  kind: ExportKind | null;
  currentPage: number;
  totalPages: number;
  errorMessage: string | null;
  outputName: string | null;
}

export const INITIAL_EXPORT_PIPELINE_STATE: ExportPipelineState = {
  stage: 'idle',
  kind: null,
  currentPage: 0,
  totalPages: 0,
  errorMessage: null,
  outputName: null,
};
