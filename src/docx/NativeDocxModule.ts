import { NativeModules } from 'react-native';

export interface DocxConversionResult {
  outputPath: string;
  /** Absent when the print adapter could not report a page count; not a failure. */
  pageCount?: number;
}

interface DocxModuleInterface {
  convertToPdf(docxPath: string, outputPath: string): Promise<DocxConversionResult>;
  cancelConversion(): Promise<void>;
}

const DocxModule = NativeModules.DocxModule as DocxModuleInterface | undefined;

function requireModule(): DocxModuleInterface {
  if (!DocxModule) {
    throw new Error(
      'DocxModule native module is not available. Did you forget to run a native (non-Expo Go) build?',
    );
  }
  return DocxModule;
}

/**
 * Renders a .docx to a PDF at `outputPath`. Resolves only once a complete, validated PDF is in
 * place; on any failure `outputPath` is left untouched rather than holding a partial file.
 */
export function convertDocxToPdf(docxPath: string, outputPath: string): Promise<DocxConversionResult> {
  return requireModule().convertToPdf(docxPath, outputPath);
}

/**
 * Cancels the in-flight conversion, if any. Resolves immediately - the conversion's own promise is
 * the one that rejects with `E_CANCELLED`, once its WebView has been torn down. Safe to call when
 * nothing is running.
 */
export function cancelDocxConversion(): Promise<void> {
  return requireModule().cancelConversion();
}
