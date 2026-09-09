import React from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * A "difference" blend against solid white inverts whatever's underneath (difference(255, c) =
 * 255-c), which gives a real color-inversion night-reading mode without touching react-native-pdf
 * or the print pipeline at all - this is a purely visual overlay that lets touches pass straight
 * through to the PDF view beneath it.
 */
export function NightModeOverlay(): React.JSX.Element {
  return <View pointerEvents="none" style={styles.overlay} />;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    mixBlendMode: 'difference',
  },
});
