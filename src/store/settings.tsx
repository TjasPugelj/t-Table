import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { dict, Lang } from '../lib/i18n';
import { Reminder } from '../lib/reminders';
import { buildTheme, Theme } from '../theme';

/** A lesson card has three slots; each can show any of these. */
export type Field = 'subject' | 'teacher' | 'room' | 'none';

export interface FieldLayout {
  /** Big text, top left. */
  main: Field;
  /** Small text, top right. */
  right: Field;
  /** Small text underneath. */
  sub: Field;
}

export interface Period {
  label: string;
  start: string; // "07:10"
  end: string;
}

export interface Settings {
  /** Untis server host, without protocol. */
  host: string;
  /** Untis school key sent as the Anonymous-School header. */
  school: string;
  classId: number;
  className: string;
  /** School bell schedule — fully editable in Settings. */
  periods: Period[];
  lang: Lang;
  themeKey: string;
  accent: string | null;
  /** Display toggles. */
  showPeriodNumbers: boolean;
  /** What each slot of a lesson card shows, per view. */
  fields: { day: FieldLayout; week: FieldLayout };
  /** Where a lesson's colour comes from. */
  colorSource: 'status' | 'subject' | 'untis';
  /** How much of the card that colour fills. */
  cardStyle: 'stripe' | 'tint' | 'solid';
  /** Manual colour per subject short name — overrides the automatic one. */
  subjectColors: Record<string, string>;
  /** Custom display names for the day view, keyed by the name Untis sends. */
  aliases: { subjects: Record<string, string>; teachers: Record<string, string>; rooms: Record<string, string> };
  /** Shorter names for the cramped week grid; falls back to `aliases`. */
  aliasesWeek: { subjects: Record<string, string>; teachers: Record<string, string>; rooms: Record<string, string> };
  /** Size of the reminder icon drawn in the corner of a lesson. */
  badgeSize: number;
  /** Lesson reminders and the hour their day-before notifications fire. */
  reminders: Reminder[];
  reminderHour: number;
  /** Names seen in loaded timetables, so Settings can list them. */
  knownSubjects: string[];
  knownTeachers: string[];
  knownRooms: string[];
  hideCancelled: boolean;
  compact: boolean;
  /** Keep every period visible, even when the day starts late or ends early. */
  showAllPeriods: boolean;
  /** Squeeze the whole day onto one screen instead of scrolling. */
  fitToScreen: boolean;
  /** Merge a lesson that runs across several periods into one block. */
  mergeBlocks: boolean;
  /** Also merge separate back-to-back entries that show the same thing. */
  mergeIdentical: boolean;
  /** How parallel groups in the same period are laid out. */
  parallelLayout: 'row' | 'column';
  /** Jump back to today whenever the app comes back to the foreground. */
  resetOnResume: boolean;
  /** Transition used when swiping between days and weeks. */
  swipeAnim: 'slide' | 'fade' | 'none';
  /** Untis-style line across the timetable at the current time. */
  nowLine: boolean;
  nowLineColor: string | null;
  /** Fade everything that has already finished today. */
  dimPast: boolean;
  /** Shade the finished part of the lesson happening right now. */
  nowProgress: boolean;
  /** Outline for substituted / changed lessons. */
  changedWidth: number;
  changedColor: string | null;
  defaultView: 'day' | 'week';
}

export const DEFAULT_PERIODS: Period[] = [
  { label: '1', start: '07:10', end: '07:55' },
  { label: '2', start: '08:00', end: '08:45' },
  { label: '3', start: '08:50', end: '09:35' },
  { label: '4', start: '09:40', end: '10:25' },
  { label: '5', start: '10:30', end: '11:15' },
  { label: '6', start: '11:20', end: '12:05' },
  { label: '7', start: '12:10', end: '12:55' },
  { label: '8', start: '13:00', end: '13:45' },
  { label: '9', start: '13:50', end: '14:35' },
];

export const DEFAULTS: Settings = {
  host: 'sc-celje.webuntis.com',
  school: 'sc-celje',
  classId: 2960,
  className: 'M3C',
  periods: DEFAULT_PERIODS,
  lang: 'sl',
  themeKey: 'dark',
  accent: null,
  showPeriodNumbers: true,
  fields: {
    day: { main: 'subject', right: 'room', sub: 'teacher' },
    week: { main: 'subject', right: 'none', sub: 'room' },
  },
  colorSource: 'subject',
  cardStyle: 'tint',
  subjectColors: {},
  aliases: { subjects: {}, teachers: {}, rooms: {} },
  aliasesWeek: { subjects: {}, teachers: {}, rooms: {} },
  badgeSize: 14,
  reminders: [],
  reminderHour: 18,
  knownSubjects: [],
  knownTeachers: [],
  knownRooms: [],
  hideCancelled: false,
  compact: false,
  showAllPeriods: true,
  fitToScreen: true,
  mergeBlocks: true,
  mergeIdentical: true,
  parallelLayout: 'row',
  resetOnResume: true,
  swipeAnim: 'slide',
  nowLine: true,
  nowLineColor: null,
  dimPast: false,
  nowProgress: true,
  changedWidth: 2.5,
  changedColor: null,
  defaultView: 'day',
};

const KEY = 'untis.settings.v1';

interface Ctx {
  settings: Settings;
  theme: Theme;
  t: ReturnType<typeof dict>;
  ready: boolean;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) });
      } catch {
        // corrupt storage — fall back to defaults rather than crashing
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify(settings)).catch(() => {});
  }, [settings, ready]);

  const value = useMemo<Ctx>(
    () => ({
      settings,
      theme: buildTheme(settings.themeKey, settings.accent),
      t: dict(settings.lang),
      ready,
      update: (patch) => setSettings((s) => ({ ...s, ...patch })),
      reset: () => setSettings(DEFAULTS),
    }),
    [settings, ready],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
