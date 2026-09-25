import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import type { PdfError, PdfRef, TableContent } from 'react-native-pdf';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnnotateScreen } from '../annotate/AnnotateScreen';
import { FastScrollbar } from './FastScrollbar';
import { NightModeOverlay } from './NightModeOverlay';
import { usePrintFlow } from './usePrintFlow';
import { useViewerTools } from './useViewerTools';
import { ViewerHeader } from './ViewerHeader';
import { ViewerOverlays } from './ViewerOverlays';

interface ViewerScreenProps {
  filePath: string;
  fileName: string;
  onBack: () => void;
}

export function ViewerScreen({ filePath, fileName, onBack }: ViewerScreenProps): React.JSX.Element {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tableContents, setTableContents] = useState<TableContent[]>([]);
  const [showAnnotate, setShowAnnotate] = useState(false);
  const pdfRef = useRef<PdfRef>(null);
  const insets = useSafeAreaInsets();

  const print = usePrintFlow(filePath, fileName);
  const tools = useViewerTools({
    filePath,
    fileName,
    pageCount,
    tableContents,
    pdfRef,
    onRequestAnnotate: () => setShowAnnotate(true),
  });

  // Closes whichever single overlay ViewerOverlays currently has priority-picked (see the same
  // if-chain there), so back mirrors what the overlay's own X button/Cancel would do; if nothing
  // is open, falls through (returns false) to App.tsx's listener, which navigates back to Home.
  // Registered on mount (before AnnotateScreen could ever be shown), so AnnotateScreen's own
  // listener - added later, when the user opens it - correctly takes priority while it's mounted.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (print.showPrintChoice) {
        print.closePrintChoice();
      } else if (tools.showMoreMenu) {
        tools.closeMoreMenu();
      } else if (tools.showTableOfContents) {
        tools.closeTableOfContents();
      } else if (tools.showGoToPage) {
        tools.closeGoToPage();
      } else if (tools.showFindPanel) {
        tools.closeFindPanel();
      } else if (print.showPrinterPicker) {
        print.handleClosePrinterPicker();
      } else if (print.printOptionsTarget != null) {
        print.handleCancelPrintOptions();
      } else if (tools.exportState.stage !== 'idle') {
        tools.resetExport();
      } else if (tools.shareError != null) {
        tools.closeShareError();
      } else if (print.printState.stage !== 'idle') {
        print.dismissPrint();
      } else if (print.ippState.stage !== 'idle') {
        print.dismissIppPrint();
      } else {
        return false;
      }
      return true;
    });
    return () => subscription.remove();
  }, [print, tools]);

  const handleLoadComplete = useCallback(
    (numberOfPages: number, _path: string, _size: { width: number; height: number }, contents?: TableContent[]) => {
      setPageCount(numberOfPages);
      setTableContents(contents ?? []);
    },
    [],
  );

  const handleError = useCallback((error: PdfError) => {
    setLoadError(error.message ?? 'Failed to load PDF');
  }, []);

  if (showAnnotate) {
    return (
      <AnnotateScreen
        filePath={filePath}
        fileName={fileName}
        pageCount={pageCount ?? 0}
        initialPage={Math.max(currentPage - 1, 0)}
        onClose={() => setShowAnnotate(false)}
        onSaved={() => setShowAnnotate(false)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <ViewerHeader
        fileName={fileName}
        topInset={insets.top}
        isBusy={print.isBusy}
        onBack={onBack}
        onOpenPrintChoice={print.openPrintChoice}
        onOpenMoreMenu={tools.openMoreMenu}
      />

      <View style={styles.content}>
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

        {tools.nightMode && loadError == null && <NightModeOverlay />}

        {pageCount != null && loadError == null && (
          <FastScrollbar
            pageCount={pageCount}
            currentPage={currentPage}
            onJumpToPage={page => pdfRef.current?.setPage(page)}
          />
        )}
      </View>

      {pageCount != null && (
        <Pressable
          style={[styles.pageIndicator, { bottom: insets.bottom + 16 }]}
          onPress={tools.openGoToPage}
          accessibilityRole="button"
          accessibilityLabel="Go to page"
        >
          <Text style={styles.pageIndicatorText}>
            Page {currentPage} / {pageCount}  ▾
          </Text>
        </Pressable>
      )}

      <ViewerOverlays filePath={filePath} pageCount={pageCount ?? 0} tableContents={tableContents} print={print} tools={tools} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    flex: 1,
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
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  pageIndicatorText: {
    color: '#ffffff',
    fontSize: 15,
  },
});
