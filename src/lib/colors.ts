import { Lesson } from '../api/types';
import { Settings, subjectKey } from '../store/settings';
import { StyleSheet } from 'react-native';
import { Theme } from '../theme';

const StyleSheet_hairline = StyleSheet.hairlineWidth;

/** Distinct hues that stay readable on both dark and light backgrounds. */
export const SUBJECT_COLORS = [
  '#4c8dff',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#eab308',
  '#3b82f6',
  '#10b981',
  '#f97316',
  '#a855f7',
  '#06b6d4',
  '#84cc16',
  '#f43f5e',
  '#6366f1',
];

/** Stable colour per subject name — same subject is always the same hue. */
export function subjectColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SUBJECT_COLORS[h % SUBJECT_COLORS.length];
}

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
};

/** Black or white, whichever reads better on top of hex. */
export function readableOn(hex: string): string {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0d1015' : '#ffffff';
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The lesson's colour before any card styling is applied. */
export function lessonColor(lesson: Lesson, theme: Theme, settings: Settings): string {
  if (lesson.cancelled) return theme.cancelled;
  const key = subjectKey(settings, lesson.subject);
  const custom = settings.subjectColors?.[key];
  if (custom) return custom;
  if (lesson.exam) return theme.exam;
  switch (settings.colorSource) {
    case 'subject':
      return subjectColor(key);
    case 'untis':
      return lesson.color ?? subjectColor(key);
    default:
      return lesson.changed ? theme.changed : theme.accent;
  }
}

export interface CardSkin {
  background: string;
  border: string;
  borderWidth: number;
  text: string;
  dim: string;
  /** Width of the left colour bar — 0 when the whole card is coloured. */
  stripe: number;
  stripeColor: string;
}

/** Turns a lesson colour into concrete card colours for the chosen card style. */
export function cardSkin(lesson: Lesson, theme: Theme, settings: Settings): CardSkin {
  const base = lessonColor(lesson, theme, settings);
  const isChanged = lesson.changed && !lesson.cancelled;
  const changedBorder = isChanged ? (settings.changedColor ?? theme.changed) : null;
  const bw = isChanged ? settings.changedWidth : StyleSheet_hairline;

  if (settings.cardStyle === 'solid') {
    const text = readableOn(base);
    return {
      background: base,
      border: changedBorder ?? base,
      borderWidth: bw,
      text,
      dim: withAlpha(text === '#ffffff' ? '#ffffff' : '#000000', 0.72),
      stripe: 0,
      stripeColor: base,
    };
  }

  if (settings.cardStyle === 'tint') {
    return {
      background: withAlpha(base, theme.dark ? 0.22 : 0.16),
      border: changedBorder ?? withAlpha(base, 0.55),
      borderWidth: bw,
      text: theme.text,
      dim: theme.textDim,
      stripe: 4,
      stripeColor: base,
    };
  }

  return {
    background: theme.surface,
    border: changedBorder ?? theme.border,
    borderWidth: bw,
    text: theme.text,
    dim: theme.textDim,
    stripe: 4,
    stripeColor: base,
  };
}


/** Forces black or white where the user asked for it, otherwise keeps the card's own colour. */
export const pickTextColor = (
  mode: 'auto' | 'black' | 'white',
  auto: string,
): string => (mode === 'black' ? '#0d1015' : mode === 'white' ? '#ffffff' : auto);
