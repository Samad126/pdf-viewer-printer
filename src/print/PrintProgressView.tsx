import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { CloseButton } from '../ui/CloseButton';
import type { PrintPipelineState } from './types';

interface PrintProgressViewProps {
  state: PrintPipelineState;
  onDismiss?: () => void;
}

const STAGE_LABELS: Record<PrintPipelineState['stage'], string> = {
  idle: '',
  inspecting: 'Inspecting PDF…',
  rasterizing: 'Rasterizing pages…',
  submitting: 'Sending to printer…',
  done: 'Sent to printer',
  error: 'Print failed',
};

export function PrintProgressView({ state, onDismiss }: PrintProgressViewProps): React.JSX.Element | null {
  if (state.stage === 'idle') {
    return null;
  }

  const failedPages = state.pageResults.filter(page => !page.success);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          {state.stage !== 'done' && state.stage !== 'error' && (
            <ActivityIndicator size="small" style={styles.spinner} />
          )}
          <Text style={styles.stageLabel}>{STAGE_LABELS[state.stage]}</Text>
        </View>
        {onDismiss != null && <CloseButton onPress={onDismiss} />}
      </View>

      {state.stage === 'rasterizing' && state.totalPages > 0 && (
        <Text style={styles.progressText}>
          Page {state.currentPage} of {state.totalPages}
        </Text>
      )}

      {state.errorMessage != null && <Text style={styles.errorText}>{state.errorMessage}</Text>}

      {failedPages.length > 0 && (
        <View style={styles.failuresBox}>
          <Text style={styles.failuresTitle}>
            {failedPages.length} page{failedPages.length === 1 ? '' : 's'} failed to rasterize
          </Text>
          <FlatList
            data={failedPages}
            keyExtractor={item => String(item.pageIndex)}
            renderItem={({ item }) => (
              <Text style={styles.failureItem}>
                Page {item.pageIndex + 1}: {item.error ?? 'Unknown error'}
              </Text>
            )}
          />
        </View>
      )}

      {state.stage === 'done' && (
        <Text style={styles.successText}>
          {state.pageResults.filter(page => page.success).length} of {state.pageResults.length} pages
          printed successfully.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#101418',
    borderRadius: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spinner: {
    marginRight: 8,
  },
  stageLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  progressText: {
    color: '#c7c7c7',
    marginTop: 6,
  },
  errorText: {
    color: '#ff6b6b',
    marginTop: 8,
  },
  successText: {
    color: '#63e6be',
    marginTop: 8,
  },
  failuresBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#2a1414',
    maxHeight: 160,
  },
  failuresTitle: {
    color: '#ffb4b4',
    fontWeight: '600',
    marginBottom: 6,
  },
  failureItem: {
    color: '#ffb4b4',
    fontSize: 13,
    marginBottom: 4,
  },
});
