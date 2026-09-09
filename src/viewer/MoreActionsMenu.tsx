import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface MoreActionsMenuItem {
  key: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

interface MoreActionsMenuProps {
  items: MoreActionsMenuItem[];
  onClose: () => void;
}

export function MoreActionsMenu({ items, onClose }: MoreActionsMenuProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      {items.map(item => (
        <Pressable
          key={item.key}
          disabled={item.disabled}
          onPress={() => {
            onClose();
            item.onPress();
          }}
          style={[styles.itemRow, item.disabled && styles.itemDisabled]}
        >
          <Text style={styles.itemLabel}>{item.label}</Text>
        </Pressable>
      ))}
      <Pressable onPress={onClose} style={styles.cancelRow}>
        <Text style={styles.cancelLabel}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#101418',
    borderRadius: 12,
    overflow: 'hidden',
  },
  itemRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2f36',
  },
  itemDisabled: {
    opacity: 0.4,
  },
  itemLabel: {
    color: '#ffffff',
    fontSize: 15,
  },
  cancelRow: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelLabel: {
    color: '#a0a8b4',
    fontWeight: '600',
  },
});
