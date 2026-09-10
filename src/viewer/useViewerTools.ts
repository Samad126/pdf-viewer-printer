import { useCallback, useState } from 'react';
import type { RefObject } from 'react';
import type { PdfRef, TableContent } from 'react-native-pdf';
import { sharePdf, useExportPdf } from '../pdf-tools';
import type { ExportPipelineState } from '../pdf-tools/types';
import type { MoreActionsMenuItem } from './MoreActionsMenu';

export interface UseViewerToolsResult {
  showMoreMenu: boolean;
  showTableOfContents: boolean;
  showFindPanel: boolean;
  showAbout: boolean;
  nightMode: boolean;
  isSharing: boolean;
  shareError: string | null;
  exportState: ExportPipelineState;
  moreActionsItems: MoreActionsMenuItem[];
  openMoreMenu: () => void;
  closeMoreMenu: () => void;
  closeTableOfContents: () => void;
  handleSelectTocPage: (pageIndex: number) => void;
  closeFindPanel: () => void;
  handleJumpFromFind: (pageIndex: number) => void;
  closeAbout: () => void;
  closeShareError: () => void;
  resetExport: () => void;
}

interface UseViewerToolsParams {
  filePath: string;
  fileName: string;
  pageCount: number | null;
  tableContents: TableContent[];
  pdfRef: RefObject<PdfRef | null>;
  onRequestAnnotate: () => void;
}

/**
 * Bundles the reading-tools side of the viewer (the "⋯" menu and everything it opens: contents,
 * find, share, export, night mode) so ViewerScreen doesn't have to hold all of their state and
 * handlers itself. Draw/Annotate is triggered through here (onRequestAnnotate) but owned by
 * ViewerScreen, since opening it swaps the whole screen rather than showing an overlay.
 */
export function useViewerTools({
  filePath,
  fileName,
  pageCount,
  tableContents,
  pdfRef,
  onRequestAnnotate,
}: UseViewerToolsParams): UseViewerToolsResult {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showTableOfContents, setShowTableOfContents] = useState(false);
  const [showFindPanel, setShowFindPanel] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [nightMode, setNightMode] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const { state: exportState, exportAsImages, exportAsText, reset: resetExport } = useExportPdf();

  const openMoreMenu = useCallback(() => setShowMoreMenu(true), []);
  const closeMoreMenu = useCallback(() => setShowMoreMenu(false), []);
  const closeTableOfContents = useCallback(() => setShowTableOfContents(false), []);
  const closeFindPanel = useCallback(() => setShowFindPanel(false), []);
  const closeAbout = useCallback(() => setShowAbout(false), []);
  const closeShareError = useCallback(() => setShareError(null), []);

  const handleSelectTocPage = useCallback(
    (pageIndex: number) => {
      setShowTableOfContents(false);
      pdfRef.current?.setPage(pageIndex + 1);
    },
    [pdfRef],
  );

  const handleJumpFromFind = useCallback(
    (pageIndex: number) => {
      setShowFindPanel(false);
      pdfRef.current?.setPage(pageIndex + 1);
    },
    [pdfRef],
  );

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

  const hasPages = pageCount != null && pageCount > 0;

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
      disabled: !hasPages,
      onPress: onRequestAnnotate,
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
      disabled: !hasPages,
      onPress: handleExportImages,
    },
    {
      key: 'export-text',
      label: 'Export as text',
      disabled: !hasPages,
      onPress: handleExportText,
    },
    {
      key: 'night-mode',
      label: nightMode ? 'Night mode: On' : 'Night mode: Off',
      onPress: () => setNightMode(previous => !previous),
    },
    {
      key: 'about',
      label: 'About',
      onPress: () => setShowAbout(true),
    },
  ];

  return {
    showMoreMenu,
    showTableOfContents,
    showFindPanel,
    showAbout,
    nightMode,
    isSharing,
    shareError,
    exportState,
    moreActionsItems,
    openMoreMenu,
    closeMoreMenu,
    closeTableOfContents,
    handleSelectTocPage,
    closeFindPanel,
    handleJumpFromFind,
    closeAbout,
    closeShareError,
    resetExport,
  };
}
