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

// A single move sample landing further than this fraction of the canvas's largest dimension away
// from the previous point is rejected outright rather than drawn to - see onPanResponderMove.
const MAX_JUMP_FRACTION = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
  // A touch-down's point is held here, NOT yet in currentPoints/rendered, until either real
  // movement happens or the touch cleanly releases with none - see onPanResponderGrant.
  const pendingPointRef = useRef<Point | null>(null);

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
      // Deliberately does NOT call setCurrentPoints here, so a touch-down renders nothing yet. When
      // starting a pinch, the two fingers almost never land in the exact same instant - the first
      // one briefly registers alone, and used to render a dot right where it landed before the
      // second finger arrived and the zoom responder's capture phase stole the gesture away. By
      // deferring until onPanResponderMove (real movement - confirms an actual single-finger
      // stroke) or onPanResponderRelease with no movement (a clean, deliberate tap-dot, never
      // interrupted by a second finger), a touch that gets stolen by an incoming pinch never
      // renders or commits anything in the first place.
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        pendingPointRef.current = { x: clamp(locationX, 0, width), y: clamp(locationY, 0, height) };
      },
      // locationX/locationY (rather than gestureState.dx/dy, which are raw screen-pixel deltas) are
      // used so points stay correct in this view's own local coordinate space even when an ancestor
      // applies a live pinch-zoom transform - native touch dispatch reports touch location already
      // adjusted for any ancestor transform, so this canvas always captures points in the same fixed,
      // unzoomed page-image space that pageDpi describes, regardless of the on-screen zoom level.
      //
      // Clamping keeps a finger that drags past the physical edge of the canvas tracking along
      // that edge (rather than being dropped) - but a touch that leaves this view's bounds mid-
      // gesture can also hit a known Android/RN quirk where locationX/Y briefly gets reported
      // relative to a different, unrelated view instead of continuing to extrapolate past this
      // one's edge, producing one wildly-wrong in-range coordinate. A single real move sample never
      // jumps anywhere near half the canvas's size between two consecutive events, so any sample
      // that does is dropped rather than drawn to, which is what stopped strokes from snapping a
      // line across to an unrelated point when the finger grazed an edge.
      onPanResponderMove: (evt: GestureResponderEvent) => {
        const { locationX, locationY } = evt.nativeEvent;
        const nextX = clamp(locationX, 0, width);
        const nextY = clamp(locationY, 0, height);

        const pendingPoint = pendingPointRef.current;
        if (pendingPoint != null) {
          // First real movement since touch-down - this is genuinely a single-finger stroke (an
          // incoming second finger would have stolen the gesture via onPanResponderTerminate by
          // now, before any move could reach here), so start rendering from the original
          // touch-down point onward.
          pendingPointRef.current = null;
          setCurrentPoints([pendingPoint, { x: nextX, y: nextY }]);
          return;
        }

        setCurrentPoints(previous => {
          if (previous.length > 0) {
            const last = previous[previous.length - 1];
            const maxJump = Math.max(width, height) * MAX_JUMP_FRACTION;
            if (Math.hypot(nextX - last.x, nextY - last.y) > maxJump) return previous;
          }
          return [...previous, { x: nextX, y: nextY }];
        });
      },
      onPanResponderRelease: () => {
        const pendingPoint = pendingPointRef.current;
        if (pendingPoint != null) {
          // Released with no movement in between - a clean, deliberate tap that was never
          // interrupted by a second finger, so it's safe to commit as a single-point dot stroke.
          pendingPointRef.current = null;
          const finishedStroke: Stroke = {
            points: [pendingPoint],
            color: activeColorRef.current,
            strokeWidthDp: activeStrokeWidthRef.current,
          };
          onStrokesChangeRef.current([...strokesRef.current, finishedStroke]);
          return;
        }

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
        // Stolen by an incoming pinch (or similar) before movement or release - nothing was ever
        // rendered/committed for this touch (see onPanResponderGrant), so there's nothing to undo
        // beyond clearing the pending point.
        pendingPointRef.current = null;
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
