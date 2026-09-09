import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

interface CloseButtonProps {
  onPress: () => void;
  accessibilityLabel?: string;
}

/** A small "✕" tap target used consistently across every overlay/panel in the app to dismiss it. */
export function CloseButton({ onPress, accessibilityLabel = 'Close' }: CloseButtonProps): React.JSX.Element {
  return (
    <Pressable onPress={onPress} hitSlop={12} style={styles.button} accessibilityLabel={accessibilityLabel}>
      <Text style={styles.label}>✕</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 4,
  },
  label: {
    color: '#a0a8b4',
    fontSize: 16,
    fontWeight: '700',
  },
});
