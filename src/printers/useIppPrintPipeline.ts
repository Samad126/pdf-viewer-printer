import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelRebuild } from '../pdf/NativePdfRebuildModule';
import { cancelPrintJob, cancelSubmit, getJobStatus, runIppPrintPipeline } from './IppPrintOrchestrator';
import {
  INITIAL_IPP_PRINT_PIPELINE_STATE,
  IPP_REQUESTING_USER_NAME,
  IppPrintErrorKind,
  IppPrintOptions,
  IppPrintPipelineState,
  IppPrinterTarget,
  isTerminalJobState,
} from './types';

const JOB_STATUS_POLL_INTERVAL_MS = 4000;

export interface UseIppPrintPipelineResult {
  state: IppPrintPipelineState;
  startPrint: (
    filePath: string,
    jobName: string,
    target: IppPrinterTarget,
    printOptions: IppPrintOptions,
    password?: string | null,
  ) => Promise<void>;
  /**
   * Cancels whatever this pipeline is currently doing, if anything is cancellable: while
   * rasterizing, stops the native rebuild loop; while submitting, tears down the in-flight HTTP
   * connection; once the printer has already accepted the job (stage 'done' with a jobId), sends
   * IPP Cancel-Job instead. A no-op if nothing cancellable is in progress.
   */
  cancel: () => Promise<void>;
  reset: () => void;
}

// RN's native-module bridge attaches the native reject() code to the rejected JS Error as
// `.code` (see PromiseImpl.kt's ERROR_MAP_KEY_CODE = "code", merged onto the Error object by
// NativeModules.js's updateErrorWithErrorData), so this is what IppPrintModule's E_* codes show
// up as here.
function errorCodeOf(error: unknown): string | undefined {
  return error instanceof Error ? (error as Error & { code?: unknown }).code as string | undefined : undefined;
}

function errorKindFor(error: unknown): IppPrintErrorKind {
  switch (errorCodeOf(error)) {
    case 'E_PRINTER_UNREACHABLE':
      return 'unreachable';
    case 'E_PRINTER_TIMEOUT':
      return 'timeout';
    case 'E_IPP_REJECTED':
      return 'rejected';
    case 'E_DISCOVERY_PERMISSION_DENIED':
      return 'permission_denied';
    default:
      return 'unknown';
  }
}

function isCancelledError(error: unknown): boolean {
  return errorCodeOf(error) === 'E_CANCELLED';
}

