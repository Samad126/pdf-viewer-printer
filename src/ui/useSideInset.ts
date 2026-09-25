import { useWindowDimensions } from 'react-native';

export const MAX_PANEL_WIDTH = 560;
const MIN_SIDE_INSET = 12;

/** Side margin that keeps floating panels a comfortable width and centered on wide screens. */
export function useSideInset(): number {
  const { width } = useWindowDimensions();
  return Math.max(MIN_SIDE_INSET, (width - MAX_PANEL_WIDTH) / 2);
}

export function useIsTablet(): boolean {
  const { width } = useWindowDimensions();
  return width >= 600;
}
