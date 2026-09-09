import { useCallback, useState } from 'react';
import { exportPdfAsImages, exportPdfAsText } from './exportPdf';
import { ExportPipelineState, INITIAL_EXPORT_PIPELINE_STATE } from './types';

export interface UseExportPdfResult {
  state: ExportPipelineState;
  exportAsImages: (filePath: string, fileName: string, pageCount: number) => Promise<void>;
  exportAsText: (filePath: string, fileName: string, pageCount: number) => Promise<void>;
  reset: () => void;
}

/**
 * Mirrors ../print/usePrintPipeline.ts's stage-based-state-machine shape for the export flows.
 * `pageCount` is only used to seed `totalPages` for immediate UI feedback before this hook's own
 * PDFium handle finishes opening - once open, the freshly-inspected document's own page count is
 * the source of truth for how many pages actually get rendered.
 */
export function useExportPdf(): UseExportPdfResult {
  const [state, setState] = useState<ExportPipelineState>(INITIAL_EXPORT_PIPELINE_STATE);

  const reset = useCallback(() => {
    setState(INITIAL_EXPORT_PIPELINE_STATE);
  }, []);

  const exportAsImages = useCallback(async (filePath: string, fileName: string, pageCount: number) => {
    setState({ ...INITIAL_EXPORT_PIPELINE_STATE, stage: 'rendering', kind: 'images', totalPages: pageCount });

    try {
      const outputName = await exportPdfAsImages(filePath, fileName, {
        onPageRendered: (currentPage, totalPages) => {
          setState(previous => ({ ...previous, stage: 'rendering', currentPage, totalPages }));
        },
        onZippingStart: () => {
          setState(previous => ({ ...previous, stage: 'zipping' }));
        },
        onSavingStart: () => {
          setState(previous => ({ ...previous, stage: 'saving' }));
        },
      });
      setState(previous => ({ ...previous, stage: 'done', outputName }));
    } catch (error) {
      setState(previous => ({
        ...previous,
        stage: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  const exportAsText = useCallback(async (filePath: string, fileName: string, pageCount: number) => {
    setState({ ...INITIAL_EXPORT_PIPELINE_STATE, stage: 'rendering', kind: 'text', totalPages: pageCount });

    try {
      const outputName = await exportPdfAsText(filePath, fileName, {
        onSavingStart: () => {
          setState(previous => ({ ...previous, stage: 'saving' }));
        },
      });
      setState(previous => ({ ...previous, stage: 'done', outputName }));
    } catch (error) {
      setState(previous => ({
        ...previous,
        stage: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  return { state, exportAsImages, exportAsText, reset };
}
