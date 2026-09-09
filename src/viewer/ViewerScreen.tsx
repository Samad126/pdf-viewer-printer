import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import type { PdfError, PdfRef, TableContent } from 'react-native-pdf';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnnotateScreen } from '../annotate/AnnotateScreen';
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
      </View>

      {pageCount != null && (
        <View style={styles.pageIndicator}>
          <Text style={styles.pageIndicatorText}>
            Page {currentPage} / {pageCount}
          </Text>
        </View>
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
});
