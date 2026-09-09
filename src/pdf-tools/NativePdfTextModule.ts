import { NativeModules } from 'react-native';
import type { PdfFindMatch } from './types';

interface PdfTextModuleInterface {
  findText(handle: string, query: string, matchCase: boolean, matchWholeWord: boolean): Promise<PdfFindMatch[]>;
  extractAllText(handle: string): Promise<string>;
}

const PdfTextModule = NativeModules.PdfTextModule as PdfTextModuleInterface | undefined;

function requireModule(): PdfTextModuleInterface {
  if (!PdfTextModule) {
    throw new Error(
      'PdfTextModule native module is not available. Did you forget to run a native (non-Expo Go) build?',
    );
  }
  return PdfTextModule;
}

export function findTextInPdf(
  handle: string,
  query: string,
  matchCase: boolean = false,
  matchWholeWord: boolean = false,
): Promise<PdfFindMatch[]> {
  return requireModule().findText(handle, query, matchCase, matchWholeWord);
}

export function extractAllTextFromPdf(handle: string): Promise<string> {
  return requireModule().extractAllText(handle);
}
