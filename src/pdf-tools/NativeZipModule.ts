import { NativeModules } from 'react-native';

interface ZipModuleInterface {
  zipFiles(filePaths: string[], outputPath: string): Promise<string>;
}

const ZipModule = NativeModules.ZipModule as ZipModuleInterface | undefined;

function requireModule(): ZipModuleInterface {
  if (!ZipModule) {
    throw new Error('ZipModule native module is not available. Did you forget to run a native (non-Expo Go) build?');
  }
  return ZipModule;
}

export function zipFiles(filePaths: string[], outputPath: string): Promise<string> {
  return requireModule().zipFiles(filePaths, outputPath);
}
