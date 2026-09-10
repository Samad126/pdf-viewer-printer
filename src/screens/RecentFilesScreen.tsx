import React, { useEffect } from 'react';
import { BackHandler, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloseButton } from '../ui/CloseButton';
import { RecentThumbnail } from './RecentThumbnail';
import type { RecentFile } from './recentFiles';

interface RecentFilesScreenProps {
  files: RecentFile[];
  onSelectFile: (path: string, name: string) => void;
  onRemoveFile: (path: string) => void;
  onClose: () => void;
}

const ROW_THUMBNAIL_WIDTH = 40;
const ROW_THUMBNAIL_HEIGHT = 52;

function formatRelativeTime(timestampMs: number): string {
  const deltaSeconds = Math.max(Math.floor((Date.now() - timestampMs) / 1000), 0);
  if (deltaSeconds < 60) return 'Just now';
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 7) return `${deltaDays}d ago`;
  return new Date(timestampMs).toLocaleDateString();
}

export function RecentFilesScreen({
  files,
  onSelectFile,
  onRemoveFile,
  onClose,
}: RecentFilesScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.backLabel}>{'< Back'}</Text>
        </Pressable>
        <Text style={styles.title}>Recent files</Text>
        <View style={styles.headerSpacer} />
      </View>

      {files.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No recent files yet.</Text>
        </View>
      ) : (
        <FlatList
          data={files}
          keyExtractor={item => item.path}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => onSelectFile(item.path, item.name)}>
              <RecentThumbnail
                thumbnailPath={item.thumbnailPath}
                width={ROW_THUMBNAIL_WIDTH}
                height={ROW_THUMBNAIL_HEIGHT}
              />
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.rowTime}>{formatRelativeTime(item.openedAt)}</Text>
              </View>
              <CloseButton onPress={() => onRemoveFile(item.path)} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backLabel: {
    color: '#63a4ff',
    fontSize: 16,
    minWidth: 60,
  },
  title: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '600',
  },
  headerSpacer: {
    minWidth: 60,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    color: '#a0a8b4',
    fontSize: 14,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c2128',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  rowText: {
    flex: 1,
    marginLeft: 12,
  },
  rowName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 4,
  },
  rowTime: {
    color: '#6b7280',
    fontSize: 12,
  },
});
