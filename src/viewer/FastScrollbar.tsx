import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

interface FastScrollbarProps {
  pageCount: number;
  currentPage: number;
  onJumpToPage: (page: number) => void;
}

const THUMB_HEIGHT = 56;
const TRACK_WIDTH = 36;

/** Right-edge handle: drag it along the screen to jump through the document quickly. */
export function FastScrollbar({
  pageCount,
  currentPage,
  onJumpToPage,
}: FastScrollbarProps): React.JSX.Element | null {
  const [trackHeight, setTrackHeight] = useState(0);
  const [dragPage, setDragPage] = useState<number | null>(null);
  const startY = useRef(0);
  const lastPage = useRef(currentPage);
  const latest = useRef({ trackHeight, pageCount, currentPage, onJumpToPage });
  latest.current = { trackHeight, pageCount, currentPage, onJumpToPage };

  const responder = useMemo(() => {
    const travel = () => Math.max(latest.current.trackHeight - THUMB_HEIGHT, 1);
    const pageAt = (y: number) => {
      const ratio = Math.min(Math.max(y / travel(), 0), 1);
      return Math.round(ratio * (latest.current.pageCount - 1)) + 1;
    };
    const jump = (page: number) => {
      setDragPage(page);
      if (page !== lastPage.current) {
        lastPage.current = page;
        latest.current.onJumpToPage(page);
      }
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: event => {
        const { pageCount: count, currentPage: page } = latest.current;
        const thumbTop = count > 1 ? ((page - 1) / (count - 1)) * travel() : 0;
        // Grabbing the handle keeps it under the finger; grabbing the track jumps it there first.
        const touchY = event.nativeEvent.locationY;
        const onThumb = touchY >= 0 && touchY <= THUMB_HEIGHT;
        startY.current = onThumb
          ? thumbTop
          : Math.max(touchY - THUMB_HEIGHT / 2, 0) + 0;
        lastPage.current = page;
        jump(onThumb ? page : pageAt(startY.current));
      },
      onPanResponderMove: (_event, gesture) =>
        jump(pageAt(startY.current + gesture.dy)),
      onPanResponderRelease: () => setDragPage(null),
      onPanResponderTerminate: () => setDragPage(null),
    });
  }, []);

  if (pageCount < 2) return null;

  const shown = dragPage ?? currentPage;
  const top =
    ((shown - 1) / (pageCount - 1)) * Math.max(trackHeight - THUMB_HEIGHT, 0);

  // The bubble sits beside the strip, outside its bounds, and Android clips children to their
  // parent - so it lives in a wider pass-through wrapper, while only the narrow strip takes touches.
  return (
    <View
      style={styles.wrapper}
      pointerEvents="box-none"
      onLayout={event => setTrackHeight(event.nativeEvent.layout.height)}
    >
      <View style={styles.track} {...responder.panHandlers}>
        <View
          style={[
            styles.thumb,
            dragPage != null && styles.thumbActive,
            { top },
          ]}
        >
          <View style={styles.grip} />
        </View>
      </View>
      {dragPage != null && (
        <View
          style={[styles.bubble, { top: top + THUMB_HEIGHT / 2 - 18 }]}
          pointerEvents="none"
        >
          <Text style={styles.bubbleText} numberOfLines={1}>
            {dragPage} / {pageCount}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', top: 0, bottom: 0, right: 0, left: 0 },
  track: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: TRACK_WIDTH,
  },
  thumb: {
    position: 'absolute',
    right: 2,
    width: 12,
    height: THUMB_HEIGHT,
    borderRadius: 6,
    backgroundColor: 'rgba(120,130,145,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbActive: { backgroundColor: '#2f6fed', width: 16 },
  grip: {
    width: 2,
    height: 22,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  bubble: {
    position: 'absolute',
    right: TRACK_WIDTH + 4,
    height: 36,
    minWidth: 84,
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: '#2f6fed',
    justifyContent: 'center',
  },
  bubbleText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
});
