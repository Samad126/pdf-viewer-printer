import { NativeModules } from 'react-native';

export interface PrintJobHandle {
  started: boolean;
  jobId: string | null;
}

interface PrintModuleInterface {
  printPdf(filePath: string, jobName: string, pageCount: number): Promise<PrintJobHandle>;
}

const PrintModule = NativeModules.PrintModule as PrintModuleInterface | undefined;

export function printPdf(filePath: string, jobName: string, pageCount: number): Promise<PrintJobHandle> {
  if (!PrintModule) {
    throw new Error(
      'PrintModule native module is not available. Did you forget to run a native (non-Expo Go) build?',
    );
  }
  return PrintModule.printPdf(filePath, jobName, pageCount);
}
