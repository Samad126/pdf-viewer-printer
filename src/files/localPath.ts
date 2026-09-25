/**
 * file:// URIs are percent-encoded per RFC 3986 (spaces, non-ASCII filenames - e.g. a document
 * opened via another app's "share into"/"open with", which lands at a percent-encoded cache path),
 * but react-native-blob-util's fs.* methods want a plain filesystem path and do not decode it
 * themselves - unlike the native Kotlin side's resolveFile() helpers (PdfiumModule, PrintModule,
 * DocxModule, ...), which already do this decoding for every other entry point into the file.
 *
 * Any JS code that takes a path that came from a picker or an intent and hands it to fs.* has to
 * go through here first, or it looks for a file at a percent-encoded path that does not exist.
 */
export function resolveLocalPath(filePath: string): string {
  return filePath.startsWith('file://') ? decodeURIComponent(filePath.slice('file://'.length)) : filePath;
}
