import React, { useEffect, useRef, useState } from 'react';
import { Image, PanResponder, StyleSheet, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Point, Stroke } from './types';

interface DrawingCanvasProps {
  pageImageUri: string;
  width: number;
  height: number;
  strokes: Stroke[];
  activeColor: string;
  activeStrokeWidth: number;
  onStrokesChange: (strokes: Stroke[]) => void;
  /** When false, this canvas ignores single-finger touches so an ancestor (e.g. the page list's
   * own scroll, or a pinch-zoom handler) can claim them instead. Defaults to true to match this
   * component's original always-draws behavior. */
  drawingEnabled?: boolean;
}

// Quadratic-bezier-through-midpoints smoothing: the standard technique for turning sparse,
// jagged touch-move samples into a visually smooth freehand line. Mirrored on the native side
// (AnnotationModule's Canvas/Path drawing) so the on-screen preview and the saved PDF match.
function buildSmoothPathD(points: Point[]): string {
  if (points.length === 0) {
    return '';
  }
  const [first] = points;
  if (points.length === 1) {
    return `M${first.x},${first.y} L${first.x},${first.y}`;
  }

  let d = `M${first.x},${first.y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    d += ` Q${current.x},${current.y} ${midX},${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L${last.x},${last.y}`;
  return d;
}

export function DrawingCanvas({
  pageImageUri,
  width,
  height,
  strokes,
  activeColor,
  activeStrokeWidth,
  onStrokesChange,
  drawingEnabled = true,
}: DrawingCanvasProps): React.JSX.Element {
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);

  // PanResponder.create runs once; without refs its handlers would close over stale props.
  const strokesRef = useRef(strokes);
  const activeColorRef = useRef(activeColor);
  const activeStrokeWidthRef = useRef(activeStrokeWidth);
  const onStrokesChangeRef = useRef(onStrokesChange);
  const drawingEnabledRef = useRef(drawingEnabled);

  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);
  useEffect(() => {
    activeColorRef.current = activeColor;
  }, [activeColor]);
  useEffect(() => {
    activeStrokeWidthRef.current = activeStrokeWidth;
  }, [activeStrokeWidth]);
  useEffect(() => {
    onStrokesChangeRef.current = onStrokesChange;
  }, [onStrokesChange]);
  useEffect(() => {
    drawingEnabledRef.current = drawingEnabled;
  }, [drawingEnabled]);

  const panResponder = useRef(
    PanResponder.create({
      // Single-finger only, and only while drawing is enabled - a second finger (pinch-zoom) or
      // scroll-mode must be free to claim the gesture instead (see onPanResponderTerminationRequest
      // below and AnnotatePageItem's zoom responder, which captures as soon as a 2nd touch lands).
      onStartShouldSetPanResponder: (evt: GestureResponderEvent) =>
        drawingEnabledRef.current && evt.nativeEvent.touches.length <= 1,
      onMoveShouldSetPanResponder: (evt: GestureResponderEvent) =>
        drawingEnabledRef.current && evt.nativeEvent.touches.length <= 1,
      onPanResponderTerminationRequest: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        setCurrentPoints([{ x: locationX, y: locationY }]);
      },
      // locationX/locationY (rather than gestureState.dx/dy, which are raw screen-pixel deltas) are
      // used so points stay correct in this view's own local coordinate space even when an ancestor
      // applies a live pinch-zoom transform - native touch dispatch reports touch location already
      // adjusted for any ancestor transform, so this canvas always captures points in the same fixed,
      // unzoomed page-image space that pageDpi describes, regardless of the on-screen zoom level.
      onPanResponderMove: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        setCurrentPoints(previous => [...previous, { x: locationX, y: locationY }]);
      },
      onPanResponderRelease: () => {
        setCurrentPoints(previous => {
          if (previous.length > 0) {
            const finishedStroke: Stroke = {
              points: previous,
              color: activeColorRef.current,
              strokeWidthDp: activeStrokeWidthRef.current,
            };
            onStrokesChangeRef.current([...strokesRef.current, finishedStroke]);
          }
          return [];
        });
      },
      onPanResponderTerminate: () => {
        setCurrentPoints([]);
      },
    }),
  ).current;

  return (
    <View style={[styles.container, { width, height }]} {...panResponder.panHandlers}>
      <Image source={{ uri: pageImageUri }} style={{ width, height }} resizeMode="stretch" />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {strokes.map((stroke, index) => (
          <Path
            key={index}
            d={buildSmoothPathD(stroke.points)}
            stroke={stroke.color}
            strokeWidth={stroke.strokeWidthDp}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
        {currentPoints.length > 0 && (
          <Path
            d={buildSmoothPathD(currentPoints)}
            stroke={activeColor}
            strokeWidth={activeStrokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});
