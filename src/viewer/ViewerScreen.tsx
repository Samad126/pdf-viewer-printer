import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import type { PdfError } from 'react-native-pdf';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrintProgressView } from '../print/PrintProgressView';
import { usePrintPipeline } from '../print/usePrintPipeline';
import { IppPrintProgressView } from '../printers/IppPrintProgressView';
import { PrintOptionsView } from '../printers/PrintOptionsView';
import { PrinterPickerView } from '../printers/PrinterPickerView';
import { useIppDiscovery } from '../printers/useIppDiscovery';
import { useIppPrintPipeline } from '../printers/useIppPrintPipeline';
import type { IppPrintOptions, IppPrinterTarget } from '../printers/types';

interface ViewerScreenProps {
  filePath: string;
  fileName: string;
  onBack: () => void;
}

export function ViewerScreen({ filePath, fileName, onBack }: ViewerScreenProps): React.JSX.Element {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showPrinterPicker, setShowPrinterPicker] = useState(false);
  const [printOptionsTarget, setPrintOptionsTarget] = useState<IppPrinterTarget | null>(null);
  const { state, startPrint, reset } = usePrintPipeline();
  const discovery = useIppDiscovery();
  const {
    state: ippState,
    startPrint: startIppPrint,
    cancel: cancelIppPrint,
    reset: resetIppPrint,
  } = useIppPrintPipeline();

  const handleLoadComplete = useCallback((numberOfPages: number) => {
    setPageCount(numberOfPages);
  }, []);

  const handleError = useCallback((error: PdfError) => {
    setLoadError(error.message ?? 'Failed to load PDF');
  }, []);

  const handlePrint = useCallback(() => {
    reset();
    startPrint(filePath, fileName).catch(() => undefined);
  }, [filePath, fileName, reset, startPrint]);

  const handleOpenPrinterPicker = useCallback(() => {
    resetIppPrint();
    setPrintOptionsTarget(null);
    setShowPrinterPicker(true);
    discovery.start().catch(() => undefined);
  }, [discovery, resetIppPrint]);

  const handleClosePrinterPicker = useCallback(() => {
    setShowPrinterPicker(false);
    discovery.stop().catch(() => undefined);
  }, [discovery]);

  const handleSelectPrinter = useCallback(
    (target: IppPrinterTarget) => {
      setShowPrinterPicker(false);
      discovery.stop().catch(() => undefined);
      setPrintOptionsTarget(target);
    },
    [discovery],
  );

  const handleCancelPrintOptions = useCallback(() => {
    setPrintOptionsTarget(null);
  }, []);

  const handleSubmitPrintOptions = useCallback(
    (printOptions: IppPrintOptions) => {
      const target = printOptionsTarget;
      setPrintOptionsTarget(null);
      if (target == null) return;
      startIppPrint(filePath, fileName, target, printOptions).catch(() => undefined);
    },
    [filePath, fileName, printOptionsTarget, startIppPrint],
  );

  const handleCancelIppPrint = useCallback(() => {
    cancelIppPrint().catch(() => undefined);
  }, [cancelIppPrint]);

  const isPrintBusy = state.stage !== 'idle' && state.stage !== 'done' && state.stage !== 'error';
  const isIppBusy =
    ippState.stage !== 'idle' &&
    ippState.stage !== 'done' &&
    ippState.stage !== 'error' &&
    ippState.stage !== 'cancelled';
  const isOptionsOpen = printOptionsTarget != null;
  const isBusy = isPrintBusy || isIppBusy || isOptionsOpen;
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.backLabel}>{'< Back'}</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {fileName}
        </Text>
        <View style={styles.headerButtons}>
          <Pressable
            onPress={handleOpenPrinterPicker}
            disabled={isBusy}
            style={[styles.printButton, styles.directPrintButton, isBusy && styles.printButtonDisabled]}
          >
            <Text style={styles.printLabel}>Print directly</Text>
          </Pressable>
          <Pressable
            onPress={handlePrint}
            disabled={isBusy}
            style={[styles.printButton, isBusy && styles.printButtonDisabled]}
          >
            <Text style={styles.printLabel}>Print</Text>
          </Pressable>
        </View>
      </View>

      {loadError != null ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      ) : (
        <Pdf
          source={{ uri: filePath }}
          style={styles.pdf}
          onLoadComplete={handleLoadComplete}
          onPageChanged={page => setCurrentPage(page)}
          onError={handleError}
          renderActivityIndicator={() => (
            <View style={styles.centered}>
              <ActivityIndicator size="large" />
            </View>
          )}
        />
      )}

      {pageCount != null && (
        <View style={styles.pageIndicator}>
          <Text style={styles.pageIndicatorText}>
            Page {currentPage} / {pageCount}
          </Text>
        </View>
      )}

      {showPrinterPicker && (
        <View style={styles.progressOverlay}>
          <PrinterPickerView discovery={discovery.state} onSelect={handleSelectPrinter} disabled={isBusy} />
          <Pressable onPress={handleClosePrinterPicker} style={styles.cancelPickerButton}>
            <Text style={styles.cancelPickerLabel}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {!showPrinterPicker && printOptionsTarget != null && (
        <View style={styles.progressOverlay}>
          <PrintOptionsView
            pageCount={pageCount ?? 0}
            onSubmit={handleSubmitPrintOptions}
            onCancel={handleCancelPrintOptions}
          />
        </View>
      )}

      {!showPrinterPicker && printOptionsTarget == null && state.stage !== 'idle' && (
        <View style={styles.progressOverlay}>
          <PrintProgressView state={state} />
        </View>
      )}

      {!showPrinterPicker && printOptionsTarget == null && state.stage === 'idle' && ippState.stage !== 'idle' && (
        <View style={styles.progressOverlay}>
          <IppPrintProgressView state={ippState} onCancel={handleCancelIppPrint} />
        </View>
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
    paddingVertical: 12,
    backgroundColor: '#101418',
  },
  backLabel: {
    color: '#63a4ff',
    fontSize: 16,
  },
  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    marginHorizontal: 12,
  },
  headerButtons: {
    flexDirection: 'row',
  },
  printButton: {
    backgroundColor: '#2f6fed',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  directPrintButton: {
    backgroundColor: '#1f8a4c',
    marginRight: 8,
  },
  printButtonDisabled: {
    opacity: 0.5,
  },
  printLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
  pdf: {
    flex: 1,
    width: '100%',
    backgroundColor: '#1a1a1a',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#ff6b6b',
    padding: 16,
    textAlign: 'center',
  },
  pageIndicator: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pageIndicatorText: {
    color: '#ffffff',
    fontSize: 12,
  },
  progressOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 40,
  },
  cancelPickerButton: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelPickerLabel: {
    color: '#a0a8b4',
    fontWeight: '600',
  },
});
