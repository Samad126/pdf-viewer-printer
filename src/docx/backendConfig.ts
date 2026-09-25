/**
 * Where Word documents are converted, and the limits the app holds itself to before asking.
 *
 * The conversion is the one thing in this app that leaves the device. Everything else - reading,
 * searching, printing, drawing, exporting - runs locally through PDFium, and the app still works
 * entirely offline for PDFs; a Word document is the single exception, because turning one into a
 * PDF means running a layout engine, and no layout engine fits on a phone.
 */

/** The conversion server. One deployment, so one constant. */
export const CONVERSION_SERVER_URL = 'https://converterapi.alakbaroff.com';

/**
 * The output format is part of the address, and cannot be omitted.
 *
 * There is deliberately no bare `/convert` on the server - one address that means one thing is
 * easier to document and to test than two that mean the same thing - so asking for it answers with
 * the catch-all 404, whose message tells the user to update the app. Which is literally what
 * happened: this constant used to be that bare path, and the deployment that introduced the target
 * broke every conversion in the shipped app until this changed.
 *
 * `PDF_TARGET` is the only target this app asks for. The server also lists what else each source
 * can become at `GET /formats`, which is there so a client would not have to hard-code the table -
 * worth reading if this app ever offers a choice of output format, and dead weight until it does.
 */
const PDF_TARGET = 'pdf';

export const CONVERT_ENDPOINT = `${CONVERSION_SERVER_URL}/convert/${PDF_TARGET}`;

/**
 * NOTE: there is deliberately no connect timeout here. It lives in the native upload
 * (`PdfUploadModule.CONNECT_TIMEOUT_MS`), which is what actually opens the connection, and a second
 * copy on this side would be a number that looks authoritative and is never read.
 */

/**
 * The overall deadline for one conversion, enforced by a timer in `convertDocx` that aborts the
 * request rather than by the HTTP client.
 *
 * It has to be enforced from here because the library will otherwise wait on a stalled response
 * body forever - see CONNECT_TIMEOUT_MS. Without it, a server that accepts a connection and then
 * stops sending would leave the conversion modal up with no way out except cancelling by hand.
 *
 * The server gives up at 90 seconds, deliberately sooner, so that it can answer with its own
 * E_TIMEOUT rather than being killed mid-conversion and leaving this side to report a network
 * failure. That ordering is what makes this a deadline rather than a race - if this ever drops
 * below the server's, the good message stops arriving and a bare "could not reach" replaces it.
 */
export const CONVERSION_TIMEOUT_MS = 120_000;

/**
 * Refused before the upload starts, so an oversized document fails immediately with a message that
 * says what is wrong, instead of after a minute of uploading and a bare 413 from the server.
 *
 * Set by the server's own request limit, which the deployment advertises as
 * `x-max-upload-bytes`, and the two are the same number (104857600) on purpose. They are checked
 * independently - here, by the multipart parser, and by the reverse proxy - and each answers with
 * its own message, so if one is ever changed the other has to move with it or the refusal the user
 * sees depends on which layer noticed first.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
