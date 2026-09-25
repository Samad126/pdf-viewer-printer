import { keepLocalCopy } from '@react-native-documents/picker';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { getSharedDocumentFile } from './NativeShareIntentModule';

export interface OpenedSharedFile {
  path: string;
  name: string;
}

/**
 * Watches for a PDF or Word document the app was opened or shared with from another app - on mount
 * (cold start via "Open with"/"Share"), and again each time the app returns to the foreground (the
 * warm-start case: the app was already running when the user shared a new file into it). The
 * native side consumes the intent's data once read, so re-checking on every foreground transition
 * is safe - it resolves to nothing once there's no unread shared file left.
 *
 * Nothing here distinguishes the two document types: a .docx is handed on by name and the open
 * flow converts it, which is the same thing that happens to one chosen from the picker.
 */
export function useSharedDocumentIntent(onFileOpened: (file: OpenedSharedFile) => void): void {
  const onFileOpenedRef = useRef(onFileOpened);
  onFileOpenedRef.current = onFileOpened;

  const checkForSharedFile = useCallback(async () => {
    // getSharedDocumentFile() throws synchronously (not a rejected promise) if the native module
    // isn't available at all, so a .catch() chained onto its return value would never run - this
    // try/catch is what actually degrades that to "no shared file" instead of an unhandled
    // rejection, since this runs unawaited from a useEffect below.
    let shared;
    try {
      shared = await getSharedDocumentFile();
    } catch {
      return;
    }
    if (shared == null) return;

    const [copy] = await keepLocalCopy({
      files: [{ uri: shared.uri, fileName: shared.name }],
      destination: 'cachesDirectory',
    }).catch(() => []);

    if (copy != null && copy.status !== 'error') {
      onFileOpenedRef.current({ path: copy.localUri, name: shared.name });
    }
  }, []);

  useEffect(() => {
    checkForSharedFile();
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') checkForSharedFile();
    });
    return () => subscription.remove();
  }, [checkForSharedFile]);
}
