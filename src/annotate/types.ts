export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  points: Point[];
  color: string;
  strokeWidthDp: number;
}

/** Keyed by 0-based page index. Pages with no drawing simply have no entry. */
export type PageAnnotations = Record<number, Stroke[]>;
