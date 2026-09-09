/**
 * Parses a user-typed page range string (1-based, as a human would type it - e.g. "1-3, 5, 7-9")
 * into a deduplicated, ascending-sorted array of 0-based page indices. An empty/blank input, or
 * the literal word "all" (case-insensitive), means "all pages": `undefined` is returned so the
 * caller can skip page filtering entirely and reuse the existing all-pages code path rather than
 * build an explicit `[0, 1, 2, ...]` array.
 *
 * Page selection is applied client-side by only rasterizing the requested pages when rebuilding
 * the print-ready PDF (see PdfRebuildModule.buildPrintReadyPdf's `pageIndices` parameter) rather
 * than via IPP's page-ranges attribute - this app's whole design is to control every byte of what
 * gets sent instead of trusting a printer to honour an attribute it may not support at all.
 */
export function parsePageRangeInput(input: string, pageCount: number): number[] | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === 'all') {
    return undefined;
  }

  const segments = trimmed
    .split(',')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);

  if (segments.length === 0) {
    return undefined;
  }

  const indices = new Set<number>();

  for (const segment of segments) {
    const rangeMatch = segment.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      validatePageNumber(start, pageCount, segment);
      validatePageNumber(end, pageCount, segment);
      if (start > end) {
        throw new Error(`"${segment}" is not a valid page range - the start page is after the end page.`);
      }
      for (let page = start; page <= end; page += 1) {
        indices.add(page - 1);
      }
      continue;
    }

    const singleMatch = segment.match(/^(\d+)$/);
    if (singleMatch) {
      const page = Number.parseInt(singleMatch[1], 10);
      validatePageNumber(page, pageCount, segment);
      indices.add(page - 1);
      continue;
    }

    throw new Error(`"${segment}" is not a valid page or page range.`);
  }

  return Array.from(indices).sort((a, b) => a - b);
}

function validatePageNumber(page: number, pageCount: number, segment: string): void {
  if (!Number.isFinite(page) || page < 1) {
    throw new Error(`"${segment}" is not a valid page number - pages start at 1.`);
  }
  if (page > pageCount) {
    throw new Error(`"${segment}" is beyond the last page of this document (page ${pageCount}).`);
  }
}
