import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CloseButton } from '../ui/CloseButton';
import type { DocxConversionState } from './useDocxConversion';

interface DocxConversionModalProps {
  state: DocxConversionState;
  onDismissError: () => void;
  onCancel: () => void;
}

/**
 * The wait while a Word document is rendered to PDF, and the error card if that fails.
 *
 * A Modal rather than an inline overlay, matching AboutModal: it blocks interaction with HomeScreen
 * underneath while a conversion is running (which is the point - a second conversion cannot start
 * anyway), and Android back is handled by onRequestClose with no BackHandler wiring.
 */
export function DocxConversionModal({
  state,
  onDismissError,
  onCancel,
}: DocxConversionModalProps): React.JSX.Element | null {
  if (state.stage === 'idle') {
    return null;
  }

  const failed = state.stage === 'error';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={failed ? onDismissError : onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{failed ? 'Could not open this document' : 'Opening Word document'}</Text>
            <CloseButton onPress={failed ? onDismissError : onCancel} accessibilityLabel={failed ? 'Close' : 'Cancel'} />
          </View>

          <Text style={styles.fileName} numberOfLines={2}>
            {state.fileName}
          </Text>

          {failed ? (
            <Text style={styles.errorText}>{state.message}</Text>
          ) : (
            <>
              <View style={styles.progressRow}>
                <ActivityIndicator size="small" style={styles.spinner} />
                <Text style={styles.progressText}>Rendering…</Text>
              </View>
              {/* Named so the wait is legible for what it is: the document is being laid out and
                  re-encoded, and the result opens as a normal PDF with every other feature. */}
              <Text style={styles.hint}>
                Converting to PDF. The converted document can be printed, drawn on and exported like
                any other PDF.
              </Text>
              <Pressable onPress={onCancel} hitSlop={8} style={styles.cancelButton}>
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#101418',
    borderRadius: 12,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  fileName: {
    color: '#d0d5dd',
    fontSize: 14,
    marginTop: 8,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  spinner: {
    marginRight: 8,
  },
  progressText: {
    color: '#a0a8b4',
    fontSize: 14,
  },
  hint: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 10,
    lineHeight: 17,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 14,
    marginTop: 12,
    lineHeight: 20,
  },
  cancelButton: {
    alignSelf: 'flex-start',
    marginTop: 16,
  },
  cancelLabel: {
    color: '#63a4ff',
    fontSize: 14,
    fontWeight: '600',
  },
});
