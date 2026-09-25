import ReactNativeBlobUtil from 'react-native-blob-util';
import { CONVERT_ENDPOINT, MAX_UPLOAD_BYTES } from '../backendConfig';
import {
  DocxConversionCancelledError,
  DocxConversionError,
  cancelDocxConversion,
  convertDocxFile,
} from '../convertDocx';
import { PdfUpload } from '../NativePdfUpload';
import type { PdfUploadResult } from '../NativePdfUpload';

jest.mock('../NativePdfUpload', () => ({
  PdfUpload: { upload: jest.fn(), cancel: jest.fn().mockResolvedValue(undefined) },
}));

/**
 * The mock's shape, spelled out because the real module's types describe the native surface rather
 * than the jest.fn wrappers this reaches through.
 */
interface BlobUtilMock {
  fs: Record<'exists' | 'stat' | 'mv' | 'unlink' | 'readFile' | 'mkdir', jest.Mock>;
}

const blobUtil = ReactNativeBlobUtil as unknown as BlobUtilMock;
const { fs } = blobUtil;
const upload = PdfUpload.upload as jest.Mock;

const SOURCE_URI = 'file:///mock/cache-dir/Report.docx';
const DISPLAY_NAME = 'Report.docx';

/** A successful conversion, as the native upload reports one. */
function okResult(): PdfUploadResult {
  return { status: 200, contentType: 'application/pdf', written: true, errorBody: null };
}

/** A refusal by the server, which arrives as a result rather than a rejection. */
function refusal(status: number, errorBody: string | null): PdfUploadResult {
  return { status, contentType: 'application/json', written: false, errorBody };
}

/** What the native side rejects with when the request is aborted. */
function cancellation(): Error {
  const error = new Error('The upload was cancelled.') as Error & { code: string };
  error.code = 'E_UPLOAD_CANCELLED';
  return error;
}

beforeEach(() => {
  jest.clearAllMocks();
  // A source that exists and is small, and no cached conversion yet - so a test that wants the
  // cache path or the size limit overrides exactly one of these.
  fs.stat.mockResolvedValue({ size: 1024, lastModified: 1700000000 });
  fs.exists.mockResolvedValue(false);
  fs.mv.mockResolvedValue(undefined);
  fs.unlink.mockResolvedValue(undefined);
  fs.mkdir.mockResolvedValue(undefined);
  upload.mockResolvedValue(okResult());
});

describe('convertDocxFile', () => {
  it('returns a cached conversion without touching the network', async () => {
    fs.exists.mockResolvedValue(true);

    const result = await convertDocxFile(SOURCE_URI, DISPLAY_NAME);

    expect(result.cached).toBe(true);
    expect(result.name).toBe('Report.pdf');
    expect(result.uri).toMatch(/^file:\/\/.*-Report\.pdf$/);
    expect(upload).not.toHaveBeenCalled();
  });

  it('uploads, moves the result into place, and reports the PDF name', async () => {
    const result = await convertDocxFile(SOURCE_URI, DISPLAY_NAME);

    expect(result.cached).toBe(false);
    expect(result.name).toBe('Report.pdf');
    expect(result.uri).toMatch(/^file:\/\/.*-Report\.pdf$/);

    expect(upload).toHaveBeenCalledTimes(1);
    const [url, source, filename, destination] = upload.mock.calls[0];
    expect(url).toBe(CONVERT_ENDPOINT);
    // The target is part of the path and a bare /convert answers with a 404 telling the user to
    // update the app, so the suffix is asserted rather than assumed from the constant above - a
    // test that only compares the constant against itself would not have caught that.
    expect(url).toMatch(/\/convert\/pdf$/);
    expect(source).toBe('/mock/cache-dir/Report.docx');
    // The filename is the document's own: the server picks its import filter from it.
    expect(filename).toBe(DISPLAY_NAME);

    // Written to a .part file first, then moved, so a partial download is never visible as a PDF.
    const [from, to] = fs.mv.mock.calls[0];
    expect(from).toBe(`${to}.part`);
    expect(destination).toBe(from);
  });

  it('refuses an oversized document before uploading it', async () => {
    fs.stat.mockResolvedValue({ size: MAX_UPLOAD_BYTES + 1, lastModified: 1700000000 });

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_TOO_LARGE',
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports a source it cannot read rather than uploading nothing', async () => {
    fs.stat.mockRejectedValue(new Error('ENOENT'));

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_SOURCE_MISSING',
    });
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('convertDocxFile failures', () => {
  it("surfaces the server's own message and cleans up the part file", async () => {
    upload.mockResolvedValue(
      refusal(422, JSON.stringify({ error: { code: 'E_ENCRYPTED', message: 'This document is password protected.' } })),
    );

    const error = await convertDocxFile(SOURCE_URI, DISPLAY_NAME).catch(caught => caught);

    expect(error).toBeInstanceOf(DocxConversionError);
    expect(error.message).toBe('This document is password protected.');
    // A failed conversion must not leave a part file behind for nothing else to find.
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('.part'));
    expect(fs.mv).not.toHaveBeenCalled();
  });

  it('falls back to the status line when the error body is not JSON', async () => {
    // A proxy in front of the server answers with HTML rather than the error envelope.
    upload.mockResolvedValue(refusal(502, '<html>Bad Gateway</html>'));

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toThrow(/502/);
  });

  it('falls back to the status line when there is no body at all', async () => {
    upload.mockResolvedValue(refusal(504, null));

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toThrow(/504/);
  });

  it('rejects a 200 that is not a PDF', async () => {
    upload.mockResolvedValue({ ...okResult(), contentType: 'text/html' });

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_NOT_A_PDF',
    });
    expect(fs.mv).not.toHaveBeenCalled();
  });

  it('reports a request that never reached the server', async () => {
    upload.mockRejectedValue(new Error('Unable to resolve host'));

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_UNREACHABLE',
    });
  });
});

