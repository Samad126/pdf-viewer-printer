import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { CloseButton } from '../ui/CloseButton';
import type { ExportPipelineState } from './types';

interface ExportProgressViewProps {
  state: ExportPipelineState;
  onDismiss?: () => void;
}

function stageLabel(state: ExportPipelineState): string {
  switch (state.stage) {
    case 'idle':
      return '';
    case 'rendering':
      return state.kind === 'text' ? 'Extracting text…' : 'Rendering pages…';
    case 'zipping':
      return 'Compressing pages…';
    case 'saving':
      return 'Choose where to save…';
    case 'done':
      return 'Export complete';
    case 'error':
      return 'Export failed';
    default:
      return '';
  }
}

export function ExportProgressView({ state, onDismiss }: ExportProgressViewProps): React.JSX.Element | null {
  if (state.stage === 'idle') {
    return null;
  }

  const canDismiss = onDismiss != null && (state.stage === 'done' || state.stage === 'error');

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          {state.stage !== 'done' && state.stage !== 'error' && (
            <ActivityIndicator size="small" style={styles.spinner} />
          )}
          <Text style={styles.stageLabel}>{stageLabel(state)}</Text>
        </View>
        {canDismiss && <CloseButton onPress={onDismiss} />}
      </View>

      {state.stage === 'rendering' && state.kind === 'images' && state.totalPages > 0 && (
        <Text style={styles.progressText}>
          Page {state.currentPage} of {state.totalPages}
        </Text>
      )}

      {state.errorMessage != null && <Text style={styles.errorText}>{state.errorMessage}</Text>}

      {state.stage === 'done' && state.outputName != null && (
        <Text style={styles.successText}>Saved as {state.outputName}</Text>
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
    color: '#a0a8b4',
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
});
