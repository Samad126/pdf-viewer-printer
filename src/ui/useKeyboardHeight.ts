import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * Tracks the on-screen keyboard's height in px, 0 when hidden. Used to manually lift an
 * absolutely-positioned overlay above the keyboard: on Android 15+ (targetSdk 35+) edge-to-edge is
 * enforced and `windowSoftInputMode="adjustResize"` no longer auto-shrinks the window the way it
 * used to, so a plain KeyboardAvoidingView sitting inside a `position: absolute` overlay (rather
 * than filling the real screen edges) can't reliably compute how much to compensate. Listening to
 * the raw keyboard events and applying the offset ourselves sidesteps that ambiguity entirely.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', event => {
      setHeight(event.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}
