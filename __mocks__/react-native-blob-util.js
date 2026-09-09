// react-native-blob-util (and libraries that import it, like react-native-pdf) construct a
// NativeEventEmitter against a real native module at import time, which throws under Jest since
// no native module is linked in the test environment. This manual mock (auto-picked up by Jest
// for any node_modules package of the same name) only provides the surface this project actually
// uses: ReactNativeBlobUtil.fs.dirs.CacheDir.
module.exports = {
  fs: {
    dirs: {
      DocumentDir: '/mock/document-dir',
      CacheDir: '/mock/cache-dir',
    },
    mkdir: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
    unlink: jest.fn().mockResolvedValue(undefined),
  },
  config: jest.fn().mockReturnThis(),
};
