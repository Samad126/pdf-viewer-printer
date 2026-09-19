/**
 * What counts as a document this app can open, and how a Word document's name maps onto the PDF
 * it gets converted into.
 *
 * Everything here is by file name rather than MIME type, because a name is the only thing that
 * survives the whole trip: a picked file arrives with a name, a `file://` or `content://` URI whose
 * last segment may be anything at all, and - in the recents list - nothing but the two strings the
 * app itself wrote down. The MIME type is only available at the picker, and only used there.
 */

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Extensions docx-preview can read. `.docm` is the macro-enabled variant of the same OOXML
 * package, and reads identically once opened - the macros are a separate part it never touches.
 */
const DOCX_EXTENSIONS = ['.docx', '.docm'];

/** The legacy binary Word format. A different container entirely, and not readable here. */
const LEGACY_DOC_EXTENSION = '.doc';

export function isDocxFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return DOCX_EXTENSIONS.some(extension => lower.endsWith(extension));
}

/**
 * True for the pre-2007 binary `.doc` format, which cannot be converted on-device - Word stores it
 * as a CFB/OLE2 container rather than a zip, and nothing here can render that. Worth detecting by
 * name because the picker filters by MIME type and cannot be relied on to have kept one out: a
 * `.doc` can still arrive from another app's "share into" or "open with".
 */
export function isLegacyDocFileName(name: string): boolean {
  return name.toLowerCase().endsWith(LEGACY_DOC_EXTENSION);
}

/**
 * The name to show for what a Word document became, once it has been converted: `Report.docx`
 * becomes `Report.pdf`.
 *
 * This is used as the viewer's display name, and it is why the extension has to change rather than
 * being carried through as-is. The export, share and annotate features all derive their own output
 * names from this string - `Report.pdf` gives `Report-pages.zip`, `Report.txt` and
 * `Report-annotated.pdf`, whereas `Report.docx` would give `Report.docx-pages.zip` and so on,
 * because each of them only strips a trailing `.pdf`.
 */
export function toPdfFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name}.pdf`;
  return `${name.slice(0, dot)}.pdf`;
}