describe('convertDocxFile retries', () => {
  // A dropped connection is worth another attempt: a conversion is idempotent and the .part file is
  // rewritten from scratch, so a second try cannot corrupt anything.
  it('retries once when the first attempt fails in transport, and succeeds', async () => {
    upload.mockRejectedValueOnce(new Error('Connection reset')).mockResolvedValueOnce(okResult());

    const result = await convertDocxFile(SOURCE_URI, DISPLAY_NAME);

    expect(result.cached).toBe(false);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(fs.mv).toHaveBeenCalledTimes(1);
    // The abandoned attempt's part file must not be left behind or written over.
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('.part'));
  });

  it('gives up after the second transport failure rather than looping', async () => {
    upload.mockRejectedValue(new Error('Connection reset'));

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_UNREACHABLE',
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(fs.mv).not.toHaveBeenCalled();
  });

  it('does not retry a refusal from the server, which would fail identically', async () => {
    upload.mockResolvedValue(refusal(422, JSON.stringify({ error: { message: 'Password protected.' } })));

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_FAILED',
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 200 that is not a PDF', async () => {
    upload.mockResolvedValue({ ...okResult(), contentType: 'text/html' });

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_NOT_A_PDF',
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('does not retry a cancellation the user asked for', async () => {
    upload.mockRejectedValue(cancellation());

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toBeInstanceOf(
      DocxConversionCancelledError,
    );
    expect(upload).toHaveBeenCalledTimes(1);
  });
});

describe('cancelDocxConversion', () => {
  it('aborts the request in flight and reports it as cancelled, not as a failure', async () => {
    let release: (value: never) => void = () => undefined;
    const pending = new Promise<never>((_resolve, reject) => {
      release = reject;
    });
    upload.mockReturnValue(pending);

    const conversion = convertDocxFile(SOURCE_URI, DISPLAY_NAME);
    // Let the preflight awaits settle so the request is actually in flight before cancelling.
    await new Promise(resolve => setTimeout(() => resolve(undefined), 0));
    await cancelDocxConversion();
    release(cancellation() as never);

    await expect(conversion).rejects.toBeInstanceOf(DocxConversionCancelledError);
    expect(PdfUpload.cancel).toHaveBeenCalled();
  });

  it('is safe to call when nothing is running', async () => {
    await expect(cancelDocxConversion()).resolves.toBeUndefined();
  });
});

describe('the conversion cache directory', () => {
  // Nothing else creates it, and the native upload writes the response into it. A missing directory
  // would fail the write, and the way that failure surfaces is not obviously about a directory.
  it('creates the directory, before uploading rather than after', async () => {
    await convertDocxFile(SOURCE_URI, DISPLAY_NAME);

    expect(fs.mkdir).toHaveBeenCalledWith('/mock/cache-dir/docx-converted');
    expect(fs.mkdir.mock.invocationCallOrder[0]).toBeLessThan(
      upload.mock.invocationCallOrder[0],
    );
  });

  it('does not try to create it once it already exists', async () => {
    // mkdir rejects with EEXIST on an existing directory rather than being idempotent, so calling
    // it every time would fail every conversion after the first.
    fs.exists.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith('docx-converted')),
    );

    const result = await convertDocxFile(SOURCE_URI, DISPLAY_NAME);

    expect(result.cached).toBe(false);
    expect(fs.mkdir).not.toHaveBeenCalled();
  });

  it('refuses before uploading when it cannot be created', async () => {
    fs.mkdir.mockRejectedValue(new Error('EROFS'));

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_CACHE_UNWRITABLE',
    });
    expect(upload).not.toHaveBeenCalled();
  });
});
