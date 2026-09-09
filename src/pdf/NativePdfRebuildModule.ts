import { NativeEventEmitter, NativeModules } from 'react-native';
import type { PdfRebuildProgressEvent, PdfRebuildResult } from './types';

interface PdfRebuildModuleInterface {
  buildPrintReadyPdf(
    handle: string,
    dpi: number,
    outputPath: string,
    pageIndices: number[] | null,
  ): Promise<PdfRebuildResult>;
  cancelRebuild(handle: string): Promise<void>;
}

const PdfRebuildModule = NativeModules.PdfRebuildModule as PdfRebuildModuleInterface | undefined;
const REBUILD_PROGRESS_EVENT = 'PdfPrinter:RebuildProgress';

type RebuildEventMap = Record<typeof REBUILD_PROGRESS_EVENT, [PdfRebuildProgressEvent]>;

function requireModule(): PdfRebuildModuleInterface {
  if (!PdfRebuildModule) {
    throw new Error(
      'PdfRebuildModule native module is not available. Did you forget to run a native (non-Expo Go) build?',
    );
  }
  return PdfRebuildModule;
}

export function buildPrintReadyPdf(
  handle: string,
  dpi: number,
  outputPath: string,
  pageIndices: number[] | null = null,
): Promise<PdfRebuildResult> {
  return requireModule().buildPrintReadyPdf(handle, dpi, outputPath, pageIndices);
}

/**
 * Requests that an in-progress buildPrintReadyPdf call for this handle stop after its current
 * page. That call's own promise then rejects with an E_CANCELLED error code instead of resolving.
 */
export function cancelRebuild(handle: string): Promise<void> {
  return requireModule().cancelRebuild(handle);
}

/**
 * Subscribes to per-page rebuild progress (including per-page failures) as they happen, rather
 * than waiting for buildPrintReadyPdf's promise to resolve with the full summary at the end.
 * Returns an unsubscribe function.
 */
export function subscribeToRebuildProgress(
  listener: (event: PdfRebuildProgressEvent) => void,
): () => void {
  if (!PdfRebuildModule) {
    return () => {};
  }
  const emitter = new NativeEventEmitter<RebuildEventMap>(NativeModules.PdfRebuildModule);
  const subscription = emitter.addListener(REBUILD_PROGRESS_EVENT, event => listener(event));
  return () => subscription.remove();
}
