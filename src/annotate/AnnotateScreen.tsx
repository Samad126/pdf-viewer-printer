import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { ListViewToken } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnnotatePageItem, PAGE_ROW_GAP } from './AnnotatePageItem';
import type { PageCanvasSize, PageRenderEntry } from './AnnotatePageItem';
import { closePdfDocument, openPdfDocument, renderPdfPageToFile } from '../pdf/NativePdfiumModule';
import { DEFAULT_PRINT_DPI } from '../pdf/types';
import type { AnnotationPageInput } from './NativeAnnotationModule';
import { saveAnnotatedPdf } from './NativeAnnotationModule';
import type { PageAnnotations, Stroke } from './types';

interface AnnotateScreenProps {
  filePath: string;
  fileName: string;
  pageCount: number;
  /** 0-based index of the page to open the editor on. */
  initialPage: number;
  onClose: () => void;
  onSaved: (savedFileUri: string) => void;
}

const PREVIEW_DPI = 150;
const CONTENT_HORIZONTAL_PADDING = 16;
// Used only to size the FlatList's loading placeholders and its getItemLayout estimate before a
// page's real aspect ratio is known - actual rendered size always comes from the page's own
// rasterized dimensions once available, so a rough guess here is harmless.
const ESTIMATED_PAGE_ASPECT_RATIO = Math.sqrt(2);

const COLOR_PRESETS = ['#000000', '#e63946', '#1d4ed8', '#16a34a', '#eab308', '#f97316'];

const STROKE_WIDTH_PRESETS: { label: string; value: number }[] = [
  { label: 'Thin', value: 2 },
  { label: 'Medium', value: 4 },
  { label: 'Thick', value: 8 },
];

function computePageSize(naturalWidth: number, naturalHeight: number, maxWidth: number): PageCanvasSize {
  const safeMaxWidth = Math.max(maxWidth, 1);
  const aspect = naturalWidth / naturalHeight;
  return { width: safeMaxWidth, height: safeMaxWidth / aspect };
}

function clampPageIndex(index: number, pageCount: number): number {
  return Math.min(Math.max(index, 0), Math.max(pageCount - 1, 0));
}

