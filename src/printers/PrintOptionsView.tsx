import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CloseButton } from '../ui/CloseButton';
import { parsePageRangeInput } from './pageRange';
import { DEFAULT_IPP_PRINT_OPTIONS, IppPrintOptions } from './types';

interface PrintOptionsViewProps {
  pageCount: number;
  onSubmit: (printOptions: IppPrintOptions) => void;
  onCancel: () => void;
  disabled?: boolean;
}

const MIN_COPIES = 1;
const MAX_COPIES = 999;

const COLOR_MODE_OPTIONS: Array<{ value: IppPrintOptions['colorMode']; label: string }> = [
  { value: 'color', label: 'Color' },
  { value: 'monochrome', label: 'Grayscale' },
];

const SIDES_OPTIONS: Array<{ value: IppPrintOptions['sides']; label: string }> = [
  { value: 'one-sided', label: 'Off' },
  { value: 'two-sided-long-edge', label: 'Long-edge' },
  { value: 'two-sided-short-edge', label: 'Short-edge' },
];

const ORIENTATION_OPTIONS: Array<{ value: IppPrintOptions['orientation']; label: string }> = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

export function PrintOptionsView({
  pageCount,
  onSubmit,
  onCancel,
  disabled = false,
}: PrintOptionsViewProps): React.JSX.Element {
  const [copies, setCopies] = useState(DEFAULT_IPP_PRINT_OPTIONS.copies);
  const [pageRange, setPageRange] = useState(DEFAULT_IPP_PRINT_OPTIONS.pageRange);
  const [colorMode, setColorMode] = useState(DEFAULT_IPP_PRINT_OPTIONS.colorMode);
  const [sides, setSides] = useState(DEFAULT_IPP_PRINT_OPTIONS.sides);
  const [orientation, setOrientation] = useState(DEFAULT_IPP_PRINT_OPTIONS.orientation);

  const pageRangeError = useMemo(() => {
    if (pageCount <= 0) return null;
    try {
      parsePageRangeInput(pageRange, pageCount);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [pageRange, pageCount]);

  const handleDecrement = useCallback(() => {
    setCopies(previous => Math.max(MIN_COPIES, previous - 1));
  }, []);

  const handleIncrement = useCallback(() => {
    setCopies(previous => Math.min(MAX_COPIES, previous + 1));
  }, []);

  const handleCopiesTextChange = useCallback((text: string) => {
    const digitsOnly = text.replace(/[^0-9]/g, '');
    if (digitsOnly.length === 0) {
      setCopies(MIN_COPIES);
      return;
    }
    setCopies(Math.max(MIN_COPIES, Math.min(MAX_COPIES, Number.parseInt(digitsOnly, 10))));
  }, []);

  const canSubmit = !disabled && pageRangeError == null;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit({ copies, pageRange, colorMode, sides, orientation });
  }, [canSubmit, colorMode, copies, onSubmit, orientation, pageRange, sides]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Print options</Text>
        <CloseButton onPress={onCancel} />
      </View>

      <Text style={styles.label}>Copies</Text>
      <View style={styles.stepperRow}>
        <Pressable style={styles.stepperButton} onPress={handleDecrement} disabled={disabled}>
          <Text style={styles.stepperButtonLabel}>−</Text>
        </Pressable>
        <TextInput
          style={styles.stepperInput}
          value={String(copies)}
          onChangeText={handleCopiesTextChange}
          keyboardType="number-pad"
          editable={!disabled}
        />
        <Pressable style={styles.stepperButton} onPress={handleIncrement} disabled={disabled}>
          <Text style={styles.stepperButtonLabel}>+</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Page range</Text>
      <TextInput
        style={[styles.input, pageRangeError != null && styles.inputInvalid]}
        placeholder="e.g. 1-3, 5 (leave blank for all)"
        placeholderTextColor="#6b7280"
        value={pageRange}
        onChangeText={setPageRange}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
      />
      {pageRangeError != null && <Text style={styles.errorText}>{pageRangeError}</Text>}

      <Text style={styles.label}>Color</Text>
      <SegmentedControl options={COLOR_MODE_OPTIONS} value={colorMode} onChange={setColorMode} disabled={disabled} />

      <Text style={styles.label}>Duplex</Text>
      <SegmentedControl options={SIDES_OPTIONS} value={sides} onChange={setSides} disabled={disabled} />

      <Text style={styles.label}>Orientation</Text>
      <SegmentedControl
        options={ORIENTATION_OPTIONS}
        value={orientation}
        onChange={setOrientation}
        disabled={disabled}
      />

      <Pressable
        style={[styles.printButton, !canSubmit && styles.printButtonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
      >
        <Text style={styles.printLabel}>Print</Text>
      </Pressable>
      <Pressable style={styles.cancelButton} onPress={onCancel} disabled={disabled}>
        <Text style={styles.cancelLabel}>Cancel</Text>
      </Pressable>
    </View>
  );
}

interface SegmentedControlProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <View style={styles.segmentedRow}>
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            style={[styles.segmentedOption, selected && styles.segmentedOptionSelected]}
            onPress={() => onChange(option.value)}
            disabled={disabled}
          >
            <Text style={[styles.segmentedLabel, selected && styles.segmentedLabelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
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
  label: {
    color: '#a0a8b4',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 12,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1a2028',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonLabel: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  stepperInput: {
    width: 56,
    marginHorizontal: 8,
    textAlign: 'center',
    backgroundColor: '#0c0f13',
    color: '#ffffff',
    borderRadius: 6,
    paddingVertical: 8,
  },
  input: {
    backgroundColor: '#0c0f13',
    color: '#ffffff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inputInvalid: {
    borderWidth: 1,
    borderColor: '#ff6b6b',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 12,
    marginTop: 6,
  },
  segmentedRow: {
    flexDirection: 'row',
    backgroundColor: '#161c24',
    borderRadius: 8,
    padding: 4,
  },
  segmentedOption: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentedOptionSelected: {
    backgroundColor: '#2f6fed',
  },
  segmentedLabel: {
    color: '#a0a8b4',
    fontSize: 13,
    fontWeight: '600',
  },
  segmentedLabelSelected: {
    color: '#ffffff',
  },
  printButton: {
    backgroundColor: '#1f8a4c',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  printButtonDisabled: {
    opacity: 0.5,
  },
  printLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
  cancelButton: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelLabel: {
    color: '#a0a8b4',
    fontWeight: '600',
  },
});
