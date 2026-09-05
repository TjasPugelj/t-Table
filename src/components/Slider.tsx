import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { Theme } from '../theme';

interface Props {
  value: number;
  min: number;
  max: number;
  /** Rounding step; 1 for whole pixels, 0.5 for finer widths. */
  step?: number;
  onChange: (v: number) => void;
  theme: Theme;
  /** Optional text on the right, e.g. the value drawn at its own size. */
  suffix?: React.ReactNode;
}

/**
 * A small dependency-free slider — RN has no built-in one, and pulling in a
 * native module would mean another install step.
 */
export default function Slider({ value, min, max, step = 1, onChange, theme, suffix }: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const cb = useRef(onChange);
  cb.current = onChange;

  /**
   * The thumb's own position while dragging, separate from `value` — it
   * updates on every touch event so the drag feels immediate, while the
   * commit to the parent (which re-renders Settings and writes to storage) is
   * capped to once per animation frame below. Calling onChange on every raw
   * touch-move, as this used to, fired far more often than the screen could
   * actually redraw and was the real source of the lag.
   */
  const [live, setLive] = useState<number | null>(null);
  /**
   * Position at the start of the drag, in pixels. Movement is then tracked
   * via the gesture's cumulative `dx` rather than re-reading `locationX` on
   * every event — once the finger wanders outside the track's own bounds
   * (easy to do on a 36px-tall hit area), `locationX` starts reporting
   * position relative to whatever view is currently under the finger and the
   * thumb jumps. `dx` stays a stable delta from the grant point regardless.
   */
  const basePx = useRef(0);
  const pendingValue = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  const valueAt = (px: number) => {
    const w = widthRef.current;
    if (!w) return value;
    const ratio = Math.max(0, Math.min(1, px / w));
    const raw = min + ratio * (max - min);
    return Number((Math.round(raw / step) * step).toFixed(2));
  };

  const commit = (v: number) => {
    pendingValue.current = v;
    if (raf.current != null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      if (pendingValue.current != null) cb.current(pendingValue.current);
    });
  };

  const flush = () => {
    if (raf.current != null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
    if (pendingValue.current != null) {
      cb.current(pendingValue.current);
      pendingValue.current = null;
    }
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // once a drag has started, don't let the surrounding ScrollView steal it
      // mid-gesture — that hand-off is what made dragging feel like it kept
      // stuttering or resetting partway through
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        const px = Math.max(0, Math.min(widthRef.current, e.nativeEvent.locationX));
        basePx.current = px;
        const v = valueAt(px);
        setLive(v);
        commit(v);
      },
      onPanResponderMove: (_, g) => {
        const px = Math.max(0, Math.min(widthRef.current, basePx.current + g.dx));
        const v = valueAt(px);
        setLive(v);
        commit(v);
      },
      onPanResponderRelease: () => {
        flush();
        setLive(null);
      },
      onPanResponderTerminate: () => {
        flush();
        setLive(null);
      },
    }),
  ).current;

  const shown = live ?? value;
  const ratio = Math.max(0, Math.min(1, (shown - min) / (max - min)));

  return (
    <View style={styles.row}>
      <View
        style={styles.hit}
        onLayout={(e) => {
          widthRef.current = e.nativeEvent.layout.width;
          setWidth(e.nativeEvent.layout.width);
        }}
        {...pan.panHandlers}
      >
        <View style={[styles.track, { backgroundColor: theme.border }]}>
          <View
            style={[styles.fill, { backgroundColor: theme.accent, width: `${ratio * 100}%` }]}
          />
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              backgroundColor: theme.accent,
              borderColor: theme.surface,
              left: Math.max(0, ratio * width - 11),
            },
          ]}
        />
      </View>

      <View style={styles.value}>
        {suffix ?? (
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 13 }}>{shown}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hit: { flex: 1, height: 36, justifyContent: 'center' },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
  thumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
  },
  value: { minWidth: 46, alignItems: 'flex-end' },
});
