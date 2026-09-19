import { pick, isErrorWithCode, errorCodes, types, keepLocalCopy } from '@react-native-documents/picker';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DOCX_MIME_TYPE } from '../docx';
import { AboutModal } from '../ui/AboutModal';
import { RecentFilesScreen } from './RecentFilesScreen';
import { RecentThumbnail } from './RecentThumbnail';
import { loadRecentFiles, removeRecentFile } from './recentFiles';
import type { RecentFile } from './recentFiles';

interface HomeScreenProps {
  onFilePicked: (filePath: string, fileName: string) => void;
}

const MAX_HOME_RECENTS = 4;
const CARD_THUMBNAIL_WIDTH = 64;
const CARD_THUMBNAIL_HEIGHT = 84;

export function HomeScreen({ onFilePicked }: HomeScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [showAllRecents, setShowAllRecents] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

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

  const handleRemoveRecent = useCallback((path: string) => {
    removeRecentFile(path)
      .then(setRecentFiles)
      .catch(() => undefined);
  }, []);

  const handlePick = useCallback(async () => {
    setError(null);
    try {
      const [picked] = await pick({ type: [types.pdf, types.docx] });
      // Only used when the provider reports no display name at all, where the extension decides
      // which of the app's two opening paths this file takes.
      const fallbackName = picked.type === DOCX_MIME_TYPE ? 'document.docx' : 'document.pdf';
      const name = picked.name ?? fallbackName;

      const [copy] = await keepLocalCopy({
        files: [{ uri: picked.uri, fileName: name }],
        destination: 'cachesDirectory',
      });

      if (copy.status === 'error') {
        setError(copy.copyError);
        return;
      }

      onFilePicked(copy.localUri, name);
    } catch (pickError) {
      if (isErrorWithCode(pickError) && pickError.code === errorCodes.OPERATION_CANCELED) {
        return;
      }
      setError(pickError instanceof Error ? pickError.message : String(pickError));
    }
  }, [onFilePicked]);

  if (showAllRecents) {
    return (
      <RecentFilesScreen
        files={recentFiles}
        onSelectFile={onFilePicked}
        onRemoveFile={handleRemoveRecent}
        onClose={() => setShowAllRecents(false)}
      />
    );
  }

  const homeRecents = recentFiles.slice(0, MAX_HOME_RECENTS);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>PDF Printer</Text>
      <Text style={styles.subtitle}>
        Pick a PDF to view it, or print it through a PDFium-rasterized, font-free copy. Word
        documents can be opened too - they are converted to PDF on the device first.
      </Text>

      <Pressable style={styles.pickButton} onPress={handlePick}>
        <Text style={styles.pickButtonLabel}>Choose a document</Text>
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
                <View style={styles.recentThumbnailWrapper}>
                  <RecentThumbnail
                    thumbnailPath={file.thumbnailPath}
                    width={CARD_THUMBNAIL_WIDTH}
                    height={CARD_THUMBNAIL_HEIGHT}
                  />
                  <Pressable
                    style={styles.recentRemoveButton}
                    onPress={() => handleRemoveRecent(file.path)}
                    hitSlop={10}
                  >
                    <Text style={styles.recentRemoveIcon}>✕</Text>
                  </Pressable>
                </View>
                <Text style={styles.recentCardName} numberOfLines={1}>
                  {file.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <Pressable
        style={[styles.aboutButton, { top: insets.top + 16 }]}
        onPress={() => setShowAbout(true)}
        hitSlop={8}
      >
        <Text style={styles.aboutLabel}>About</Text>
      </Pressable>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
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
    gap: 16,
  },
  recentCard: {
    width: CARD_THUMBNAIL_WIDTH,
    alignItems: 'center',
  },
  recentThumbnailWrapper: {
    width: CARD_THUMBNAIL_WIDTH,
    height: CARD_THUMBNAIL_HEIGHT,
  },
  recentRemoveButton: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#101418',
    borderWidth: 1,
    borderColor: '#2a2f36',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentRemoveIcon: {
    color: '#a0a8b4',
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 9,
  },
  recentCardName: {
    color: '#d0d5dd',
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
    width: '100%',
  },
  aboutButton: {
    position: 'absolute',
    right: 20,
  },
  aboutLabel: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
  },
});
