import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CloseButton } from '../ui/CloseButton';

export interface MoreActionsMenuItem {
  key: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

interface MoreActionsMenuProps {
  title?: string;
  items: MoreActionsMenuItem[];
  onClose: () => void;
}

export function MoreActionsMenu({ title = 'Actions', items, onClose }: MoreActionsMenuProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>{title}</Text>
        <CloseButton onPress={onClose} />
      </View>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2f36',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
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
