import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TableContent } from 'react-native-pdf';

interface TableOfContentsPanelProps {
  entries: TableContent[];
  onSelectPage: (pageIndex: number) => void;
  onClose: () => void;
}

export function TableOfContentsPanel({ entries, onSelectPage, onClose }: TableOfContentsPanelProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Contents</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.closeLabel}>Close</Text>
        </Pressable>
      </View>
      {entries.length === 0 ? (
        <Text style={styles.emptyText}>This PDF has no table of contents.</Text>
      ) : (
        <ScrollView style={styles.list}>
          <TableOfContentsEntries entries={entries} depth={0} onSelectPage={onSelectPage} />
        </ScrollView>
      )}
    </View>
  );
}

function TableOfContentsEntries({
  entries,
  depth,
  onSelectPage,
}: {
  entries: TableContent[];
  depth: number;
  onSelectPage: (pageIndex: number) => void;
}): React.JSX.Element {
  return (
    <>
      {entries.map((entry, index) => (
        <View key={`${depth}-${index}-${entry.title}`}>
          <Pressable
            style={[styles.entryRow, { paddingLeft: 16 + depth * 16 }]}
            onPress={() => onSelectPage(entry.pageIdx)}
          >
            <Text style={styles.entryLabel} numberOfLines={2}>
              {entry.title}
            </Text>
          </Pressable>
          {entry.children.length > 0 && (
            <TableOfContentsEntries entries={entry.children} depth={depth + 1} onSelectPage={onSelectPage} />
          )}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#101418',
    borderRadius: 12,
    maxHeight: '70%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2f36',
  },
  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  closeLabel: {
    color: '#63a4ff',
    fontWeight: '600',
  },
  emptyText: {
    color: '#a0a8b4',
    padding: 16,
  },
  list: {
    paddingVertical: 4,
  },
  entryRow: {
    paddingVertical: 10,
    paddingRight: 16,
  },
  entryLabel: {
    color: '#e6e6e6',
    fontSize: 14,
  },
});
