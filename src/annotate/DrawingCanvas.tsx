import React, { useEffect, useRef, useState } from 'react';
import { Image, PanResponder, StyleSheet, View } from 'react-native';
import type { GestureResponderEvent, PanResponderGestureState } from 'react-native';
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
}: DrawingCanvasProps): React.JSX.Element {
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);

  // PanResponder.create runs once; without refs its handlers would close over stale props.
  const strokesRef = useRef(strokes);
  const activeColorRef = useRef(activeColor);
  const activeStrokeWidthRef = useRef(activeStrokeWidth);
  const onStrokesChangeRef = useRef(onStrokesChange);
  const startPointRef = useRef<Point>({ x: 0, y: 0 });

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

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        startPointRef.current = { x: locationX, y: locationY };
        setCurrentPoints([{ x: locationX, y: locationY }]);
      },
      onPanResponderMove: (_evt: GestureResponderEvent, gestureState: PanResponderGestureState) => {
        const x = startPointRef.current.x + gestureState.dx;
        const y = startPointRef.current.y + gestureState.dy;
        setCurrentPoints(previous => [...previous, { x, y }]);
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
