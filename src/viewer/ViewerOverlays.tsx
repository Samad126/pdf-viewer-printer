import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { TableContent } from 'react-native-pdf';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExportProgressView, FindPanel } from '../pdf-tools';
import { PrintProgressView } from '../print/PrintProgressView';
import { IppPrintProgressView } from '../printers/IppPrintProgressView';
import { PrintOptionsView } from '../printers/PrintOptionsView';
import { PrinterPickerView } from '../printers/PrinterPickerView';
import { AboutModal } from '../ui/AboutModal';
import { CloseButton } from '../ui/CloseButton';
import { useKeyboardHeight } from '../ui/useKeyboardHeight';
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
export function ViewerOverlays({
  filePath,
  pageCount,
  tableContents,
  print,
  tools,
}: ViewerOverlaysProps): React.JSX.Element {
  const keyboardHeight = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  return (
    <>
      {renderPriorityOverlay()}
      {tools.showAbout && <AboutModal onClose={tools.closeAbout} />}
    </>
  );

  // AboutModal (above) uses RN's own Modal, a native top-level layer independent of this priority
  // chain, so it's rendered alongside whatever the chain below picks rather than being another
  // branch in it - everything else here still shares one screen and must never show two at once.
  function renderPriorityOverlay(): React.JSX.Element | null {
    if (print.showPrintChoice) {
      return (
        <View style={styles.overlay}>
          <MoreActionsMenu
            title="Print"
            items={print.printChoiceItems}
            onClose={print.closePrintChoice}
          />
        </View>
      );
    }

    if (tools.showMoreMenu) {
      return (
        <View style={styles.overlay}>
          <MoreActionsMenu
            items={tools.moreActionsItems}
            onClose={tools.closeMoreMenu}
          />
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
      // Anchored a fixed distance above the keyboard (like the other overlays' `bottom: 40`) and
      // sized to a modest, capped height - not stretched to fill the whole space down to the
      // keyboard, which looked like an oversized, mostly-empty box before any results existed. `top`
      // is only ever pulled down as far as `minTop` (clearing the header) if a tall keyboard would
      // otherwise leave less room than DESIRED_HEIGHT - the panel shrinks to fit rather than ever
      // pushing its own header/input off the top of the screen, which is what an earlier version
      // that only moved `bottom` (with an intrinsic percentage-based height) got wrong.
      const bottom = 40 + keyboardHeight;
      const minTop = insets.top + 64;
      const desiredHeight = Math.min(windowHeight * 0.5, 420);
      const top = Math.max(minTop, windowHeight - bottom - desiredHeight);
      return (
        <View style={[styles.findOverlay, { top, bottom }]}>
          <FindPanel
            filePath={filePath}
            onJumpToPage={tools.handleJumpFromFind}
            onClose={tools.closeFindPanel}
          />
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
          <ExportProgressView
            state={tools.exportState}
            onDismiss={tools.resetExport}
          />
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
          <PrintProgressView
            state={print.printState}
            onDismiss={print.dismissPrint}
          />
        </View>
      );
    }

    if (print.ippState.stage !== 'idle') {
      return (
        <View style={styles.overlay}>
          <IppPrintProgressView
            state={print.ippState}
            onCancel={print.handleCancelIppPrint}
            onDismiss={print.dismissIppPrint}
          />
        </View>
      );
    }

    return null;
  }
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 40,
  },
  findOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
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
