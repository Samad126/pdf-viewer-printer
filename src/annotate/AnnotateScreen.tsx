import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { closePdfDocument, openPdfDocument, renderPdfPageToFile } from '../pdf/NativePdfiumModule';
import { DEFAULT_PRINT_DPI } from '../pdf/types';
import { DrawingCanvas } from './DrawingCanvas';
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

interface CanvasSize {
  width: number;
  height: number;
}

const PREVIEW_DPI = 150;
const CONTENT_HORIZONTAL_PADDING = 16;
const CHROME_HEIGHT_ESTIMATE = 260;

const COLOR_PRESETS = ['#000000', '#e63946', '#1d4ed8', '#16a34a', '#eab308', '#f97316'];

const STROKE_WIDTH_PRESETS: { label: string; value: number }[] = [
  { label: 'Thin', value: 2 },
  { label: 'Medium', value: 4 },
  { label: 'Thick', value: 8 },
];

function computeFitSize(naturalWidth: number, naturalHeight: number, maxWidth: number, maxHeight: number): CanvasSize {
  const safeMaxWidth = Math.max(maxWidth, 1);
  const safeMaxHeight = Math.max(maxHeight, 1);
  const aspect = naturalWidth / naturalHeight;
  let width = safeMaxWidth;
  let height = width / aspect;
  if (height > safeMaxHeight) {
    height = safeMaxHeight;
    width = height * aspect;
  }
  return { width, height };
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const [currentPageIndex, setCurrentPageIndex] = useState(() => clampPageIndex(initialPage, pageCount));
  const [pageAnnotations, setPageAnnotations] = useState<PageAnnotations>({});
  const [handle, setHandle] = useState<string | null>(null);
  const [pageImageUri, setPageImageUri] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize | null>(null);
  const [isLoadingPage, setIsLoadingPage] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeColor, setActiveColor] = useState<string>(COLOR_PRESETS[0]);
  const [activeStrokeWidth, setActiveStrokeWidth] = useState<number>(STROKE_WIDTH_PRESETS[1].value);

  const handleRef = useRef<string | null>(null);
  // Per-page effective dpi of the coordinate space its strokes were captured in - see
  // NativeAnnotationModule's AnnotationPageInput.pageDpi doc for what this means.
  const pageDpiMapRef = useRef<Record<number, number>>({});

  useEffect(() => {
    handleRef.current = handle;
  }, [handle]);

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

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    setIsLoadingPage(true);
    setPageImageUri(null);

    const outputPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/annotate-preview-${currentPageIndex}-${Date.now()}.png`;
    renderPdfPageToFile(handle, currentPageIndex, PREVIEW_DPI, outputPath)
      .then(rendered => {
        if (cancelled) return;
        const maxWidth = windowWidth - CONTENT_HORIZONTAL_PADDING * 2;
        const maxHeight = windowHeight - CHROME_HEIGHT_ESTIMATE - insets.top - insets.bottom;
        const fitted = computeFitSize(rendered.width, rendered.height, maxWidth, maxHeight);
        pageDpiMapRef.current[currentPageIndex] = (PREVIEW_DPI * fitted.width) / rendered.width;
        setCanvasSize(fitted);
        setPageImageUri(`file://${rendered.outputPath}`);
        setIsLoadingPage(false);
      })
      .catch(error => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to render page.');
          setIsLoadingPage(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [handle, currentPageIndex, windowWidth, windowHeight, insets.top, insets.bottom]);

  const hasUnsavedStrokes = useMemo(
    () => Object.values(pageAnnotations).some(strokes => strokes.length > 0),
    [pageAnnotations],
  );

  const handleStrokesChange = useCallback(
    (strokes: Stroke[]) => {
      setPageAnnotations(previous => ({ ...previous, [currentPageIndex]: strokes }));
    },
    [currentPageIndex],
  );

  const handleUndo = useCallback(() => {
    setPageAnnotations(previous => {
      const pageStrokes = previous[currentPageIndex] ?? [];
      if (pageStrokes.length === 0) return previous;
      return { ...previous, [currentPageIndex]: pageStrokes.slice(0, -1) };
    });
  }, [currentPageIndex]);

  const handleClearPage = useCallback(() => {
    setPageAnnotations(previous => {
      const pageStrokes = previous[currentPageIndex] ?? [];
      if (pageStrokes.length === 0) return previous;
      return { ...previous, [currentPageIndex]: [] };
    });
  }, [currentPageIndex]);

  const goToPage = useCallback(
    (nextIndex: number) => {
      setCurrentPageIndex(clampPageIndex(nextIndex, pageCount));
    },
    [pageCount],
  );

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

  const currentStrokes = pageAnnotations[currentPageIndex] ?? [];
  const isFirstPage = currentPageIndex === 0;
  const isLastPage = currentPageIndex >= pageCount - 1;

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

      <View style={styles.pageNavRow}>
        <Pressable
          onPress={() => goToPage(currentPageIndex - 1)}
          disabled={isFirstPage}
          style={[styles.navButton, isFirstPage && styles.navButtonDisabled]}
        >
          <Text style={styles.navLabel}>{'‹ Prev'}</Text>
        </Pressable>
        <Text style={styles.pageIndicatorText}>
          Page {currentPageIndex + 1} of {pageCount}
        </Text>
        <Pressable
          onPress={() => goToPage(currentPageIndex + 1)}
          disabled={isLastPage}
          style={[styles.navButton, isLastPage && styles.navButtonDisabled]}
        >
          <Text style={styles.navLabel}>{'Next ›'}</Text>
        </Pressable>
      </View>

      <View style={styles.canvasArea}>
        {isLoadingPage || pageImageUri == null || canvasSize == null ? (
          <ActivityIndicator size="large" color="#2f6fed" />
        ) : (
          <DrawingCanvas
            pageImageUri={pageImageUri}
            width={canvasSize.width}
            height={canvasSize.height}
            strokes={currentStrokes}
            activeColor={activeColor}
            activeStrokeWidth={activeStrokeWidth}
            onStrokesChange={handleStrokesChange}
          />
        )}
      </View>

      {errorMessage != null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{errorMessage}</Text>
        </View>
      )}

      <View style={styles.toolbar}>
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
  pageNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#101418',
  },
  navButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1c2128',
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  navLabel: {
    color: '#63a4ff',
    fontWeight: '600',
  },
  pageIndicatorText: {
    color: '#a0a8b4',
    fontSize: 13,
  },
  canvasArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4b4f56',
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
