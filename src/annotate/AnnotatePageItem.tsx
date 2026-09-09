import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
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

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

interface ZoomState {
  scale: number;
  translateX: number;
  translateY: number;
}

const IDENTITY_ZOOM: ZoomState = { scale: 1, translateX: 0, translateY: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function touchDistance(a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }): number {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

function touchMidpoint(
  a: { pageX: number; pageY: number },
  b: { pageX: number; pageY: number },
): { x: number; y: number } {
  return { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 };
}

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

  const [zoom, setZoom] = useState<ZoomState>(IDENTITY_ZOOM);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const gestureStartRef = useRef<{
    distance: number;
    focal: { x: number; y: number };
    zoomAtStart: ZoomState;
  } | null>(null);

  const handleStrokesChange = useCallback(
    (nextStrokes: Stroke[]) => onStrokesChange(pageIndex, nextStrokes),
    [onStrokesChange, pageIndex],
  );

  // Captures the responder as soon as a 2nd finger touches down, regardless of whether
  // DrawingCanvas's own single-finger responder already holds it mid-stroke (its
  // onPanResponderTerminationRequest always yields, cancelling that in-progress stroke).
  // Scale/translate are derived from raw pageX/pageY (screen space, unaffected by our own
  // transform) so the pinch math itself never needs to account for the current zoom level.
  const zoomResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (evt: GestureResponderEvent) =>
        evt.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponderCapture: (evt: GestureResponderEvent) =>
        evt.nativeEvent.touches.length >= 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const { touches } = evt.nativeEvent;
        if (touches.length < 2) return;
        gestureStartRef.current = {
          distance: touchDistance(touches[0], touches[1]),
          focal: touchMidpoint(touches[0], touches[1]),
          zoomAtStart: zoomRef.current,
        };
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        const { touches } = evt.nativeEvent;
        const gestureStart = gestureStartRef.current;
        if (touches.length < 2 || gestureStart == null || gestureStart.distance === 0) return;

        const currentDistance = touchDistance(touches[0], touches[1]);
        const currentFocal = touchMidpoint(touches[0], touches[1]);

        setZoom({
          scale: clamp(
            gestureStart.zoomAtStart.scale * (currentDistance / gestureStart.distance),
            MIN_ZOOM,
            MAX_ZOOM,
          ),
          translateX: gestureStart.zoomAtStart.translateX + (currentFocal.x - gestureStart.focal.x),
          translateY: gestureStart.zoomAtStart.translateY + (currentFocal.y - gestureStart.focal.y),
        });
      },
      onPanResponderRelease: () => {
        gestureStartRef.current = null;
      },
      onPanResponderTerminate: () => {
        gestureStartRef.current = null;
      },
    }),
  ).current;

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
    <View style={[styles.clip, { width: canvasSize.width, height: canvasSize.height }]} {...zoomResponder.panHandlers}>
      <View
        style={{
          width: canvasSize.width,
          height: canvasSize.height,
          transform: [{ translateX: zoom.translateX }, { translateY: zoom.translateY }, { scale: zoom.scale }],
        }}
      >
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
