import { NativeModules } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

interface FileShareModuleInterface {
  shareFile(filePath: string, mimeType: string): Promise<void>;
}

const FileShareModule = NativeModules.FileShareModule as FileShareModuleInterface | undefined;

function requireModule(): FileShareModuleInterface {
  if (!FileShareModule) {
    throw new Error(
      'FileShareModule native module is not available. Did you forget to run a native (non-Expo Go) build?',
    );
  }
  return FileShareModule;
}

const PDF_MIME_TYPE = 'application/pdf';

// file:// URIs are percent-encoded per RFC 3986 (spaces, non-ASCII filenames - e.g. a document
// opened via another app's "share into"/"open with", which lands at a percent-encoded cache path),
// but react-native-blob-util's fs.* methods want a plain filesystem path and do not decode it
// themselves - unlike the native Kotlin side's resolveFile() helpers (PdfiumModule, PrintModule,
// etc.), which already do this decoding for every other entry point into the file. This was the
// one path through the app that skipped it, causing fs.cp to look for a file at a percent-encoded
// path that doesn't actually exist on disk.
function resolveLocalPath(filePath: string): string {
  return filePath.startsWith('file://') ? decodeURIComponent(filePath.slice('file://'.length)) : filePath;
}

/**
 * Shares a local PDF via the system share sheet. `filePath` is first copied into the cache dir
 * under `fileName` so the receiving app sees the PDF's real name (e.g. "Invoice.pdf") rather than
 * whatever internal path segment `filePath` happens to end in (a print-pipeline temp file, a
 * content:// URI's opaque last segment, ...) - FileProvider derives the shared content:// URI's
 * display name directly from the file's name on disk, not from anything passed across the bridge.
 */
export async function sharePdf(filePath: string, fileName: string): Promise<void> {
  const shareableName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  const shareablePath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/share-${Date.now()}-${shareableName}`;
  await ReactNativeBlobUtil.fs.cp(resolveLocalPath(filePath), shareablePath);
  await requireModule().shareFile(shareablePath, PDF_MIME_TYPE);
}
