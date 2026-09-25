import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { closePdfDocument, openPdfDocument, renderPdfPageToFile } from '../pdf/NativePdfiumModule';

interface PrintPreviewStripProps {
  filePath: string;
  /** 0-based pages that will be printed. */
  pageIndices: number[];
}

const MAX_PREVIEW_PAGES = 12;
const PREVIEW_DPI = 60;

/** Thumbnails of exactly the pages that will be printed, so the choice can be checked first. */
export function PrintPreviewStrip({ filePath, pageIndices }: PrintPreviewStripProps): React.JSX.Element {
  const shown = pageIndices.slice(0, MAX_PREVIEW_PAGES);
  const key = shown.join(',');
  const [thumbs, setThumbs] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    let handle: string | null = null;
    setThumbs({});
    (async () => {
      try {
        const inspection = await openPdfDocument(filePath, null);
        if (!inspection.canOpen || !inspection.handle) return;
        handle = inspection.handle;
        for (const index of shown) {
          if (cancelled) return;
          const out = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/print-preview-${index}-${Date.now()}.png`;
          const rendered = await renderPdfPageToFile(handle, index, PREVIEW_DPI, out);
          if (cancelled) return;
          setThumbs(previous => ({ ...previous, [index]: `file://${rendered.outputPath}` }));
        }
      } catch {
        // Preview is a convenience; printing works without it.
      } finally {
        if (handle != null) closePdfDocument(handle).catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, key]);

  const extra = pageIndices.length - shown.length;

  return (
    <View>
      <Text style={styles.caption}>
        Will print {pageIndices.length} {pageIndices.length === 1 ? 'page' : 'pages'}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {shown.map(index => (
          <View key={index} style={styles.item}>
            {thumbs[index] != null ? (
              <Image source={{ uri: thumbs[index] }} style={styles.thumb} resizeMode="contain" />
            ) : (
              <View style={[styles.thumb, styles.loading]}>
                <ActivityIndicator size="small" />
              </View>
            )}
            <Text style={styles.pageLabel}>{index + 1}</Text>
          </View>
        ))}
        {extra > 0 && <Text style={styles.more}>+{extra} more</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { color: '#a0a8b4', fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  item: { marginRight: 8, alignItems: 'center' },
  thumb: { width: 72, height: 96, borderRadius: 4, backgroundColor: '#ffffff' },
  loading: { backgroundColor: '#1c2128', alignItems: 'center', justifyContent: 'center' },
  pageLabel: { color: '#a0a8b4', fontSize: 11, marginTop: 2 },
  more: { color: '#a0a8b4', alignSelf: 'center', marginLeft: 4 },
});
