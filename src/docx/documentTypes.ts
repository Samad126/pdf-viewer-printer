/**
 * What counts as a document this app can open, and how a Word document's name maps onto the PDF it
 * gets converted into.
 *
 * Everything here is by file name rather than MIME type, because a name is the only thing that
 * survives the whole trip: a picked file arrives with a name, a `file://` or `content://` URI whose
 * last segment may be anything at all, and - in the recents list - nothing but the two strings the
 * app itself wrote down. The MIME type is only available at the picker and at an incoming intent,
 * so the predicates that take one are for those two places and nothing else.
 */

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The pre-2007 binary Word format, a CFB/OLE2 container rather than a zip. */
export const DOC_MIME_TYPE = 'application/msword';

/**
 * Every Word format the conversion server reads. The two OOXML entries are the same package
 * container, `.docm` differing only in a part nothing here touches; `.doc` is an entirely different
 * binary format, and is here because the layout engine on the other end reads it natively.
 */
export const WORD_MIME_TYPES = [DOCX_MIME_TYPE, DOC_MIME_TYPE];

/** Extensions that route to the conversion path rather than straight to the PDF viewer. */
const WORD_EXTENSIONS = ['.docx', '.docm', '.doc'];

/**
 * True for a document this app must convert before it can be shown. This is the app's entire
 * routing decision - `App.openFile` sends anything else to the PDF viewer - so it is deliberately
 * about "is this Word" rather than about one format.
 */
export function isWordFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return WORD_EXTENSIONS.some(extension => lower.endsWith(extension));
}

/**
 * True for a MIME type an incoming intent or the picker may report for a Word document.
 *
 * Android does not agree with itself here: a `.doc` can arrive as `application/msword`, but some
 * providers send `application/octet-stream` for it, which is why the picker's file-name filter and
 * this both exist rather than one being derived from the other.
 */
export function isWordMimeType(mimeType: string | null | undefined): boolean {
  return mimeType != null && WORD_MIME_TYPES.includes(mimeType.toLowerCase());
}

/**
 * The name to fall back on when a picker or an intent supplies none at all.
 *
 * Based on the reported MIME type because the extension is not a guess worth making: it becomes the
 * converted PDF's name, which is what the print job, the share sheet and every exported file are
 * then named after.
 */
export function fallbackNameForMimeType(mimeType: string | null | undefined): string {
  if (mimeType?.toLowerCase() === DOC_MIME_TYPE) return 'document.doc';
  if (mimeType?.toLowerCase() === DOCX_MIME_TYPE) return 'document.docx';
  return 'document.pdf';
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
