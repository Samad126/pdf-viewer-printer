import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface ViewerHeaderProps {
  fileName: string;
  topInset: number;
  isBusy: boolean;
  onBack: () => void;
  onOpenPrintChoice: () => void;
  onOpenMoreMenu: () => void;
}

export function ViewerHeader({
  fileName,
  topInset,
  isBusy,
  onBack,
  onOpenPrintChoice,
  onOpenMoreMenu,
}: ViewerHeaderProps): React.JSX.Element {
  return (
    <View style={[styles.header, { paddingTop: topInset + 12 }]}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={styles.backLabel}>{'< Back'}</Text>
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {fileName}
      </Text>
      <View style={styles.headerButtons}>
        <Pressable
          onPress={onOpenPrintChoice}
          disabled={isBusy}
          style={[styles.printButton, isBusy && styles.printButtonDisabled]}
        >
          <Text style={styles.printLabel}>Print</Text>
        </Pressable>
        <Pressable onPress={onOpenMoreMenu} hitSlop={12} style={styles.moreButton}>
          <Text style={styles.moreLabel}>⋯</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#101418',
  },
  backLabel: {
    color: '#63a4ff',
    fontSize: 16,
  },
  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    marginHorizontal: 12,
  },
  headerButtons: {
    flexDirection: 'row',
  },
  printButton: {
    backgroundColor: '#2f6fed',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  printButtonDisabled: {
    opacity: 0.5,
  },
  printLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
  moreButton: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1c2128',
  },
  moreLabel: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 18,
  },
});
