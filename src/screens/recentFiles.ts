import ReactNativeBlobUtil from 'react-native-blob-util';
import { closePdfDocument, openPdfDocument, renderPdfPageToFile } from '../pdf/NativePdfiumModule';

export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
  /** file:// path to a small rasterized preview of page 1, or undefined if generating one failed
   * (e.g. a corrupt/unreadable PDF) - callers should fall back to a placeholder in that case. */
  thumbnailPath?: string;
}

// Kept in DocumentDir (not CacheDir, which the OS is free to clear under storage pressure) since
// this list itself is small, persisted metadata, not a cache of file contents - though the actual
// PDFs it points to (in CacheDir, via keepLocalCopy) can still individually go missing; opening a
// stale entry is handled as a normal "file not found" error by the same code path a fresh pick
// would hit, not specially here.
const RECENTS_FILE_PATH = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/recent-files.json`;
const MAX_STORED_RECENTS = 20;
// Small and low-DPI on purpose - this is a thumbnail shown at a few dozen px, not something anyone
// reads text off of, so there's no reason to spend the time/space a real preview DPI would cost.
const THUMBNAIL_DPI = 72;

// Best-effort: rasterizes page 1 of the PDF at filePath into a small cached PNG and resolves its
// path, or undefined if anything about that fails (corrupt/unreadable PDF, no pages, etc.) - a
// missing thumbnail is never treated as a reason to fail recording the file as recently opened.
async function generateThumbnail(filePath: string): Promise<string | undefined> {
  let handle: string | null = null;
  try {
    const inspection = await openPdfDocument(filePath, null);
    if (!inspection.canOpen || !inspection.handle || inspection.pageCount <= 0) return undefined;
    handle = inspection.handle;

    const outputPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/recent-thumb-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.png`;
    const rendered = await renderPdfPageToFile(handle, 0, THUMBNAIL_DPI, outputPath);
    return `file://${rendered.outputPath}`;
  } catch {
    return undefined;
  } finally {
    if (handle != null) closePdfDocument(handle).catch(() => undefined);
  }
}

async function readRecentsFile(): Promise<RecentFile[]> {
  try {
    const exists = await ReactNativeBlobUtil.fs.exists(RECENTS_FILE_PATH);
    if (!exists) return [];
    const raw = await ReactNativeBlobUtil.fs.readFile(RECENTS_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Missing, corrupt, or unreadable - recent files is a convenience list, not critical state, so
    // degrading to "no recents" is preferable to surfacing an error the user can't do anything
    // about.
    return [];
  }
}

async function writeRecentsFile(files: RecentFile[]): Promise<void> {
  await ReactNativeBlobUtil.fs.writeFile(RECENTS_FILE_PATH, JSON.stringify(files), 'utf8');
}

export async function loadRecentFiles(): Promise<RecentFile[]> {
  return readRecentsFile();
}

/**
 * Records a file as just opened - moves it to the front if already present (rather than
 * duplicating it), and trims the stored list to MAX_STORED_RECENTS. Resolves with the updated
 * list.
 *
 * `thumbnailSourcePath` is for a file that is not itself a PDF but has a PDF rendering of it: a
 * Word document is listed and reopened under the path and name it was opened with, so that the
 * recents list shows what the user actually picked, while its thumbnail has to come from the PDF
 * it was converted into. Defaults to `path` for everything that is already a PDF.
 */
export async function recordRecentFile(
  path: string,
  name: string,
  thumbnailSourcePath: string = path,
): Promise<RecentFile[]> {
  const existing = await readRecentsFile();
  const previousEntry = existing.find(file => file.path === path);
  const withoutThisPath = existing.filter(file => file.path !== path);

  // Reuse an already-generated thumbnail for a file that's simply being reopened, rather than
  // re-rasterizing its first page every single time it's opened.
  const thumbnailPath = previousEntry?.thumbnailPath ?? (await generateThumbnail(thumbnailSourcePath));

  const updated = [{ path, name, openedAt: Date.now(), thumbnailPath }, ...withoutThisPath].slice(
    0,
    MAX_STORED_RECENTS,
  );
  await writeRecentsFile(updated);
  return updated;
}

/** Removes one entry (by path) from the recents list - just the history entry, never the PDF
 * itself. Resolves with the updated list. */
export async function removeRecentFile(path: string): Promise<RecentFile[]> {
  const existing = await readRecentsFile();
  const removedEntry = existing.find(file => file.path === path);
  const updated = existing.filter(file => file.path !== path);
  await writeRecentsFile(updated);

  if (removedEntry?.thumbnailPath != null) {
    const thumbnailFsPath = removedEntry.thumbnailPath.startsWith('file://')
      ? removedEntry.thumbnailPath.slice('file://'.length)
      : removedEntry.thumbnailPath;
    ReactNativeBlobUtil.fs.unlink(thumbnailFsPath).catch(() => undefined);
  }

  return updated;
}
