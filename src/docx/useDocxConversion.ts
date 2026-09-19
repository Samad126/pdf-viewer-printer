import { useCallback, useState } from 'react';
import {
  DocxConversionCancelledError,
  cancelDocxConversion,
  convertDocxFile,
  describeDocxError,
} from './convertDocx';
import type { ConvertedDocument } from './convertDocx';

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
 * Drives a Word → PDF conversion for the app's open-a-file flow, including the modal that covers
 * the wait.
 *
 * Conversion is an upload, a render and a download, not a file copy, so it takes seconds and needs
 * to be visible: an unresponsive "Choose a document" button for five seconds reads as a hang.
 * Cancellation is offered for the same reason - a large document is long enough that a user who
 * picked the wrong file should not have to wait it out, and it is now also a network operation the
 * user may want to abandon when the connection is poor.
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
    // The dismiss is driven by the conversion's own promise rejecting with
    // DocxConversionCancelledError, so the modal stays up until the upload has actually been
    // aborted rather than disappearing while a request carries on invisibly.
    cancelDocxConversion().catch(() => undefined);
  }, []);

  return { state, convert, dismissError, cancel };
}
