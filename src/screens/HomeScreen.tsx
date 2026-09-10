import { pick, isErrorWithCode, errorCodes, types, keepLocalCopy } from '@react-native-documents/picker';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RecentFilesScreen } from './RecentFilesScreen';
import { RecentThumbnail } from './RecentThumbnail';
import { loadRecentFiles } from './recentFiles';
import type { RecentFile } from './recentFiles';

interface HomeScreenProps {
  onFilePicked: (filePath: string, fileName: string) => void;
}

const MAX_HOME_RECENTS = 4;
const CARD_THUMBNAIL_WIDTH = 64;
const CARD_THUMBNAIL_HEIGHT = 84;

export function HomeScreen({ onFilePicked }: HomeScreenProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [showAllRecents, setShowAllRecents] = useState(false);

  // HomeScreen fully unmounts/remounts each time the app returns here from the viewer (App.tsx
  // swaps between the two, it doesn't just hide this one), so loading fresh on mount already
  // picks up anything opened since the last time this screen was visible.
  useEffect(() => {
    let cancelled = false;
    loadRecentFiles().then(files => {
      if (!cancelled) setRecentFiles(files);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePick = useCallback(async () => {
    setError(null);
    try {
      const [picked] = await pick({ type: [types.pdf] });
      const [copy] = await keepLocalCopy({
        files: [{ uri: picked.uri, fileName: picked.name ?? 'document.pdf' }],
        destination: 'cachesDirectory',
      });

      if (copy.status === 'error') {
        setError(copy.copyError);
        return;
      }

      onFilePicked(copy.localUri, picked.name ?? 'document.pdf');
    } catch (pickError) {
      if (isErrorWithCode(pickError) && pickError.code === errorCodes.OPERATION_CANCELED) {
        return;
      }
      setError(pickError instanceof Error ? pickError.message : String(pickError));
    }
  }, [onFilePicked]);

  if (showAllRecents) {
    return (
      <RecentFilesScreen files={recentFiles} onSelectFile={onFilePicked} onClose={() => setShowAllRecents(false)} />
    );
  }

  const homeRecents = recentFiles.slice(0, MAX_HOME_RECENTS);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>PDF Printer</Text>
      <Text style={styles.subtitle}>
        Pick a PDF to view it, or print it through a PDFium-rasterized, font-free copy.
      </Text>

      <Pressable style={styles.pickButton} onPress={handlePick}>
        <Text style={styles.pickButtonLabel}>Choose a PDF</Text>
      </Pressable>

      {error != null && <Text style={styles.errorText}>{error}</Text>}

      {homeRecents.length > 0 && (
        <View style={styles.recentsSection}>
          <View style={styles.recentsHeader}>
            <Text style={styles.recentsTitle}>Recent</Text>
            <Pressable onPress={() => setShowAllRecents(true)} hitSlop={8}>
              <Text style={styles.viewAllLabel}>View all</Text>
            </Pressable>
          </View>

          <View style={styles.recentsGrid}>
            {homeRecents.map(file => (
              <Pressable key={file.path} style={styles.recentCard} onPress={() => onFilePicked(file.path, file.name)}>
                <RecentThumbnail
                  thumbnailPath={file.thumbnailPath}
                  width={CARD_THUMBNAIL_WIDTH}
                  height={CARD_THUMBNAIL_HEIGHT}
                />
                <Text style={styles.recentCardName} numberOfLines={1}>
                  {file.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#000000',
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#a0a0a0',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 32,
  },
  pickButton: {
    backgroundColor: '#2f6fed',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 10,
  },
  pickButtonLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    color: '#ff6b6b',
    marginTop: 20,
    textAlign: 'center',
  },
  recentsSection: {
    width: '100%',
    marginTop: 32,
  },
  recentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  recentsTitle: {
    color: '#a0a8b4',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  viewAllLabel: {
    color: '#63a4ff',
    fontSize: 13,
    fontWeight: '600',
  },
  recentsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  recentCard: {
    width: CARD_THUMBNAIL_WIDTH,
    alignItems: 'center',
  },
  recentCardName: {
    color: '#d0d5dd',
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
    width: '100%',
  },
});
