import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TableContent } from 'react-native-pdf';
import { ExportProgressView, FindPanel } from '../pdf-tools';
import { PrintProgressView } from '../print/PrintProgressView';
import { IppPrintProgressView } from '../printers/IppPrintProgressView';
import { PrintOptionsView } from '../printers/PrintOptionsView';
import { PrinterPickerView } from '../printers/PrinterPickerView';
import { CloseButton } from '../ui/CloseButton';
import { MoreActionsMenu } from './MoreActionsMenu';
import { TableOfContentsPanel } from './TableOfContentsPanel';
import type { UsePrintFlowResult } from './usePrintFlow';
import type { UseViewerToolsResult } from './useViewerTools';

interface ViewerOverlaysProps {
  filePath: string;
  pageCount: number;
  tableContents: TableContent[];
  print: UsePrintFlowResult;
  tools: UseViewerToolsResult;
}

/**
 * Renders whichever single overlay (menu, panel, or progress view) takes priority right now,
 * covering both the print flow's overlays and the reading-tools flow's overlays - they share one
 * screen and must never show two at once, so the priority order lives in one place here rather
 * than being reconstructed at each call site.
 */
export function ViewerOverlays({ filePath, pageCount, tableContents, print, tools }: ViewerOverlaysProps): React.JSX.Element | null {
  if (print.showPrintChoice) {
    return (
      <View style={styles.overlay}>
        <MoreActionsMenu title="Print" items={print.printChoiceItems} onClose={print.closePrintChoice} />
      </View>
    );
  }

  if (tools.showMoreMenu) {
    return (
      <View style={styles.overlay}>
        <MoreActionsMenu items={tools.moreActionsItems} onClose={tools.closeMoreMenu} />
      </View>
    );
  }

  if (tools.showTableOfContents) {
    return (
      <View style={styles.overlay}>
        <TableOfContentsPanel
          entries={tableContents}
          onSelectPage={tools.handleSelectTocPage}
          onClose={tools.closeTableOfContents}
        />
      </View>
    );
  }

  if (tools.showFindPanel) {
    return (
      <View style={styles.overlay}>
        <FindPanel filePath={filePath} onJumpToPage={tools.handleJumpFromFind} onClose={tools.closeFindPanel} />
      </View>
    );
  }

  if (print.showPrinterPicker) {
    return (
      <View style={styles.overlay}>
        <PrinterPickerView
          discovery={print.discovery.state}
          onSelect={print.handleSelectPrinter}
          onClose={print.handleClosePrinterPicker}
          disabled={print.isBusy}
        />
      </View>
    );
  }

  if (print.printOptionsTarget != null) {
    return (
      <View style={styles.overlay}>
        <PrintOptionsView
          pageCount={pageCount}
          onSubmit={print.handleSubmitPrintOptions}
          onCancel={print.handleCancelPrintOptions}
        />
      </View>
    );
  }

  if (tools.exportState.stage !== 'idle') {
    return (
      <View style={styles.overlay}>
        <ExportProgressView state={tools.exportState} onDismiss={tools.resetExport} />
      </View>
    );
  }

  if (tools.shareError != null) {
    return (
      <View style={styles.overlay}>
        <View style={styles.shareErrorBox}>
          <View style={styles.shareErrorHeader}>
            <Text style={styles.shareErrorTitle}>Share failed</Text>
            <CloseButton onPress={tools.closeShareError} />
          </View>
          <Text style={styles.errorText}>{tools.shareError}</Text>
        </View>
      </View>
    );
  }

  if (print.printState.stage !== 'idle') {
    return (
      <View style={styles.overlay}>
        <PrintProgressView state={print.printState} onDismiss={print.dismissPrint} />
      </View>
    );
  }

  if (print.ippState.stage !== 'idle') {
    return (
      <View style={styles.overlay}>
        <IppPrintProgressView state={print.ippState} onCancel={print.handleCancelIppPrint} onDismiss={print.dismissIppPrint} />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 40,
  },
  shareErrorBox: {
    padding: 16,
    backgroundColor: '#101418',
    borderRadius: 12,
  },
  shareErrorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  shareErrorTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    color: '#ff6b6b',
  },
});
