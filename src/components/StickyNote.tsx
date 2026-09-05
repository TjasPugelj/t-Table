import React from 'react';
import { View } from 'react-native';

export const FLAG_COLORS: Record<string, string> = {
  red: '#ef4444',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
};

interface Props {
  color: string;
  /** Ribbon height; width follows it. */
  size?: number;
  /** Card colour behind it — used to cut the notch out of the tail. */
  bg: string;
  /** The V cut at the bottom; off gives a plain tab. */
  notch?: boolean;
}

/** A bookmark ribbon hanging from the top edge of the lesson box. */
export default function StickyNote({ color, size = 26, bg, notch: withNotch = true }: Props) {
  const fill = FLAG_COLORS[color] ?? color;
  const width = Math.round(size * 0.62);
  const notch = Math.round(width / 2);

  return (
    <View
      style={{
        width,
        height: size,
        backgroundColor: fill,
        borderBottomLeftRadius: 2,
        borderBottomRightRadius: 2,
        overflow: 'hidden',
      }}
    >
      {/* the V cut at the bottom, painted in the card's own colour */}
      {withNotch && (
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: 0,
          height: 0,
          borderLeftWidth: notch,
          borderRightWidth: notch,
          borderBottomWidth: Math.round(size * 0.32),
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: bg,
        }}
      />
      )}
    </View>
  );
}
