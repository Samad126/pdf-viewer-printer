import { NativeModules } from 'react-native';

export interface SharedPdfFile {
  uri: string;
  name: string;
}

interface ShareIntentModuleInterface {
  getSharedPdfFile(): Promise<SharedPdfFile | null>;
}

const ShareIntentModule = NativeModules.ShareIntentModule as ShareIntentModuleInterface | undefined;

function requireModule(): ShareIntentModuleInterface {
  if (!ShareIntentModule) {
    throw new Error(
      'ShareIntentModule native module is not available. Did you forget to run a native (non-Expo Go) build?',
    );
  }
  return ShareIntentModule;
}

export function getSharedPdfFile(): Promise<SharedPdfFile | null> {
  return requireModule().getSharedPdfFile();
}
