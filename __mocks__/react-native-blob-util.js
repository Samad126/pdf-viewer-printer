// react-native-blob-util (and libraries that import it, like react-native-pdf) construct a
// NativeEventEmitter against a real native module at import time, which throws under Jest since
// no native module is linked in the test environment. This manual mock (auto-picked up by Jest
// for any node_modules package of the same name) only provides the surface this project actually
// uses: the filesystem calls, and the HTTP client the Word conversion uploads through.
//
// The defaults are chosen so the common paths work without each test restating them - a source
// file that exists and is small, a cached PDF that does not exist yet, and a request that
// succeeds. Note `fs.exists` resolving true means `convertDocxFile` takes its cache-hit path,
// so a test exercising the upload has to set it false first.
const wrap = path =>
  path.startsWith('content://')
    ? `ReactNativeBlobUtil-content://${path}`
    : `ReactNativeBlobUtil-file://${path}`;

// Shared, so a test can arm the response with `BlobUtil.fetch.mockResolvedValue(...)` rather than
// reaching through `config()`, which returns a fresh object on every call.
const fetch = jest.fn();

class CanceledFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReactNativeBlobUtilCanceledFetch';
  }
}

module.exports = {
  fs: {
    dirs: {
      DocumentDir: '/mock/document-dir',
      CacheDir: '/mock/cache-dir',
    },
    mkdir: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
    unlink: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ size: 1024, lastModified: 1700000000 }),
    mv: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(''),
  },
  config: jest.fn(() => ({ fetch })),
  fetch,
  wrap,
  CanceledFetchError,
};
