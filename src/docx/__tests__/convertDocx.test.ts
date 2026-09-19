import ReactNativeBlobUtil from 'react-native-blob-util';
import { CONVERT_ENDPOINT, MAX_UPLOAD_BYTES } from '../backendConfig';
import {
  DocxConversionCancelledError,
  DocxConversionError,
  cancelDocxConversion,
  convertDocxFile,
} from '../convertDocx';

/**
 * The mock's shape, spelled out because the real module's types describe the native surface rather
 * than the jest.fn wrappers this reaches through.
 */
interface BlobUtilMock {
  fs: Record<'exists' | 'stat' | 'mv' | 'unlink' | 'readFile' | 'mkdir', jest.Mock>;
  fetch: jest.Mock;
  wrap: jest.Mock;
  CanceledFetchError: new (message: string) => Error;
}

const blobUtil = ReactNativeBlobUtil as unknown as BlobUtilMock;
const { fs } = blobUtil;

const SOURCE_URI = 'file:///mock/cache-dir/Report.docx';
const DISPLAY_NAME = 'Report.docx';

/** A successful response, as react-native-blob-util resolves one written to a file. */
function pdfResponse(): { respInfo: { status: number; headers: Record<string, string> } } {
  return { respInfo: { status: 200, headers: { 'Content-Type': 'application/pdf' } } };
}

beforeEach(() => {
  jest.clearAllMocks();
  // A source that exists and is small, and no cached conversion yet - so a test that wants the
  // cache path or the size limit overrides exactly one of these.
  fs.stat.mockResolvedValue({ size: 1024, lastModified: 1700000000 });
  fs.exists.mockResolvedValue(false);
  fs.mv.mockResolvedValue(undefined);
  fs.unlink.mockResolvedValue(undefined);
  fs.readFile.mockResolvedValue('');
  blobUtil.fetch.mockResolvedValue(pdfResponse());
});

describe('convertDocxFile', () => {
  it('returns a cached conversion without touching the network', async () => {
    fs.exists.mockResolvedValue(true);

    const result = await convertDocxFile(SOURCE_URI, DISPLAY_NAME);

    expect(result.cached).toBe(true);
    expect(result.name).toBe('Report.pdf');
    expect(result.uri).toMatch(/^file:\/\/.*-Report\.pdf$/);
    expect(blobUtil.fetch).not.toHaveBeenCalled();
  });

  it('uploads, moves the result into place, and reports the PDF name', async () => {
    const result = await convertDocxFile(SOURCE_URI, DISPLAY_NAME);

    expect(result.cached).toBe(false);
    expect(result.name).toBe('Report.pdf');
    expect(result.uri).toMatch(/^file:\/\/.*-Report\.pdf$/);

    expect(blobUtil.fetch).toHaveBeenCalledTimes(1);
    const [method, url, , body] = blobUtil.fetch.mock.calls[0];
    expect(method).toBe('POST');
    expect(url).toBe(CONVERT_ENDPOINT);
    expect(body[0].name).toBe('file');
    expect(body[0].filename).toBe(DISPLAY_NAME);
    // The prefix is load-bearing: without it the native side base64-decodes the path instead of
    // reading the file it names.
    expect(body[0].data).toBe(`ReactNativeBlobUtil-file:///mock/cache-dir/Report.docx`);

    // Written to a .part file first, then moved, so a partial download is never visible as a PDF.
    const [from, to] = fs.mv.mock.calls[0];
    expect(from).toBe(`${to}.part`);
  });

  it('refuses an oversized document before uploading it', async () => {
    fs.stat.mockResolvedValue({ size: MAX_UPLOAD_BYTES + 1, lastModified: 1700000000 });

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_TOO_LARGE',
    });
    expect(blobUtil.fetch).not.toHaveBeenCalled();
  });

  it('reports a source it cannot read rather than uploading nothing', async () => {
    fs.stat.mockRejectedValue(new Error('ENOENT'));

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_SOURCE_MISSING',
    });
    expect(blobUtil.fetch).not.toHaveBeenCalled();
  });
});

