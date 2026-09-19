/**
 * Where Word documents are converted, and the limits the app holds itself to before asking.
 *
 * The conversion is the one thing in this app that leaves the device. Everything else - reading,
 * searching, printing, drawing, exporting - runs locally through PDFium, and the app still works
 * entirely offline for PDFs; a Word document is the single exception, because turning one into a
 * PDF means running a layout engine, and no layout engine fits on a phone.
 */

/** The conversion server. One deployment, so one constant. */
export const CONVERSION_SERVER_URL = 'https://converter.alakbaroff.com';

export const CONVERT_ENDPOINT = `${CONVERSION_SERVER_URL}/convert`;

/**
 * How much connecting is allowed to take, passed to the HTTP client as its own connect timeout.
 *
 * This is not the whole story and is not used as such: react-native-blob-util forces the *read*
 * timeout to zero for a response written to a file, so this bounds reaching the server and nothing
 * after it. The overall deadline below is enforced separately, by the app, for that reason.
 */
export const CONNECT_TIMEOUT_MS = 30_000;

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
 * `x-max-upload-bytes`, and the two are the same number (26214400) on purpose. They are checked
 * independently - here, by the multipart parser, and by the reverse proxy - and each answers with
 * its own message, so if one is ever changed the other has to move with it or the refusal the user
 * sees depends on which layer noticed first.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
