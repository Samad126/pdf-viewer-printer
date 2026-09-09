import { useCallback, useRef, useState } from 'react';
import type { PdfPageResult } from '../pdf/types';
import { runPrintPipeline } from './PrintOrchestrator';
import { INITIAL_PRINT_PIPELINE_STATE, PrintPipelineState } from './types';

export interface UsePrintPipelineResult {
  state: PrintPipelineState;
  startPrint: (filePath: string, jobName: string, password?: string | null) => Promise<void>;
  reset: () => void;
}

export function usePrintPipeline(): UsePrintPipelineResult {
  const [state, setState] = useState<PrintPipelineState>(INITIAL_PRINT_PIPELINE_STATE);
  const pageResultsRef = useRef<PdfPageResult[]>([]);

  const reset = useCallback(() => {
    pageResultsRef.current = [];
    setState(INITIAL_PRINT_PIPELINE_STATE);
  }, []);

  const startPrint = useCallback(async (filePath: string, jobName: string, password: string | null = null) => {
    pageResultsRef.current = [];
    setState({ ...INITIAL_PRINT_PIPELINE_STATE, stage: 'inspecting' });

    try {
      const result = await runPrintPipeline(filePath, {
        password,
        jobName,
        callbacks: {
          onInspected: inspection => {
            setState(previous => ({
              ...previous,
              stage: 'rasterizing',
              inspection,
              totalPages: inspection.pageCount,
            }));
          },
          onPageProgress: event => {
            pageResultsRef.current = [
              ...pageResultsRef.current,
              { pageIndex: event.pageIndex, success: event.success, error: event.error ?? undefined },
            ];
            setState(previous => ({
              ...previous,
              currentPage: event.pageIndex + 1,
              totalPages: event.totalPages,
              pageResults: pageResultsRef.current,
            }));
          },
          onRebuildComplete: () => {
            setState(previous => ({ ...previous, stage: 'submitting' }));
          },
        },
      });

      setState(previous => ({
        ...previous,
        stage: 'done',
        pageResults: result.rebuild.pageResults,
        rebuiltPdfPath: result.rebuild.outputPath,
        printJobId: result.printJobId,
      }));
    } catch (error) {
      setState(previous => ({
        ...previous,
        stage: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  return { state, startPrint, reset };
}
