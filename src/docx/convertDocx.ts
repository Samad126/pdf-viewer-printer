import ReactNativeBlobUtil from 'react-native-blob-util';
import { resolveLocalPath } from '../files/localPath';
import {
  CONNECT_TIMEOUT_MS,
  CONVERSION_TIMEOUT_MS,
  CONVERT_ENDPOINT,
  MAX_UPLOAD_BYTES,
} from './backendConfig';
import { buildConversionCacheKey, convertedPdfPath } from './conversionPaths';
import { toPdfFileName } from './documentTypes';

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

/**
 * A conversion that failed, carrying a stable code alongside the message.
 *
 * The codes are the app's own; when the server supplied a message it is used verbatim, because it
 * knows *why* a document failed in a way this side cannot - a password-protected file, an
 * unsupported embedded object - and inventing a generic sentence over the top of a precise one
 * would be a downgrade.
 */
export class DocxConversionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DocxConversionError';
    this.code = code;
  }
}

/**
 * The in-flight request, so it can be aborted. Only ever one: the conversion modal blocks the app
 * while it is up, and `DocxModule`'s old native side rejected a second conversion with `E_BUSY` for
 * the same reason.
 */
let activeTask: { cancel: () => void } | null = null;

/**
 * Converts a Word document to a PDF by uploading it to the conversion server and writing the PDF it
 * returns into the app's cache, reusing a previous conversion of the same unchanged file.
 *
 * The cache is keyed on the source path, size and modification time, so editing a document and
 * reopening it converts again rather than showing the old rendering. Nothing invalidates these
 * files - they live in the cache directory, which the OS is free to clear, and every one of them is
 * reproducible from its source.
 *
 * Since the conversion now costs a network round trip rather than merely CPU, the cache is worth
 * more than it was: a document reopened from the recents list is read from disk and never uploaded
 * a second time.
 */
export async function convertDocxFile(docxUri: string, displayName: string): Promise<ConvertedDocument> {
  const sourcePath = resolveLocalPath(docxUri);
  const cacheDir = ReactNativeBlobUtil.fs.dirs.CacheDir;
  const name = toPdfFileName(displayName);

  // A source that cannot be stat'd cannot be given a cache key, and can no longer be handed to a
  // native preflight to diagnose either - there is nothing to upload, so this is now the end of the
  // road rather than the start of a more precise one.
  const stat = await ReactNativeBlobUtil.fs.stat(sourcePath).catch(() => null);
  if (stat == null) {
    throw new DocxConversionError(
      'E_CONVERT_SOURCE_MISSING',
      `${displayName} could not be read. It may have been moved or deleted.`,
    );
  }

  const cacheKey = buildConversionCacheKey(sourcePath, Number(stat.size), Number(stat.lastModified));
  const outputPath = convertedPdfPath(cacheDir, displayName, cacheKey);
  if (await ReactNativeBlobUtil.fs.exists(outputPath)) {
    return { uri: `file://${outputPath}`, name, cached: true };
  }

  const size = Number(stat.size);
  if (size > MAX_UPLOAD_BYTES) {
    throw new DocxConversionError(
      'E_CONVERT_TOO_LARGE',
      `${displayName} is too large to convert (${formatMegabytes(size)}, limit ${formatMegabytes(
        MAX_UPLOAD_BYTES,
      )}).`,
    );
  }

  await upload(sourcePath, displayName, outputPath);
  return { uri: `file://${outputPath}`, name, cached: false };
}

/**
 * Uploads the document and writes the converted PDF to `outputPath`, via a `.part` file that is
 * only moved into place once the whole response has arrived. A conversion that fails or is
 * cancelled therefore never leaves a half-written PDF where the viewer would find it.
 */