describe('convertDocxFile failures', () => {
  it("surfaces the server's own message and cleans up the part file", async () => {
    blobUtil.fetch.mockResolvedValue({ respInfo: { status: 422, headers: {} } });
    fs.readFile.mockResolvedValue(
      JSON.stringify({ error: { code: 'E_ENCRYPTED', message: 'This document is password protected.' } }),
    );

    const error = await convertDocxFile(SOURCE_URI, DISPLAY_NAME).catch(caught => caught);

    expect(error).toBeInstanceOf(DocxConversionError);
    expect(error.message).toBe('This document is password protected.');
    // A failed conversion must not leave a part file behind for nothing else to find.
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('.part'));
    expect(fs.mv).not.toHaveBeenCalled();
  });

  it('falls back to the status line when the error body is not JSON', async () => {
    blobUtil.fetch.mockResolvedValue({ respInfo: { status: 502, headers: {} } });
    fs.readFile.mockResolvedValue('<html>Bad Gateway</html>');

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toThrow(/502/);
  });

  it('rejects a 200 that is not a PDF', async () => {
    blobUtil.fetch.mockResolvedValue({
      respInfo: { status: 200, headers: { 'Content-Type': 'text/html' } },
    });

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_NOT_A_PDF',
    });
    expect(fs.mv).not.toHaveBeenCalled();
  });

  it('reports a request that never reached the server', async () => {
    blobUtil.fetch.mockRejectedValue(new Error('Network request failed'));

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_UNREACHABLE',
    });
  });
});

describe('convertDocxFile retries', () => {
  // The library reports a response whose body ends before its Content-Length as "Download
  // interrupted." on Android, intermittently, and it is indistinguishable from a dropped
  // connection. A conversion is idempotent, so this is worth another attempt.
  it('retries once when the first attempt fails in transport, and succeeds', async () => {
    blobUtil.fetch
      .mockRejectedValueOnce(new Error('Download interrupted.'))
      .mockResolvedValueOnce(pdfResponse());

    const result = await convertDocxFile(SOURCE_URI, DISPLAY_NAME);

    expect(result.cached).toBe(false);
    expect(blobUtil.fetch).toHaveBeenCalledTimes(2);
    expect(fs.mv).toHaveBeenCalledTimes(1);
    // The abandoned attempt's part file must not be left behind or written over.
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('.part'));
  });

  it('gives up after the second transport failure rather than looping', async () => {
    blobUtil.fetch.mockRejectedValue(new Error('Download interrupted.'));

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_UNREACHABLE',
    });
    expect(blobUtil.fetch).toHaveBeenCalledTimes(2);
    expect(fs.mv).not.toHaveBeenCalled();
  });

  it('does not retry a refusal from the server, which would fail identically', async () => {
    blobUtil.fetch.mockResolvedValue({ respInfo: { status: 422, headers: {} } });
    fs.readFile.mockResolvedValue(
      JSON.stringify({ error: { message: 'This document is password protected.' } }),
    );

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_FAILED',
    });
    expect(blobUtil.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 200 that is not a PDF', async () => {
    blobUtil.fetch.mockResolvedValue({
      respInfo: { status: 200, headers: { 'Content-Type': 'text/html' } },
    });

    await expect(convertDocxFile(SOURCE_URI, DISPLAY_NAME)).rejects.toMatchObject({
      code: 'E_CONVERT_NOT_A_PDF',
    });
    expect(blobUtil.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('cancelDocxConversion', () => {
  it('rejects an in-flight conversion as cancelled, not as a failure', async () => {
    // A request that stays open until something rejects it, which is what the real one does.
    let abort: (error: Error) => void = () => undefined;
    const task = new Promise((_resolve, reject) => {
      abort = reject;
    }) as Promise<never> & { cancel: () => void };
    task.cancel = () => abort(new blobUtil.CanceledFetchError('canceled'));
    blobUtil.fetch.mockReturnValue(task);

    const conversion = convertDocxFile(SOURCE_URI, DISPLAY_NAME);
    // Let the preflight awaits settle so the request is actually in flight before cancelling.
    await new Promise(resolve => setTimeout(() => resolve(undefined), 0));
    await cancelDocxConversion();

    await expect(conversion).rejects.toBeInstanceOf(DocxConversionCancelledError);
  });

  it('is safe to call when nothing is running', async () => {
    await expect(cancelDocxConversion()).resolves.toBeUndefined();
  });
});

describe('the conversion cache directory', () => {
  // The native module this upload replaced created this directory as part of writing its output.
  // When that module was deleted nothing did, and every conversion failed while the server logged
  // a 200 - the transport opens the path it is given and does not create parents, so the write
  // failed, and the library reports a failed write as "Download interrupted." just as it does a
  // dropped connection. Nothing here could see that, so it is asserted explicitly.
  it('creates the directory, before uploading rather than after', async () => {
    await convertDocxFile(SOURCE_URI, DISPLAY_NAME);

    expect(fs.mkdir).toHaveBeenCalledWith('/mock/cache-dir/docx-converted');
    expect(fs.mkdir.mock.invocationCallOrder[0]).toBeLessThan(
      blobUtil.fetch.mock.invocationCallOrder[0],
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
    expect(blobUtil.fetch).not.toHaveBeenCalled();
  });
});
