import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CloseButton } from '../ui/CloseButton';
import type { IppDiscoveredPrinter, IppDiscoveryState, IppPrinterTarget } from './types';

interface PrinterPickerViewProps {
  discovery: IppDiscoveryState;
  onSelect: (target: IppPrinterTarget) => void;
  onClose: () => void;
  disabled?: boolean;
}

const DEFAULT_MANUAL_PORT = '631';
const DEFAULT_MANUAL_RESOURCE_PATH = 'ipp/print';

export function PrinterPickerView({
  discovery,
  onSelect,
  onClose,
  disabled = false,
}: PrinterPickerViewProps): React.JSX.Element {
  const [manualHost, setManualHost] = useState('');
  const [manualPort, setManualPort] = useState(DEFAULT_MANUAL_PORT);
  const [manualResourcePath, setManualResourcePath] = useState(DEFAULT_MANUAL_RESOURCE_PATH);

  const handleSelectDiscovered = useCallback(
    (printer: IppDiscoveredPrinter) => {
      onSelect({ host: printer.host, port: printer.port, resourcePath: printer.resourcePath });
    },
    [onSelect],
  );

  const handleManualSubmit = useCallback(() => {
    const port = Number.parseInt(manualPort, 10);
    if (manualHost.trim().length === 0 || Number.isNaN(port)) {
      return;
    }
    onSelect({
      host: manualHost.trim(),
      port,
      resourcePath: manualResourcePath.trim() || DEFAULT_MANUAL_RESOURCE_PATH,
    });
  }, [manualHost, manualPort, manualResourcePath, onSelect]);

  const isUnavailable = discovery.stage === 'unavailable';
  const manualIsValid = manualHost.trim().length > 0 && !Number.isNaN(Number.parseInt(manualPort, 10));

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Select a printer</Text>
        <CloseButton onPress={onClose} />
      </View>

      {discovery.stage === 'discovering' && discovery.printers.length === 0 && (
        <Text style={styles.hint}>Searching the local network for printers…</Text>
      )}

      {discovery.errorMessage != null && <Text style={styles.errorText}>{discovery.errorMessage}</Text>}

      {discovery.printers.length > 0 && (
        <FlatList
          style={styles.list}
          data={discovery.printers}
          keyExtractor={item => `${item.name}:${item.host}:${item.port}`}
          renderItem={({ item }) => (
            <Pressable
              style={styles.printerRow}
              disabled={disabled}
              onPress={() => handleSelectDiscovered(item)}
            >
              <Text style={styles.printerName}>{item.name}</Text>
              <Text style={styles.printerAddress}>
                {item.host}:{item.port}/{item.resourcePath}
              </Text>
            </Pressable>
          )}
        />
      )}

      <View style={[styles.manualSection, isUnavailable && styles.manualSectionProminent]}>
        <Text style={styles.manualTitle}>
          {isUnavailable ? 'Enter printer address manually' : 'Or enter an address manually'}
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Host or IP address"
          placeholderTextColor="#6b7280"
          value={manualHost}
          onChangeText={setManualHost}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
        />
        <View style={styles.manualRow}>
          <TextInput
            style={[styles.input, styles.manualRowField]}
            placeholder="Port"
            placeholderTextColor="#6b7280"
            value={manualPort}
            onChangeText={setManualPort}
            keyboardType="number-pad"
            editable={!disabled}
          />
          <TextInput
            style={[styles.input, styles.manualRowField]}
            placeholder="Resource path"
            placeholderTextColor="#6b7280"
            value={manualResourcePath}
            onChangeText={setManualResourcePath}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
          />
        </View>
        <Pressable
          style={[styles.submitButton, (disabled || !manualIsValid) && styles.submitButtonDisabled]}
          disabled={disabled || !manualIsValid}
          onPress={handleManualSubmit}
        >
          <Text style={styles.submitLabel}>Use this printer</Text>
        </Pressable>
      </View>
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
    marginBottom: 8,
  },
  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    color: '#c7c7c7',
    marginBottom: 8,
  },
  errorText: {
    color: '#ff6b6b',
    marginBottom: 8,
  },
  list: {
    maxHeight: 180,
    marginBottom: 8,
  },
  printerRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1a2028',
    marginBottom: 6,
  },
  printerName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  printerAddress: {
    color: '#a0a8b4',
    fontSize: 12,
    marginTop: 2,
  },
  manualSection: {
    marginTop: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#161c24',
  },
  manualSectionProminent: {
    backgroundColor: '#1a2438',
    borderWidth: 1,
    borderColor: '#2f6fed',
  },
  manualTitle: {
    color: '#ffffff',
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0c0f13',
    color: '#ffffff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  manualRow: {
    flexDirection: 'row',
  },
  manualRowField: {
    flex: 1,
    marginRight: 8,
  },
  submitButton: {
    backgroundColor: '#2f6fed',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
