import { useCallback, useState } from 'react';
import { DocxConversionCancelledError, convertDocxFile, describeDocxError } from './convertDocx';
import type { ConvertedDocument } from './convertDocx';
import { cancelDocxConversion } from './NativeDocxModule';

export type DocxConversionState =
  | { stage: 'idle' }
  | { stage: 'converting'; fileName: string }
  | { stage: 'error'; fileName: string; message: string };

export interface UseDocxConversionResult {
  state: DocxConversionState;
  /** Resolves with the converted PDF, or null if it failed or the user cancelled. */
  convert: (filePath: string, fileName: string) => Promise<ConvertedDocument | null>;
  dismissError: () => void;
  cancel: () => void;
}

/**
 * Drives a .docx → PDF conversion for the app's open-a-file flow, including the modal that covers
 * the wait.
 *
 * Conversion is a real render, not a file copy, so it takes seconds and needs to be visible: an
 * unresponsive "Choose a document" button for five seconds reads as a hang. Cancellation is
 * offered for the same reason - a large document is long enough that a user who picked the wrong
 * file should not have to wait it out.
 */
export function useDocxConversion(): UseDocxConversionResult {
  const [state, setState] = useState<DocxConversionState>({ stage: 'idle' });

  const convert = useCallback(
    async (filePath: string, fileName: string): Promise<ConvertedDocument | null> => {
      setState({ stage: 'converting', fileName });
      try {
        const converted = await convertDocxFile(filePath, fileName);
        setState({ stage: 'idle' });
        return converted;
      } catch (error) {
        // Cancelling is a decision the user just made, not a failure to report back to them.
        if (error instanceof DocxConversionCancelledError) {
          setState({ stage: 'idle' });
          return null;
        }
        setState({ stage: 'error', fileName, message: describeDocxError(error) });
        return null;
      }
    },
    [],
  );

  const dismissError = useCallback(() => setState({ stage: 'idle' }), []);

  const cancel = useCallback(() => {
    // The dismiss is driven by the conversion's own promise rejecting with E_CANCELLED, so the
    // modal stays up until the native side has actually torn its WebView down rather than
    // disappearing while work continues invisibly.
    cancelDocxConversion().catch(() => undefined);
  }, []);

  return { state, convert, dismissError, cancel };
}
