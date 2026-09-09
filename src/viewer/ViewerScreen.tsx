import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import type { PdfError, PdfRef, TableContent } from 'react-native-pdf';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnnotateScreen } from '../annotate/AnnotateScreen';
import { ExportProgressView, FindPanel, sharePdf, useExportPdf } from '../pdf-tools';
import { PrintProgressView } from '../print/PrintProgressView';
import { usePrintPipeline } from '../print/usePrintPipeline';
import { IppPrintProgressView } from '../printers/IppPrintProgressView';
import { PrintOptionsView } from '../printers/PrintOptionsView';
import { PrinterPickerView } from '../printers/PrinterPickerView';
import { useIppDiscovery } from '../printers/useIppDiscovery';
import { useIppPrintPipeline } from '../printers/useIppPrintPipeline';
import type { IppPrintOptions, IppPrinterTarget } from '../printers/types';
import { MoreActionsMenu, MoreActionsMenuItem } from './MoreActionsMenu';
import { NightModeOverlay } from './NightModeOverlay';
import { TableOfContentsPanel } from './TableOfContentsPanel';

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
  const [tableContents, setTableContents] = useState<TableContent[]>([]);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showTableOfContents, setShowTableOfContents] = useState(false);
  const [showFindPanel, setShowFindPanel] = useState(false);
  const [showAnnotate, setShowAnnotate] = useState(false);
  const [nightMode, setNightMode] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const pdfRef = useRef<PdfRef>(null);
  const { state, startPrint, reset } = usePrintPipeline();
  const discovery = useIppDiscovery();
  const {
    state: ippState,
    startPrint: startIppPrint,
    cancel: cancelIppPrint,
    reset: resetIppPrint,
  } = useIppPrintPipeline();
  const { state: exportState, exportAsImages, exportAsText, reset: resetExport } = useExportPdf();

  const handleLoadComplete = useCallback(
    (numberOfPages: number, _path: string, _size: { width: number; height: number }, contents?: TableContent[]) => {
      setPageCount(numberOfPages);
      setTableContents(contents ?? []);
    },
    [],
  );

  const handleSelectTocPage = useCallback((pageIndex: number) => {
    setShowTableOfContents(false);
    pdfRef.current?.setPage(pageIndex + 1);
  }, []);

  const handleJumpFromFind = useCallback((pageIndex: number) => {
    setShowFindPanel(false);
    pdfRef.current?.setPage(pageIndex + 1);
  }, []);

  const handleShare = useCallback(() => {
    setShareError(null);
    setIsSharing(true);
    sharePdf(filePath, fileName)
      .catch(error => {
        setShareError(error instanceof Error ? error.message : 'Failed to share this PDF.');
      })
      .finally(() => setIsSharing(false));
  }, [filePath, fileName]);

  const handleExportImages = useCallback(() => {
    resetExport();
    exportAsImages(filePath, fileName, pageCount ?? 0).catch(() => undefined);
  }, [exportAsImages, filePath, fileName, pageCount, resetExport]);

  const handleExportText = useCallback(() => {
    resetExport();
    exportAsText(filePath, fileName, pageCount ?? 0).catch(() => undefined);
  }, [exportAsText, filePath, fileName, pageCount, resetExport]);

  const handleAnnotateSaved = useCallback(() => {
    setShowAnnotate(false);
  }, []);

  const moreActionsItems: MoreActionsMenuItem[] = [
    {
      key: 'contents',
      label: 'Table of contents',
      disabled: tableContents.length === 0,
      onPress: () => setShowTableOfContents(true),
    },
    {
      key: 'find',
      label: 'Find in document',
      onPress: () => setShowFindPanel(true),
    },
    {
      key: 'annotate',
      label: 'Draw / Annotate',
      disabled: pageCount == null || pageCount === 0,
      onPress: () => setShowAnnotate(true),
    },
    {
      key: 'share',
      label: 'Share…',
      disabled: isSharing,
      onPress: handleShare,
    },
    {
      key: 'export-images',
      label: 'Export as images',
      disabled: pageCount == null || pageCount === 0,
      onPress: handleExportImages,
    },
    {
      key: 'export-text',
      label: 'Export as text',
      disabled: pageCount == null || pageCount === 0,
      onPress: handleExportText,
    },
    {
      key: 'night-mode',
      label: nightMode ? 'Night mode: On' : 'Night mode: Off',
      onPress: () => setNightMode(previous => !previous),
    },
  ];

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

  type OverlayKind =
    | 'none'
    | 'more-menu'
    | 'table-of-contents'
    | 'find'
    | 'printer-picker'
    | 'print-options'
    | 'export'
    | 'share-error'
    | 'print-progress'
    | 'ipp-progress';

  const activeOverlay: OverlayKind = showMoreMenu
    ? 'more-menu'
    : showTableOfContents
      ? 'table-of-contents'
      : showFindPanel
        ? 'find'
        : showPrinterPicker
          ? 'printer-picker'
          : printOptionsTarget != null
            ? 'print-options'
            : exportState.stage !== 'idle'
              ? 'export'
              : shareError != null
                ? 'share-error'
                : state.stage !== 'idle'
                  ? 'print-progress'
                  : ippState.stage !== 'idle'
                    ? 'ipp-progress'
                    : 'none';

  if (showAnnotate) {
    return (
      <AnnotateScreen
        filePath={filePath}
        fileName={fileName}
        pageCount={pageCount ?? 0}
        initialPage={Math.max(currentPage - 1, 0)}
        onClose={() => setShowAnnotate(false)}
        onSaved={handleAnnotateSaved}
      />
    );
  }

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
          <Pressable onPress={() => setShowMoreMenu(true)} hitSlop={12} style={styles.moreButton}>
            <Text style={styles.moreLabel}>⋯</Text>
          </Pressable>
        </View>
      </View>

      {loadError != null ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      ) : (
        <Pdf
          ref={pdfRef}
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

      {nightMode && loadError == null && <NightModeOverlay />}

      {pageCount != null && (
        <View style={styles.pageIndicator}>
          <Text style={styles.pageIndicatorText}>
            Page {currentPage} / {pageCount}
          </Text>
        </View>
      )}

      {activeOverlay === 'more-menu' && (
        <View style={styles.progressOverlay}>
          <MoreActionsMenu items={moreActionsItems} onClose={() => setShowMoreMenu(false)} />
        </View>
      )}

      {activeOverlay === 'table-of-contents' && (
        <View style={styles.progressOverlay}>
          <TableOfContentsPanel
            entries={tableContents}
            onSelectPage={handleSelectTocPage}
            onClose={() => setShowTableOfContents(false)}
          />
        </View>
      )}

      {activeOverlay === 'find' && (
        <View style={styles.progressOverlay}>
          <FindPanel filePath={filePath} onJumpToPage={handleJumpFromFind} onClose={() => setShowFindPanel(false)} />
        </View>
      )}

      {activeOverlay === 'printer-picker' && (
        <View style={styles.progressOverlay}>
          <PrinterPickerView discovery={discovery.state} onSelect={handleSelectPrinter} disabled={isBusy} />
          <Pressable onPress={handleClosePrinterPicker} style={styles.cancelPickerButton}>
            <Text style={styles.cancelPickerLabel}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {activeOverlay === 'print-options' && (
        <View style={styles.progressOverlay}>
          <PrintOptionsView
            pageCount={pageCount ?? 0}
            onSubmit={handleSubmitPrintOptions}
            onCancel={handleCancelPrintOptions}
          />
        </View>
      )}

      {activeOverlay === 'export' && (
        <View style={styles.progressOverlay}>
          <ExportProgressView state={exportState} />
          {exportState.stage === 'done' || exportState.stage === 'error' ? (
            <Pressable onPress={resetExport} style={styles.cancelPickerButton}>
              <Text style={styles.cancelPickerLabel}>Close</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {activeOverlay === 'share-error' && (
        <View style={styles.progressOverlay}>
          <View style={styles.shareErrorBox}>
            <Text style={styles.errorText}>{shareError}</Text>
          </View>
          <Pressable onPress={() => setShareError(null)} style={styles.cancelPickerButton}>
            <Text style={styles.cancelPickerLabel}>Close</Text>
          </Pressable>
        </View>
      )}

      {activeOverlay === 'print-progress' && (
        <View style={styles.progressOverlay}>
          <PrintProgressView state={state} />
        </View>
      )}

      {activeOverlay === 'ipp-progress' && (
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
  moreButton: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1c2128',
  },
  moreLabel: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 18,
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
  shareErrorBox: {
    padding: 16,
    backgroundColor: '#101418',
    borderRadius: 12,
  },
  cancelPickerLabel: {
    color: '#a0a8b4',
    fontWeight: '600',
  },
});
