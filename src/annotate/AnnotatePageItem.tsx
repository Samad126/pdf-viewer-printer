import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { DrawingCanvas } from './DrawingCanvas';
import type { Stroke } from './types';

export interface PageCanvasSize {
  width: number;
  height: number;
}

export type PageRenderEntry =
  | { status: 'loading' }
  | { status: 'ready'; imageUri: string; canvasSize: PageCanvasSize }
  | { status: 'error' };

interface AnnotatePageItemProps {
  pageIndex: number;
  width: number;
  estimatedHeight: number;
  entry: PageRenderEntry | undefined;
  strokes: Stroke[];
  activeColor: string;
  activeStrokeWidth: number;
  drawingEnabled: boolean;
  onStrokesChange: (pageIndex: number, strokes: Stroke[]) => void;
  onRequestRender: (pageIndex: number) => void;
}

export const PAGE_ROW_GAP = 16;

export function AnnotatePageItem({
  pageIndex,
  width,
  estimatedHeight,
  entry,
  strokes,
  activeColor,
  activeStrokeWidth,
  drawingEnabled,
  onStrokesChange,
  onRequestRender,
}: AnnotatePageItemProps): React.JSX.Element {
  useEffect(() => {
    onRequestRender(pageIndex);
  }, [onRequestRender, pageIndex]);

  const handleStrokesChange = useCallback(
    (nextStrokes: Stroke[]) => onStrokesChange(pageIndex, nextStrokes),
    [onStrokesChange, pageIndex],
  );

  if (entry == null || entry.status !== 'ready') {
    return (
      <View style={[styles.placeholder, { width, height: estimatedHeight }]}>
        {entry != null && entry.status === 'error' ? (
          <Text style={styles.errorText}>Failed to load page {pageIndex + 1}</Text>
        ) : (
          <ActivityIndicator size="large" color="#2f6fed" />
        )}
      </View>
    );
  }

  const { imageUri, canvasSize } = entry;

  return (
    <View style={[styles.clip, { width: canvasSize.width, height: canvasSize.height }]}>
      <DrawingCanvas
        pageImageUri={imageUri}
        width={canvasSize.width}
        height={canvasSize.height}
        strokes={strokes}
        activeColor={activeColor}
        activeStrokeWidth={activeStrokeWidth}
        drawingEnabled={drawingEnabled}
        onStrokesChange={handleStrokesChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: PAGE_ROW_GAP,
    backgroundColor: '#1c2128',
    borderRadius: 4,
  },
  clip: {
    marginBottom: PAGE_ROW_GAP,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  errorText: {
    color: '#ffb4b4',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
});
