import { NativeModules } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { resolveLocalPath } from '../files/localPath';

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