async function upload(sourcePath: string, displayName: string, outputPath: string): Promise<void> {
  const partPath = `${outputPath}.part`;

  // The response is written straight to disk rather than returned through JS.
  //
  // `timeout` here is the CONNECT timeout only, not a deadline for the whole exchange: the library
  // forces the read timeout to zero when a response goes to a file, deliberately, so that a large
  // download is never cut off. The watchdog below is the overall deadline for that reason.
  const task = ReactNativeBlobUtil.config({
    path: partPath,
    timeout: CONNECT_TIMEOUT_MS,
  }).fetch('POST', CONVERT_ENDPOINT, {}, [
    {
      name: 'file',
      filename: displayName,
      // Deliberately generic. The converter picks its import filter from the file *name*, which is
      // the part that has to be right, and the app would only be guessing at anything finer.
      type: 'application/octet-stream',
      // Without this prefix the native side treats `data` as base64 and decodes it, rather than
      // reading the path it plainly looks like. `wrap` is what adds it.
      data: ReactNativeBlobUtil.wrap(sourcePath),
    },
  ]);

  activeTask = task;

  // The deadline, enforced here because the HTTP client's own timeout cannot reach a stalled
  // response body (see below). Cancel is the only way to stop waiting on one.
  let expired = false;
  const watchdog = setTimeout(() => {
    expired = true;
    task.cancel();
  }, CONVERSION_TIMEOUT_MS);

  try {
    const response = await task;
    const status = response.respInfo.status;

    // A non-2xx resolves rather than rejecting, and its body has already been written to the same
    // path a success would have used - so the status has to be checked before anything reads that
    // file as a PDF.
    if (status < 200 || status >= 300) {
      throw new DocxConversionError('E_CONVERT_FAILED', await readServerMessage(partPath, status));
    }

    const contentType = headerValue(response.respInfo.headers, 'content-type');
    if (contentType != null && !contentType.toLowerCase().includes('application/pdf')) {
      throw new DocxConversionError(
        'E_CONVERT_NOT_A_PDF',
        `The conversion server returned ${contentType} instead of a PDF.`,
      );
    }

    // Same directory as the destination, so this is a rename rather than a copy across filesystems.
    await ReactNativeBlobUtil.fs.mv(partPath, outputPath);
  } catch (error) {
    // The `.part` file is removed on every failure path, including the ones above that already
    // consumed it: a stale part file would be invisible, since nothing else looks for one.
    await ReactNativeBlobUtil.fs.unlink(partPath).catch(() => undefined);

    if (expired) {
      throw new DocxConversionError(
        'E_CONVERT_TIMEOUT',
        `The conversion server did not finish within ${Math.round(CONVERSION_TIMEOUT_MS / 1000)} seconds.`,
      );
    }
    // The user's own cancellation ends up here too, since aborting the request rejects it. The flag
    // above is what tells the two apart: once the watchdog has fired, a rejection is the abort it
    // asked for rather than a cancellation anyone chose.
    if (isHttpCancellation(error)) {
      throw new DocxConversionCancelledError();
    }
    if (error instanceof DocxConversionError) {
      throw error;
    }
    throw new DocxConversionError('E_CONVERT_UNREACHABLE', unreachableMessage(error));
  } finally {
    clearTimeout(watchdog);
    activeTask = null;
  }
}

/**
 * The message to show for a failed request, read out of the server's own error body.
 *
 * The body is at the part path because the library wrote it there before the status was looked at.
 * Everything here is best-effort: a proxy or a load balancer can answer with HTML, so the status
 * line is the fallback rather than an empty message.
 */
async function readServerMessage(partPath: string, status: number): Promise<string> {
  const body = await ReactNativeBlobUtil.fs.readFile(partPath, 'utf8').catch(() => null);
  if (body != null) {
    try {
      const parsed: unknown = JSON.parse(body);
      const message = (parsed as { error?: { message?: unknown } })?.error?.message;
      if (typeof message === 'string' && message.trim().length > 0) return message;
    } catch {
      // Not JSON. Fall through to the status line.
    }
  }
  return `The conversion server refused the document (HTTP ${status}).`;
}

/**
 * True for the rejection react-native-blob-util produces when a request is aborted.
 *
 * This is the only way to recognise it: the error carries no `code`, and the library throws it
 * synchronously from `cancel()` rather than waiting for the native side to confirm, so there is no
 * status or response to inspect either.
 */
function isHttpCancellation(error: unknown): boolean {
  return error instanceof ReactNativeBlobUtil.CanceledFetchError;
}

/**
 * A network failure, described rather than dumped.
 *
 * The library reports a lost connection and a DNS failure with the same bare shapes, and neither is
 * comprehensible in a dialog, so both become the same sentence: the thing the user can act on is
 * that the server was not reached, not which layer failed.
 */
function unreachableMessage(error: unknown): string {
  const detail = error instanceof Error && error.message.length > 0 ? ` (${error.message})` : '';
  return `Could not reach the conversion server. Check your connection and try again.${detail}`;
}

/** Header lookup, which has to be case-insensitive because HTTP header names are. */
function headerValue(
  headers: Record<string, string> | undefined,
  wanted: string,
): string | undefined {
  if (headers == null) return undefined;
  const key = Object.keys(headers).find(name => name.toLowerCase() === wanted);
  return key == null ? undefined : headers[key];
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Stops the in-flight conversion, if any. Returns once the request has been aborted, which is what
 * lets `useDocxConversion` dismiss its modal only after the work has actually stopped rather than
 * while a request carries on invisibly.
 *
 * Safe to call when nothing is running.
 */
export async function cancelDocxConversion(): Promise<void> {
  activeTask?.cancel();
}

/**
 * A message worth showing for a failed conversion. Messages raised here are already written for a
 * person to read, and ones the server supplied are preferred over anything invented on this side,
 * so the message is passed through rather than replaced.
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
