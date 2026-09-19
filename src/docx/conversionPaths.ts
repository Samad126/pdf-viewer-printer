import { toPdfFileName } from './documentTypes';

/**
 * Where a converted PDF is cached, and how that cache entry is invalidated.
 *
 * Conversion takes seconds and is pure, so a converted file is worth keeping: reopening a Word
 * document from the recents list would otherwise re-render it every time. The risk that buys is
 * showing a stale rendering of a file that has since changed, which is what the source's size and
 * modification time in the key are for.
 *
 * Pure and dependency-free so it can be tested without a device - the native module and blob-util
 * calls live in convertDocx.ts.
 */

const CACHE_DIR_NAME = 'docx-converted';

/* eslint-disable no-bitwise -- FNV-1a is defined in terms of XOR and 32-bit multiply; there is no
   way to express it without bitwise operators, and a non-cryptographic hash is the right tool here
   because this only has to avoid re-rendering an unchanged file, not resist a collision attack. */

/** Two independent FNV-1a passes, so the key is 64 bits of hash rather than 32. */
function fnv1a(input: string, offsetBasis: number): string {
  let hash = offsetBasis;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    // Math.imul keeps this in 32-bit range, which `*` would not.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Identifies one conversion: the same source file, unchanged, always produces the same key, and
 * any edit to it produces a different one. A 32-bit hash would be enough to avoid recomputing, but
 * not enough to be sure two different documents never land on the same cached PDF and show the
 * user the wrong file, so this is deliberately wider.
 */
export function buildConversionCacheKey(sourcePath: string, size: number, lastModified: number): string {
  const identity = `${sourcePath}\u0000${size}\u0000${lastModified}`;
  return fnv1a(identity, 0x811c9dc5) + fnv1a(identity, 0x9e3779b9);
}

/**
 * Strips anything that would be awkward in a filename, keeping the name recognisable for debugging
 * (these files sit in the cache directory and are the only clue as to what they came from).
 *
 * Only ever applied to the name *without* its extension: sanitising the two together lets the
 * leading-character strip below eat the dot between them, which turns "???.pdf" into "-pdf".
 */
function sanitizeForFileName(baseName: string): string {
  const cleaned = baseName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[-.]+$/g, '');
  return cleaned.slice(0, 48) || 'document';
}

/**
 * The path a conversion of `sourceName` is cached at under `cacheDir`.
 *
 * The converted file is named as the PDF it becomes (`Report.pdf`), because its name on disk is
 * what the print pipeline turns into the print job's name and what FileProvider shows as the
 * shared file's name - so `Report.docx` would otherwise print as "Report.docx".
 */
export function convertedPdfPath(
  cacheDir: string,
  sourceName: string,
  cacheKey: string,
): string {
  const pdfName = toPdfFileName(sourceName);
  const dot = pdfName.lastIndexOf('.');
  const baseName = dot > 0 ? pdfName.slice(0, dot) : pdfName;
  const extension = dot > 0 ? pdfName.slice(dot) : '';
  return `${cacheDir}/${CACHE_DIR_NAME}/${cacheKey}-${sanitizeForFileName(baseName)}${extension}`;
}
