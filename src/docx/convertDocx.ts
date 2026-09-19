import ReactNativeBlobUtil from 'react-native-blob-util';
import { resolveLocalPath } from '../files/localPath';
import { buildConversionCacheKey, convertedPdfPath } from './conversionPaths';
import { toPdfFileName } from './documentTypes';
import { convertDocxToPdf } from './NativeDocxModule';

export interface ConvertedDocument {
  /** file:// path to the PDF, ready to hand to the viewer. */
  uri: string;
  /** The PDF's display name - `Report.docx` becomes `Report.pdf`. */
  name: string;
  /** True when this was already converted and came back from the cache. */
  cached: boolean;
}

/** Thrown for a conversion the user asked to cancel, so callers can stay quiet about it. */
export class DocxConversionCancelledError extends Error {
  constructor() {
    super('Conversion cancelled');
    this.name = 'DocxConversionCancelledError';
  }
}

const CANCELLED_ERROR_CODE = 'E_CANCELLED';

/**
 * Converts a .docx to a PDF, reusing a previous conversion of the same unchanged file.
 *
 * The cache is keyed on the source path, size and modification time, so editing a document and
 * reopening it re-renders rather than showing the old rendering. Nothing invalidates these files
 * - they live in the cache directory, which the OS is free to clear, and every one of them is
 * reproducible from its source.
 */
export async function convertDocxFile(docxUri: string, displayName: string): Promise<ConvertedDocument> {
  const sourcePath = resolveLocalPath(docxUri);
  const cacheDir = ReactNativeBlobUtil.fs.dirs.CacheDir;
  const name = toPdfFileName(displayName);

  // A source that cannot be stat'd cannot be given a cache key. That is not an error worth
  // reporting from here: it means the file is missing or unreadable, which the native preflight
  // diagnoses far more precisely (E_DOCX_NOT_FOUND) than this could.
  const stat = await ReactNativeBlobUtil.fs.stat(sourcePath).catch(() => null);

  // The native side creates the output directory as part of its own preflight, so neither of these
  // paths needs to exist yet.
  let outputPath: string;
  if (stat != null) {
    const cacheKey = buildConversionCacheKey(sourcePath, Number(stat.size), Number(stat.lastModified));
    outputPath = convertedPdfPath(cacheDir, displayName, cacheKey);
    if (await ReactNativeBlobUtil.fs.exists(outputPath)) {
      return { uri: `file://${outputPath}`, name, cached: true };
    }
  } else {
    // Never written to - the conversion is about to fail - but the module still has to be told
    // somewhere to put its output.
    outputPath = convertedPdfPath(cacheDir, displayName, 'unreadable-source');
  }

  try {
    const result = await convertDocxToPdf(sourcePath, outputPath);
    return { uri: `file://${result.outputPath}`, name, cached: false };
  } catch (error) {
    if (isCancellation(error)) throw new DocxConversionCancelledError();
    throw error;
  }
}

function isCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error != null &&
    (error as { code?: unknown }).code === CANCELLED_ERROR_CODE
  );
}

/**
 * A message worth showing for a failed conversion. The native module rejects with a stable code
 * and a human-readable message, and those messages are already written for a person to read (they
 * name the file, or explain that a document is a legacy .doc), so they are preferred over anything
 * invented here.
 */
export function describeDocxError(error: unknown): string {
  if (error instanceof DocxConversionCancelledError) return 'Conversion cancelled';
  if (typeof error === 'object' && error != null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'Could not open this Word document.';
}
