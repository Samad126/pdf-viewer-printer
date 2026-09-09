import { NativeModules } from 'react-native';
import type { PdfInspectionResult, PdfPageSize, PdfRenderedPage } from './types';

interface PdfiumModuleInterface {
  openDocument(filePath: string, password: string | null): Promise<PdfInspectionResult>;
  closeDocument(handle: string): Promise<void>;
  getPageSize(handle: string, pageIndex: number, dpi: number): Promise<PdfPageSize>;
  renderPageToFile(
    handle: string,
    pageIndex: number,
    dpi: number,
    outputPath: string,
  ): Promise<PdfRenderedPage>;
}

const PdfiumModule = NativeModules.PdfiumModule as PdfiumModuleInterface | undefined;

function requireModule(): PdfiumModuleInterface {
  if (!PdfiumModule) {
    throw new Error(
      'PdfiumModule native module is not available. Did you forget to run a native (non-Expo Go) build?',
    );
  }
  return PdfiumModule;
}

export function openPdfDocument(
  filePath: string,
  password: string | null = null,
): Promise<PdfInspectionResult> {
  return requireModule().openDocument(filePath, password);
}

export function closePdfDocument(handle: string): Promise<void> {
  return requireModule().closeDocument(handle);
}

export function getPdfPageSize(handle: string, pageIndex: number, dpi: number): Promise<PdfPageSize> {
  return requireModule().getPageSize(handle, pageIndex, dpi);
}

export function renderPdfPageToFile(
  handle: string,
  pageIndex: number,
  dpi: number,
  outputPath: string,
): Promise<PdfRenderedPage> {
  return requireModule().renderPageToFile(handle, pageIndex, dpi, outputPath);
}
