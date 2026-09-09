import { saveDocuments } from '@react-native-documents/picker';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { closePdfDocument, openPdfDocument, renderPdfPageToFile } from '../pdf/NativePdfiumModule';
import { extractAllTextFromPdf } from './NativePdfTextModule';
import { zipFiles } from './NativeZipModule';

/**
 * DPI for "export as images". Deliberately lower than the print pipeline's 300 DPI default
 * (see ../pdf/types.ts DEFAULT_PRINT_DPI): these PNGs are for viewing/archiving, not for feeding a
 * printer, so a smaller, faster-to-render, faster-to-zip file is the better tradeoff here.
 */
const EXPORT_IMAGE_DPI = 200;

export interface ExportImagesCallbacks {
  onPageRendered?: (currentPage: number, totalPages: number) => void;
  onZippingStart?: () => void;
  onSavingStart?: () => void;
}

export interface ExportTextCallbacks {
  onSavingStart?: () => void;
}

export class DocumentUnreadableError extends Error {
  constructor() {
    super('PDFium could not open this file. It may be corrupted or not a valid PDF.');
    this.name = 'DocumentUnreadableError';
  }
}

// fileName is typically derived from a file:// URI's last path segment (percent-encoded per RFC
// 3986), so it may still contain e.g. %20 - decode it for anything written as a new file name.
function safeDecodeFileName(rawName: string): string {
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function stripPdfExtension(name: string): string {
  return name.replace(/\.pdf$/i, '');
}

// saveDocuments' sourceUris must be percent-encoded URIs (it hands them straight to
// Uri.parse/ContentResolver on the native side), not plain filesystem paths.
function toFileUri(path: string): string {
  return `file://${encodeURI(path)}`;
}

async function openReadyDocument(filePath: string): Promise<{ handle: string; pageCount: number }> {
  const inspection = await openPdfDocument(filePath, null);
  if (!inspection.canOpen || !inspection.handle) {
    throw new DocumentUnreadableError();
  }
  return { handle: inspection.handle, pageCount: inspection.pageCount };
}

/**
 * Renders every page of the PDF at `filePath` to a PNG, zips them together (Android's
 * saveDocuments can only save one file per call), and lets the user pick where to save the zip.
 * Resolves with the suggested file name once the save dialog has been handed off.
 */
export async function exportPdfAsImages(
  filePath: string,
  fileName: string,
  callbacks: ExportImagesCallbacks = {},
): Promise<string> {
  const baseName = stripPdfExtension(safeDecodeFileName(fileName)) || 'document';
  const stamp = Date.now();
  const workDir = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/export-images-${stamp}`;
  await ReactNativeBlobUtil.fs.mkdir(workDir);

  const { handle, pageCount } = await openReadyDocument(filePath);
  try {
    const pagePaths: string[] = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const outputPath = `${workDir}/page-${String(pageIndex + 1).padStart(4, '0')}.png`;
      await renderPdfPageToFile(handle, pageIndex, EXPORT_IMAGE_DPI, outputPath);
      pagePaths.push(outputPath);
      callbacks.onPageRendered?.(pageIndex + 1, pageCount);
    }

    callbacks.onZippingStart?.();
    const zipFileName = `${baseName}-pages.zip`;
    const zipOutputPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${baseName}-pages-${stamp}.zip`;
    await zipFiles(pagePaths, zipOutputPath);

    callbacks.onSavingStart?.();
    await saveDocuments({
      sourceUris: [toFileUri(zipOutputPath)],
      mimeType: 'application/zip',
      fileName: zipFileName,
    });

    return zipFileName;
  } finally {
    await closePdfDocument(handle).catch(() => undefined);
  }
}

/**
 * Extracts the full plain text of the PDF at `filePath`, writes it to a .txt file, and lets the
 * user pick where to save it. Resolves with the suggested file name once the save dialog has been
 * handed off.
 */
export async function exportPdfAsText(
  filePath: string,
  fileName: string,
  callbacks: ExportTextCallbacks = {},
): Promise<string> {
  const baseName = stripPdfExtension(safeDecodeFileName(fileName)) || 'document';
  const stamp = Date.now();

  const { handle } = await openReadyDocument(filePath);
  try {
    const text = await extractAllTextFromPdf(handle);

    const outputPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${baseName}-${stamp}.txt`;
    await ReactNativeBlobUtil.fs.writeFile(outputPath, text, 'utf8');

    callbacks.onSavingStart?.();
    const txtFileName = `${baseName}.txt`;
    await saveDocuments({
      sourceUris: [toFileUri(outputPath)],
      mimeType: 'text/plain',
      fileName: txtFileName,
    });

    return txtFileName;
  } finally {
    await closePdfDocument(handle).catch(() => undefined);
  }
}