export function useIppPrintPipeline(): UseIppPrintPipelineResult {
  const [state, setState] = useState<IppPrintPipelineState>(INITIAL_IPP_PRINT_PIPELINE_STATE);

  // Mirrors of the fields the cancel() action needs. Kept in refs, not state, since updating them
  // must never itself trigger a re-render - only the corresponding setState calls below do that.
  const stageRef = useRef<IppPrintPipelineState['stage']>('idle');
  const handleRef = useRef<string | null>(null);
  const requestTokenRef = useRef<string | null>(null);
  const targetRef = useRef<IppPrinterTarget | null>(null);
  const jobIdRef = useRef<number | null>(null);

  const applyState = useCallback((updater: (previous: IppPrintPipelineState) => IppPrintPipelineState) => {
    setState(previous => {
      const next = updater(previous);
      stageRef.current = next.stage;
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    handleRef.current = null;
    requestTokenRef.current = null;
    targetRef.current = null;
    jobIdRef.current = null;
    stageRef.current = 'idle';
    setState(INITIAL_IPP_PRINT_PIPELINE_STATE);
  }, []);

  const startPrint = useCallback(
    async (
      filePath: string,
      jobName: string,
      target: IppPrinterTarget,
      printOptions: IppPrintOptions,
      password: string | null = null,
    ) => {
      handleRef.current = null;
      requestTokenRef.current = null;
      jobIdRef.current = null;
      targetRef.current = target;
      applyState(() => ({ ...INITIAL_IPP_PRINT_PIPELINE_STATE, stage: 'inspecting' }));

      try {
        const result = await runIppPrintPipeline(filePath, target, {
          password,
          jobName,
          printOptions,
          callbacks: {
            onInspected: inspection => {
              applyState(previous => ({ ...previous, stage: 'rasterizing', totalPages: inspection.pageCount }));
            },
            onPageProgress: event => {
              applyState(previous => ({
                ...previous,
                currentPage: event.pageIndex + 1,
                totalPages: event.totalPages,
              }));
            },
            onRebuildComplete: () => {
              applyState(previous => ({ ...previous, stage: 'submitting' }));
            },
            onRequestPrepared: info => {
              handleRef.current = info.handle;
              requestTokenRef.current = info.requestToken;
            },
          },
        });

        jobIdRef.current = result.submitResult.jobId;
        applyState(previous => ({
          ...previous,
          stage: 'done',
          submitResult: result.submitResult,
          jobId: result.submitResult.jobId,
        }));
      } catch (error) {
        if (isCancelledError(error)) {
          applyState(previous => ({ ...previous, stage: 'cancelled' }));
          return;
        }
        applyState(previous => ({
          ...previous,
          stage: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
          errorKind: errorKindFor(error),
        }));
      }
    },
    [applyState],
  );

  const cancel = useCallback(async () => {
    const stage = stageRef.current;

    if (stage === 'rasterizing') {
      const handle = handleRef.current;
      if (handle == null) return;
      // The rebuild loop notices this flag on its own and rejects its own promise with
      // E_CANCELLED, which startPrint's catch block above turns into stage 'cancelled' - cancel()
      // itself only has to ask for that to happen, not drive the state transition.
      await cancelRebuild(handle).catch(() => undefined);
      return;
    }

    if (stage === 'submitting') {
      const requestToken = requestTokenRef.current;
      if (requestToken == null) return;
      await cancelSubmit(requestToken).catch(() => undefined);
      return;
    }

    if (stage === 'done' && jobIdRef.current != null && targetRef.current != null) {
      try {
        await cancelPrintJob(targetRef.current, jobIdRef.current, IPP_REQUESTING_USER_NAME);
        applyState(previous => ({ ...previous, stage: 'cancelled' }));
      } catch (error) {
        applyState(previous => ({
          ...previous,
          stage: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
          errorKind: errorKindFor(error),
        }));
      }
    }
  }, [applyState]);

  // Print-Job's response only confirms the printer *accepted* the job (stage 'done'), not that
  // it has actually finished printing - the job could still be queued or in progress for a
  // while. Poll Get-Job-Attributes until the printer reports a terminal state so the UI can stop
  // offering Cancel once there's genuinely nothing left to cancel. If the printer doesn't
  // support Get-Job-Attributes (or the first poll otherwise fails), jobState just stays null and
  // the UI falls back to its previous always-cancellable-while-done behaviour.
  useEffect(() => {
    if (state.stage !== 'done' || jobIdRef.current == null || targetRef.current == null) {
      return undefined;
    }
    const target = targetRef.current;
    const jobId = jobIdRef.current;
    let cancelledEffect = false;

    const poll = async () => {
      try {
        const status = await getJobStatus(target, jobId, IPP_REQUESTING_USER_NAME);
        if (cancelledEffect) return;
        if (!status.success) {
          clearInterval(intervalId);
          return;
        }
        if (status.jobState != null) {
          applyState(previous => ({ ...previous, jobState: status.jobState }));
          if (isTerminalJobState(status.jobState)) {
            clearInterval(intervalId);
          }
        }
      } catch {
        if (!cancelledEffect) clearInterval(intervalId);
      }
    };

    const intervalId: ReturnType<typeof setInterval> = setInterval(poll, JOB_STATUS_POLL_INTERVAL_MS);
    poll().catch(() => undefined);

    return () => {
      cancelledEffect = true;
      clearInterval(intervalId);
    };
  }, [state.stage, applyState]);

  return { state, startPrint, cancel, reset };
}
