export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

// translateX/Y are applied AFTER scale in the wrapper's transform array (see AnnotateScreen), which
// per RN/CSS transform composition means they're expressed directly in screen pixels rather than
// the pre-scale local coordinate space - so a 1-finger drag's raw gestureState.dx/dy can be used as
// translateX/Y deltas directly, with no division by scale needed to get natural, no-lag panning.
// Deliberately unbounded (no clamping against content size): two earlier bound formulas both got
// the "how far can you pan" math wrong for a multi-page document in different ways (one modeled it
// as a single screen-sized image, the other only bounded it against the wrapper's own laid-out
// size, neither of which reflects the FlatList's real, much taller content) and produced a "panning
// gets stuck" bug each time. The always-visible Reset zoom button is the deliberate recovery path
// instead - simpler and more predictable than another bound formula.
export interface ZoomState {
  scale: number;
  translateX: number;
  translateY: number;
}

export const IDENTITY_ZOOM: ZoomState = { scale: 1, translateX: 0, translateY: 0 };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function touchDistance(a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }): number {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

export function touchMidpoint(
  a: { pageX: number; pageY: number },
  b: { pageX: number; pageY: number },
): { x: number; y: number } {
  return { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 };
}
