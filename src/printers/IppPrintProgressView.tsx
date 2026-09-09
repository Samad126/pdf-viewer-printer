import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { isTerminalJobState } from './types';
import type { IppPrintErrorKind, IppPrintPipelineState } from './types';

interface IppPrintProgressViewProps {
  state: IppPrintPipelineState;
  onCancel?: () => void;
}

const STAGE_LABELS: Record<IppPrintPipelineState['stage'], string> = {
  idle: '',
  inspecting: 'Inspecting PDF…',
  rasterizing: 'Rasterizing pages…',
  submitting: 'Sending directly to printer…',
  done: 'Sent to printer',
  cancelled: 'Job cancelled',
  error: 'Print failed',
};

const ERROR_KIND_MESSAGES: Record<IppPrintErrorKind, string> = {
  unreachable: "Printer not found on the network — check it's powered on and connected to WiFi.",
  timeout: 'The printer did not respond in time. It may be busy or out of range.',
  rejected: 'The printer rejected the print job.',
  permission_denied: 'Local network access is needed to find printers. Enter the address manually instead.',
  unknown: 'Something went wrong while printing directly to this printer.',
};

export function IppPrintProgressView({ state, onCancel }: IppPrintProgressViewProps): React.JSX.Element | null {
  if (state.stage === 'idle') {
    return null;
  }

  const errorDetail = state.errorKind != null ? ERROR_KIND_MESSAGES[state.errorKind] : null;
  const isSpinning = state.stage !== 'done' && state.stage !== 'error' && state.stage !== 'cancelled';
  const jobFinished = state.jobState != null && isTerminalJobState(state.jobState);
  const canCancel =
    onCancel != null &&
    !jobFinished &&
    (state.stage === 'rasterizing' || state.stage === 'submitting' || (state.stage === 'done' && state.jobId != null));

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        {isSpinning && <ActivityIndicator size="small" style={styles.spinner} />}
        <Text style={styles.stageLabel}>{STAGE_LABELS[state.stage]}</Text>
      </View>

      {state.stage === 'rasterizing' && state.totalPages > 0 && (
        <Text style={styles.progressText}>
          Page {state.currentPage} of {state.totalPages}
        </Text>
      )}

      {state.stage === 'cancelled' && (
        <Text style={styles.cancelledText}>The print job was cancelled.</Text>
      )}

      {errorDetail != null && <Text style={styles.errorText}>{errorDetail}</Text>}
      {state.errorMessage != null && <Text style={styles.errorDetailText}>{state.errorMessage}</Text>}

      {state.stage === 'done' && (
        <Text style={styles.successText}>
          {jobFinished ? 'Printed.' : state.submitResult?.statusMessage ?? 'Printer accepted the job.'}
        </Text>
      )}

      {canCancel && (
        <Pressable style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelLabel}>Cancel print job</Text>
        </Pressable>
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
  cancelledText: {
    color: '#a0a8b4',
    marginTop: 8,
  },
  errorText: {
    color: '#ff6b6b',
    marginTop: 8,
  },
  errorDetailText: {
    color: '#ff9b9b',
    marginTop: 4,
    fontSize: 12,
  },
  successText: {
    color: '#63e6be',
    marginTop: 8,
  },
  cancelButton: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2a1414',
  },
  cancelLabel: {
    color: '#ff6b6b',
    fontWeight: '600',
  },
});