export function AnnotateScreen({
  filePath,
  fileName,
  pageCount,
  initialPage,
  onClose,
  onSaved,
}: AnnotateScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const clampedInitialPage = useMemo(() => clampPageIndex(initialPage, pageCount), [initialPage, pageCount]);

  const [activePageIndex, setActivePageIndex] = useState(clampedInitialPage);
  const [visiblePageIndex, setVisiblePageIndex] = useState(clampedInitialPage);
  const [pageAnnotations, setPageAnnotations] = useState<PageAnnotations>({});
  const [pageRenders, setPageRenders] = useState<Record<number, PageRenderEntry>>({});
  const [handle, setHandle] = useState<string | null>(null);
  const [isDrawingMode, setIsDrawingMode] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeColor, setActiveColor] = useState<string>(COLOR_PRESETS[0]);
  const [activeStrokeWidth, setActiveStrokeWidth] = useState<number>(STROKE_WIDTH_PRESETS[1].value);

  const handleRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const requestedPagesRef = useRef<Set<number>>(new Set());
  // Per-page effective dpi of the unzoomed coordinate space its strokes were captured in - see
  // NativeAnnotationModule's AnnotationPageInput.pageDpi doc for what this means. This is set once
  // per page from its initial fit-to-width render and does NOT change with the user's live
  // pinch-zoom level: DrawingCanvas always reports touch points in that same unzoomed local
  // coordinate frame regardless of any transform an ancestor applies (see AnnotatePageItem and
  // DrawingCanvas's onPanResponderMove comment), so one pageDpi value stays valid for every stroke
  // on a page no matter when, or how much, the user zoomed while drawing it.
  const pageDpiMapRef = useRef<Record<number, number>>({});

  useEffect(() => {
    handleRef.current = handle;
  }, [handle]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    openPdfDocument(filePath, null)
      .then(inspection => {
        if (cancelled) return;
        if (!inspection.canOpen || !inspection.handle) {
          setErrorMessage('This PDF could not be opened for annotation.');
          return;
        }
        setHandle(inspection.handle);
      })
      .catch(error => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to open PDF.');
        }
      });
    return () => {
      cancelled = true;
      const openHandle = handleRef.current;
      if (openHandle) {
        closePdfDocument(openHandle).catch(() => undefined);
      }
    };
    // Only ever opens once per mounted screen instance.
  }, [filePath]);

  const maxWidth = windowWidth - CONTENT_HORIZONTAL_PADDING * 2;
  const estimatedItemHeight = maxWidth * ESTIMATED_PAGE_ASPECT_RATIO + PAGE_ROW_GAP;

  const renderPage = useCallback(
    (pageIndex: number) => {
      if (handle == null || requestedPagesRef.current.has(pageIndex)) return;
      requestedPagesRef.current.add(pageIndex);
      setPageRenders(previous => ({ ...previous, [pageIndex]: { status: 'loading' } }));

      const outputPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/annotate-preview-${pageIndex}-${Date.now()}.png`;
      renderPdfPageToFile(handle, pageIndex, PREVIEW_DPI, outputPath)
        .then(rendered => {
          if (!mountedRef.current) return;
          const fitted = computePageSize(rendered.width, rendered.height, maxWidth);
          pageDpiMapRef.current[pageIndex] = (PREVIEW_DPI * fitted.width) / rendered.width;
          setPageRenders(previous => ({
            ...previous,
            [pageIndex]: { status: 'ready', imageUri: `file://${rendered.outputPath}`, canvasSize: fitted },
          }));
        })
        .catch(error => {
          if (!mountedRef.current) return;
          requestedPagesRef.current.delete(pageIndex);
          setPageRenders(previous => ({ ...previous, [pageIndex]: { status: 'error' } }));
          setErrorMessage(error instanceof Error ? error.message : `Failed to render page ${pageIndex + 1}.`);
        });
    },
    [handle, maxWidth],
  );

  const hasUnsavedStrokes = useMemo(
    () => Object.values(pageAnnotations).some(strokes => strokes.length > 0),
    [pageAnnotations],
  );

  const handleStrokesChange = useCallback((pageIndex: number, strokes: Stroke[]) => {
    setPageAnnotations(previous => ({ ...previous, [pageIndex]: strokes }));
    setActivePageIndex(pageIndex);
  }, []);

  const handleUndo = useCallback(() => {
    setPageAnnotations(previous => {
      const pageStrokes = previous[activePageIndex] ?? [];
      if (pageStrokes.length === 0) return previous;
      return { ...previous, [activePageIndex]: pageStrokes.slice(0, -1) };
    });
  }, [activePageIndex]);

  const handleClearPage = useCallback(() => {
    setPageAnnotations(previous => {
      const pageStrokes = previous[activePageIndex] ?? [];
      if (pageStrokes.length === 0) return previous;
      return { ...previous, [activePageIndex]: [] };
    });
  }, [activePageIndex]);

  const handleClose = useCallback(() => {
    if (hasUnsavedStrokes) {
      Alert.alert(
        'Discard changes?',
        'You have unsaved drawings on this document. Closing now will discard them.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: onClose },
        ],
      );
    } else {
      onClose();
    }
  }, [hasUnsavedStrokes, onClose]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    setErrorMessage(null);

    let saveHandle: string | null = null;
    try {
      const inspection = await openPdfDocument(filePath, null);
      if (!inspection.canOpen || !inspection.handle) {
        throw new Error('Could not reopen the PDF to save annotations.');
      }
      saveHandle = inspection.handle;

      const pageAnnotationsPayload: AnnotationPageInput[] = Object.entries(pageAnnotations)
        .map(([pageIndexKey, strokes]) => {
          const pageIndex = Number(pageIndexKey);
          return {
            pageIndex,
            pageDpi: pageDpiMapRef.current[pageIndex] ?? PREVIEW_DPI,
            strokes,
          };
        })
        .filter(entry => entry.strokes.length > 0);

      const baseName = fileName.replace(/\.pdf$/i, '');
      const outputPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${baseName}-annotated-${Date.now()}.pdf`;

      const result = await saveAnnotatedPdf(saveHandle, DEFAULT_PRINT_DPI, outputPath, pageAnnotationsPayload);

      await closePdfDocument(saveHandle).catch(() => undefined);
      saveHandle = null;

      setIsSaving(false);
      onSaved(`file://${result.outputPath}`);
    } catch (error) {
      if (saveHandle) {
        await closePdfDocument(saveHandle).catch(() => undefined);
      }
      setIsSaving(false);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save annotated PDF.');
    }
  }, [fileName, filePath, isSaving, onSaved, pageAnnotations]);

  const pageIndices = useMemo(() => Array.from({ length: pageCount }, (_, index) => index), [pageCount]);

  const keyExtractor = useCallback((item: number) => String(item), []);

  const getItemLayout = useCallback(
    (_data: ArrayLike<number> | null | undefined, index: number) => ({
      length: estimatedItemHeight,
      offset: estimatedItemHeight * index,
      index,
    }),
    [estimatedItemHeight],
  );

  const renderItem = useCallback(
    ({ item }: { item: number }) => (
      <AnnotatePageItem
        pageIndex={item}
        width={maxWidth}
        estimatedHeight={estimatedItemHeight}
        entry={pageRenders[item]}
        strokes={pageAnnotations[item] ?? []}
        activeColor={activeColor}
        activeStrokeWidth={activeStrokeWidth}
        drawingEnabled={isDrawingMode}
        onStrokesChange={handleStrokesChange}
        onRequestRender={renderPage}
      />
    ),
    [
      maxWidth,
      estimatedItemHeight,
      pageRenders,
      pageAnnotations,
      activeColor,
      activeStrokeWidth,
      isDrawingMode,
      handleStrokesChange,
      renderPage,
    ],
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const firstVisible = viewableItems.find(token => token.isViewable && typeof token.item === 'number');
    if (firstVisible != null) {
      setVisiblePageIndex(firstVisible.item as number);
    }
  }).current;

  const currentStrokes = pageAnnotations[activePageIndex] ?? [];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={handleClose} hitSlop={12}>
          <Text style={styles.backLabel}>{'< Close'}</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {fileName}
        </Text>
        <Pressable
          onPress={handleSave}
          disabled={isSaving || pageCount === 0}
          style={[styles.saveButton, (isSaving || pageCount === 0) && styles.saveButtonDisabled]}
        >
          <Text style={styles.saveLabel}>Save</Text>
        </Pressable>
      </View>

      <View style={styles.canvasArea}>
        {handle == null ? (
          <ActivityIndicator size="large" color="#2f6fed" />
        ) : (
          <FlatList
            data={pageIndices}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            getItemLayout={getItemLayout}
            initialScrollIndex={clampedInitialPage}
            initialNumToRender={3}
            windowSize={5}
            maxToRenderPerBatch={2}
            removeClippedSubviews
            viewabilityConfig={viewabilityConfig}
            onViewableItemsChanged={onViewableItemsChanged}
            contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 16 }]}
          />
        )}
        {handle != null && pageCount > 0 && (
          <View style={styles.pageBadge} pointerEvents="none">
            <Text style={styles.pageBadgeText}>
              {visiblePageIndex + 1} / {pageCount}
            </Text>
          </View>
        )}
      </View>

      {errorMessage != null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{errorMessage}</Text>
        </View>
      )}

      <View style={styles.toolbar}>
        <View style={styles.modeRow}>
          {/* Drawing greedily claims single-finger touches (to start a stroke on touch-down), which
              would otherwise starve the list's own single-finger scroll - Scroll mode releases that
              claim so the page list can be navigated normally; pinch-zoom works in either mode since
              it only ever reacts to a 2nd touch. */}
          <Pressable
            onPress={() => setIsDrawingMode(true)}
            style={[styles.modeButton, isDrawingMode && styles.modeButtonActive]}
          >
            <Text style={styles.modeLabel}>Draw</Text>
          </Pressable>
          <Pressable
            onPress={() => setIsDrawingMode(false)}
            style={[styles.modeButton, !isDrawingMode && styles.modeButtonActive]}
          >
            <Text style={styles.modeLabel}>Scroll</Text>
          </Pressable>
        </View>
        <View style={styles.colorRow}>
          {COLOR_PRESETS.map(color => (
            <Pressable
              key={color}
              onPress={() => setActiveColor(color)}
              style={[
                styles.colorSwatch,
                { backgroundColor: color },
                activeColor === color && styles.colorSwatchActive,
              ]}
            />
          ))}
        </View>
        <View style={styles.widthRow}>
          {STROKE_WIDTH_PRESETS.map(preset => (
            <Pressable
              key={preset.label}
              onPress={() => setActiveStrokeWidth(preset.value)}
              style={[styles.widthButton, activeStrokeWidth === preset.value && styles.widthButtonActive]}
            >
              <Text style={styles.widthLabel}>{preset.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={handleUndo} disabled={currentStrokes.length === 0} style={styles.actionButton}>
            <Text style={[styles.actionLabel, currentStrokes.length === 0 && styles.actionLabelDisabled]}>
              Undo
            </Text>
          </Pressable>
          <Pressable onPress={handleClearPage} disabled={currentStrokes.length === 0} style={styles.actionButton}>
            <Text style={[styles.actionLabel, currentStrokes.length === 0 && styles.actionLabelDisabled]}>
              Clear
            </Text>
          </Pressable>
        </View>
      </View>

      {isSaving && (
        <View style={styles.savingOverlay}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.savingLabel}>Saving…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101418',
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
  saveButton: {
    backgroundColor: '#2f6fed',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
  canvasArea: {
    flex: 1,
    backgroundColor: '#4b4f56',
  },
  listContent: {
    alignItems: 'center',
    paddingTop: 16,
  },
  pageBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(16,20,24,0.75)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pageBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  errorBanner: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#2a1414',
  },
  errorBannerText: {
    color: '#ffb4b4',
    fontSize: 13,
  },
  toolbar: {
    padding: 12,
    backgroundColor: '#101418',
  },
  modeRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  modeButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1c2128',
    marginRight: 8,
  },
  modeButtonActive: {
    backgroundColor: '#2f6fed',
  },
  modeLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  colorRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorSwatchActive: {
    borderColor: '#ffffff',
  },
  widthRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  widthButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1c2128',
    marginRight: 8,
  },
  widthButtonActive: {
    backgroundColor: '#2f6fed',
  },
  widthLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1c2128',
    marginRight: 8,
  },
  actionLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  actionLabelDisabled: {
    color: '#63697a',
  },
  savingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(16,20,24,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savingLabel: {
    color: '#ffffff',
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
  },
});
