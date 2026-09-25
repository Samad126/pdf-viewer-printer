import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_PANEL_WIDTH, useSideInset } from '../ui/useSideInset';
import { useKeyboardHeight } from '../ui/useKeyboardHeight';
import { FastScrollbar } from '../viewer/FastScrollbar';
import { GoToPagePanel } from '../viewer/GoToPagePanel';
import {
  closePdfDocument,
  openPdfDocument,
  renderPdfPageToFile,
} from '../pdf/NativePdfiumModule';

interface PagePickerModalProps {
  filePath: string;
  pageCount: number;
  /** 0-based pages selected when the picker opens. */
  initialSelection: number[];
  onDone: (selected: number[]) => void;
  onCancel: () => void;
}

const PICKER_DPI = 120;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

function touchDistance(
  touches: ReadonlyArray<{ pageX: number; pageY: number }>,
): number {
  return Math.hypot(
    touches[0].pageX - touches[1].pageX,
    touches[0].pageY - touches[1].pageY,
  );
}
const PAGE_ASPECT = 0.707;
const LIST_PADDING = 12;
const ROW_GAP = 12;

/** Turns sorted 0-based indices into a typed-style range, e.g. [0,1,2,4] -> "1-3, 5". */
export function indicesToRangeText(indices: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < indices.length) {
    let j = i;
    while (j + 1 < indices.length && indices[j + 1] === indices[j] + 1) j += 1;
    parts.push(
      j > i ? `${indices[i] + 1}-${indices[j] + 1}` : `${indices[i] + 1}`,
    );
    i = j + 1;
  }
  return parts.join(', ');
}

