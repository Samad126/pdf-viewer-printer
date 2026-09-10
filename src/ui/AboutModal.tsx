import React from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CloseButton } from './CloseButton';

interface AboutModalProps {
  onClose: () => void;
}

const GITHUB_URL = 'https://github.com/Samad126/pdf-viewer-printer';
const APP_VERSION = '1.0';

/**
 * Uses RN's own Modal rather than another custom overlay View: it renders in a native top-level
 * window above everything else regardless of where it's mounted (so the same component works
 * unmodified from both HomeScreen and the viewer's "More actions" menu), and Android hardware/
 * gesture back closes it automatically via onRequestClose, with no BackHandler wiring needed.
 */
export function AboutModal({ onClose }: AboutModalProps): React.JSX.Element {
  const handleOpenGitHub = () => {
    Linking.openURL(GITHUB_URL).catch(() => undefined);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>PDF Press</Text>
            <CloseButton onPress={onClose} />
          </View>

          <Text style={styles.version}>Version {APP_VERSION}</Text>
          <Text style={styles.description}>
            A PDF viewer and printer that rasterizes every page through PDFium, so printing and
            viewing stay correct even on PDFs with embedded fonts Android's own PdfRenderer
            mishandles.
          </Text>

          <Pressable onPress={handleOpenGitHub} hitSlop={8}>
            <Text style={styles.link}>{GITHUB_URL}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#101418',
    borderRadius: 14,
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  version: {
    color: '#6b7280',
    fontSize: 13,
    marginBottom: 14,
  },
  description: {
    color: '#d0d5dd',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  link: {
    color: '#63a4ff',
    fontSize: 14,
    fontWeight: '600',
  },
});
