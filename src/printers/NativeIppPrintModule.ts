import { NativeModules } from 'react-native';
import type { IppJobStatus, IppPrintOptions, IppPrinterTarget, IppSubmitResult } from './types';

interface IppPrintModuleInterface {
  submitPrintJob(
    host: string,
    port: number,
    resourcePath: string,
    filePath: string,
    jobName: string,
    requestToken: string,
    copies: number | null,
    sides: string | null,
    orientationRequested: number | null,
    printColorMode: string | null,
  ): Promise<IppSubmitResult>;
  cancelSubmit(requestToken: string): Promise<{ cancelled: boolean }>;
  cancelPrintJob(
    host: string,
    port: number,
    resourcePath: string,
    jobId: number,
    requestingUserName: string,
  ): Promise<IppSubmitResult>;
  getJobStatus(
    host: string,
    port: number,
    resourcePath: string,
    jobId: number,
    requestingUserName: string,
  ): Promise<IppJobStatus>;
}

const IppPrintModule = NativeModules.IppPrintModule as IppPrintModuleInterface | undefined;

// Standard IPP orientation-requested enum values (RFC 8011 section 5.2.10). This app's UI only
// ever offers portrait/landscape, but the wire values are the general IPP enum, not app-specific.
const ORIENTATION_REQUESTED: Record<IppPrintOptions['orientation'], number> = {
  portrait: 3,
  landscape: 4,
};

function requireModule(): IppPrintModuleInterface {
  if (!IppPrintModule) {
    throw new Error(
      'IppPrintModule native module is not available. Did you forget to run a native (non-Expo Go) build?',
    );
  }
  return IppPrintModule;
}

export function submitPrintJob(
  target: IppPrinterTarget,
  filePath: string,
  jobName: string,
  requestToken: string,
  printOptions: IppPrintOptions,
): Promise<IppSubmitResult> {
  return requireModule().submitPrintJob(
    target.host,
    target.port,
    target.resourcePath,
    filePath,
    jobName,
    requestToken,
    printOptions.copies,
    printOptions.sides,
    ORIENTATION_REQUESTED[printOptions.orientation],
    printOptions.colorMode,
  );
}

export function cancelSubmit(requestToken: string): Promise<{ cancelled: boolean }> {
  return requireModule().cancelSubmit(requestToken);
}

export function cancelPrintJob(
  target: IppPrinterTarget,
  jobId: number,
  requestingUserName: string,
): Promise<IppSubmitResult> {
  return requireModule().cancelPrintJob(target.host, target.port, target.resourcePath, jobId, requestingUserName);
}

export function getJobStatus(
  target: IppPrinterTarget,
  jobId: number,
  requestingUserName: string,
): Promise<IppJobStatus> {
  return requireModule().getJobStatus(target.host, target.port, target.resourcePath, jobId, requestingUserName);
}