/** Full-screen page list, scrolled like the normal viewer, where tapping a page toggles it. */
export function PagePickerModal({
  filePath,
  pageCount,
  initialSelection,
  onDone,
  onCancel,
}: PagePickerModalProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(initialSelection),
  );
  const [handle, setHandle] = useState<string | null>(null);
  // Pdfium renders one page at a time per document, so page renders queue behind each other.
  const [currentPage, setCurrentPage] = useState(1);
  const [showGoTo, setShowGoTo] = useState(false);
  const listRef = useRef<FlatList<number>>(null);
  const { width } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const sideInset = useSideInset();
  // On wide screens the pages stay a readable single column instead of stretching edge to edge.
  const [zoom, setZoom] = useState(1);
  // Live pinch feedback: a cheap transform while fingers are down, committed as a real re-layout
  // (so pages re-render sharp at the new size) when they lift.
  const [pinchScale, setPinchScale] = useState(1);
  const pinch = useRef<{ startDistance: number; scale: number } | null>(null);
  const listWidth = Math.min(width, MAX_PANEL_WIDTH + 80) * zoom;
  // Every row is the same height (pages are letterboxed to one shape), so the list can jump
  // straight to any page without having to measure the ones in between.
  const rowHeight = (listWidth - LIST_PADDING * 2) / PAGE_ASPECT + ROW_GAP;
  const jumpTo = useCallback(
    (page: number) => {
      setCurrentPage(page);
      listRef.current?.scrollToOffset({
        offset: (page - 1) * rowHeight,
        animated: false,
      });
    },
    [rowHeight],
  );
  const onViewable = useRef(
    ({
      viewableItems,
    }: {
      viewableItems: Array<{ index?: number | null }>;
    }) => {
      const first = viewableItems[0]?.index;
      if (first != null) setCurrentPage(first + 1);
    },
  ).current;
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    let opened: string | null = null;
    openPdfDocument(filePath, null)
      .then(inspection => {
        if (inspection.canOpen && inspection.handle) {
          opened = inspection.handle;
          if (!cancelled) setHandle(opened);
          else closePdfDocument(opened).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (opened != null) closePdfDocument(opened).catch(() => undefined);
    };
  }, [filePath]);

  const renderPage = useCallback(
    (index: number): Promise<string> => {
      const job = queue.current.then(async () => {
        const out = `${
          ReactNativeBlobUtil.fs.dirs.CacheDir
        }/picker-${index}-${Date.now()}.png`;
        const rendered = await renderPdfPageToFile(
          handle as string,
          index,
          PICKER_DPI,
          out,
        );
        return `file://${rendered.outputPath}`;
      });
      queue.current = job.catch(() => undefined);
      return job;
    },
    [handle],
  );

  const toggle = useCallback((index: number) => {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const setAll = useCallback(
    (all: boolean) =>
      setSelected(
        all
          ? new Set(Array.from({ length: pageCount }, (_, i) => i))
          : new Set(),
      ),
    [pageCount],
  );

  const sorted = [...selected].sort((a, b) => a - b);

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text style={styles.headerAction}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{sorted.length} selected</Text>
          <Pressable
            onPress={() => setAll(sorted.length !== pageCount)}
            hitSlop={8}
          >
            <Text style={styles.headerAction}>
              {sorted.length === pageCount ? 'None' : 'All'}
            </Text>
          </Pressable>
        </View>

        {handle == null ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" />
          </View>
        ) : (
          <View
            style={styles.listWrap}
            onTouchStart={event => {
              const touches = event.nativeEvent.touches;
              if (touches.length === 2) {
                pinch.current = {
                  startDistance: touchDistance(touches),
                  scale: 1,
                };
              }
            }}
            onTouchMove={event => {
              const touches = event.nativeEvent.touches;
              if (touches.length !== 2 || pinch.current == null) return;
              const raw = touchDistance(touches) / pinch.current.startDistance;
              const scale = Math.min(
                Math.max(raw, MIN_ZOOM / zoom),
                MAX_ZOOM / zoom,
              );
              pinch.current.scale = scale;
              setPinchScale(scale);
            }}
            onTouchEnd={event => {
              if (
                pinch.current == null ||
                event.nativeEvent.touches.length >= 2
              )
                return;
              const next = Math.min(
                Math.max(zoom * pinch.current.scale, MIN_ZOOM),
                MAX_ZOOM,
              );
              pinch.current = null;
              setPinchScale(1);
              setZoom(next);
            }}
          >
            <View
              style={[styles.zoomLayer, { transform: [{ scale: pinchScale }] }]}
            >
              <ScrollView
                horizontal
                scrollEnabled={zoom > 1}
                contentContainerStyle={[
                  styles.zoomContent,
                  { width: Math.max(width, listWidth) },
                ]}
              >
                <FlatList
                  ref={listRef}
                  getItemLayout={(_data, index) => ({
                    length: rowHeight,
                    offset: rowHeight * index,
                    index,
                  })}
                  onViewableItemsChanged={onViewable}
                  data={Array.from({ length: pageCount }, (_, i) => i)}
                  keyExtractor={index => String(index)}
                  contentContainerStyle={[styles.list, { width: listWidth }]}
                  initialNumToRender={3}
                  windowSize={5}
                  renderItem={({ item }) => (
                    <PickerPage
                      index={item}
                      selected={selected.has(item)}
                      render={renderPage}
                      onToggle={toggle}
                    />
                  )}
                />
              </ScrollView>
            </View>
            <FastScrollbar
              pageCount={pageCount}
              currentPage={currentPage}
              onJumpToPage={jumpTo}
            />
            <Pressable
              style={styles.pageIndicator}
              onPress={() => setShowGoTo(true)}
            >
              <Text style={styles.pageIndicatorText}>
                Page {currentPage} / {pageCount} ▾
              </Text>
            </Pressable>
          </View>
        )}

        {showGoTo && (
          <View
            style={[
              styles.goTo,
              {
                bottom: 90 + keyboardHeight,
                left: sideInset,
                right: sideInset,
              },
            ]}
          >
            <GoToPagePanel
              pageCount={pageCount}
              onGo={page => {
                setShowGoTo(false);
                jumpTo(page);
              }}
              onClose={() => setShowGoTo(false)}
            />
          </View>
        )}

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            style={[
              styles.doneButton,
              sorted.length === 0 && styles.doneDisabled,
            ]}
            disabled={sorted.length === 0}
            onPress={() => onDone(sorted)}
          >
            <Text style={styles.doneLabel}>
              Use {sorted.length} {sorted.length === 1 ? 'page' : 'pages'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

interface PickerPageProps {
  index: number;
  selected: boolean;
  render: (index: number) => Promise<string>;
  onToggle: (index: number) => void;
}

const PickerPage = React.memo(function PickerPageItem({
  index,
  selected,
  render,
  onToggle,
}: PickerPageProps) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    render(index)
      .then(result => {
        if (cancelled) return;
        setUri(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [index, render]);

  return (
    <Pressable
      onPress={() => onToggle(index)}
      style={[styles.page, selected && styles.pageSelected]}
    >
      <View style={{ aspectRatio: PAGE_ASPECT }}>
        {uri != null ? (
          <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        ) : (
          <View style={[styles.image, styles.centered]}>
            <ActivityIndicator size="small" />
          </View>
        )}
      </View>
      <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
        {selected && <Text style={styles.check}>✓</Text>}
      </View>
      <View style={styles.numberTag}>
        <Text style={styles.numberText}>{index + 1}</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerTitle: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  headerAction: { color: '#63a4ff', fontSize: 15, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listWrap: { flex: 1 },
  zoomLayer: { flex: 1 },
  zoomContent: { flexGrow: 1 },
  list: { padding: LIST_PADDING, alignSelf: 'center' },
  pageIndicator: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  pageIndicatorText: { color: '#ffffff', fontSize: 15 },
  goTo: { position: 'absolute', left: 12, right: 12, bottom: 90 },
  page: {
    marginBottom: ROW_GAP,
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: 6,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  pageSelected: { borderColor: '#2f6fed' },
  image: { width: '100%', height: '100%', backgroundColor: '#1a1a1a' },
  checkbox: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#2f6fed',
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#2f6fed' },
  check: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  numberTag: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  numberText: { color: '#ffffff', fontSize: 13 },
  footer: { paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#101418' },
  doneButton: {
    backgroundColor: '#1f8a4c',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  doneDisabled: { opacity: 0.5 },
  doneLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
