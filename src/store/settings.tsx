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
  /** Font sizes of the three card slots in the day view. */
  mainSize: number;
  roomSize: number;
  subSize: number;
  /** Text colour per slot: follow the card (auto), or force black / white. */
  textColorMain: 'auto' | 'black' | 'white';
  textColorRight: 'auto' | 'black' | 'white';
  textColorSub: 'auto' | 'black' | 'white';
  /** Vertical placement of the right-hand field inside the box. */
  rightAlign: 'top' | 'center' | 'bottom';
  /** Same three slots, sized separately for the cramped week grid. */
  weekMainSize: number;
  weekRightSize: number;
  weekSubSize: number;
  /** Size of the reminder icon drawn in the corner of a lesson. */
  badgeSize: number;
  /** Free-text notes shared by every lesson of the same subject. */
  subjectNotes: Record<string, string>;
  /** Subject → group name, so variants like MES and MESv act as one subject. */
  subjectGroups: Record<string, string>;
  /** Bookmark colours per subject — several can be on at once. */
  subjectFlags: Record<string, string[]>;
  /** Lesson reminders and the hour their day-before notifications fire. */
  reminders: Reminder[];
  reminderHour: number;
  /** Create a reminder automatically for every exam WebUntis reports. */
  autoExamReminders: boolean;
  /** Days before an exam those automatic reminders fire on. */
  autoExamDays: number[];
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
  /** Join consecutive lessons that show the same thing into one box. */
  mergeDay: boolean;
  /** Merge consecutive identical lessons into one tall box in the week grid. */
  weekMerge: boolean;
  /** Height of each period row in week view (aligned layout only). */
  weekRowHeight: number;
  /** How parallel groups in the same period are laid out. */
  parallelLayout: 'row' | 'column';
  /** Jump back to today whenever the app comes back to the foreground. */
  resetOnResume: boolean;
  /**
   * Day bar lined up with the week grid's columns, with the grid's own day
   * header dropped. Off = the original layout: a full-width day bar plus a
   * separate day row inside the grid.
   */
  alignedDayBar: boolean;
  /** Plain monochrome marks instead of the colour emoji on reminders. */
  minimalIcons: boolean;
  /** Transition used when swiping between days and weeks. Always 'slide'. */
  swipeAnim: 'slide';
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
  cardStyle: 'solid',
  subjectColors: {},
  aliases: { subjects: {}, teachers: {}, rooms: {} },
  aliasesWeek: { subjects: {}, teachers: {}, rooms: {} },
  mainSize: 16,
  roomSize: 20,
  subSize: 13,
  textColorMain: 'auto',
  textColorRight: 'auto',
  textColorSub: 'auto',
  rightAlign: 'center',
  weekMainSize: 11,
  weekRightSize: 9,
  weekSubSize: 9,
  badgeSize: 14,
  subjectNotes: {},
  subjectFlags: {},
  subjectGroups: {},
  reminders: [],
  reminderHour: 18,
  autoExamReminders: true,
  autoExamDays: [2, 1],
  knownSubjects: [],
  knownTeachers: [],
  knownRooms: [],
  hideCancelled: false,
  compact: false,
  showAllPeriods: true,
  fitToScreen: true,
  mergeDay: true,
  weekMerge: true,
  weekRowHeight: 66,
  parallelLayout: 'row',
  resetOnResume: true,
  alignedDayBar: true,
  minimalIcons: false,
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
/**
 * A one-time nudge, separate from the settings blob itself: the aligned day
 * bar shipped with a false default for one build before switching to true, so
 * anyone who had already loaded the app in that window got `alignedDayBar:
 * false` written into their saved settings — which then wins over any later
 * default change forever, since the load merge is {...DEFAULTS, ...stored}.
 * Bump MIGRATION when a stored default needs correcting like this once; it
 * never touches a value the user changed by hand afterwards, since it only
 * fires when the stored rev is behind.
 */
const MIGRATION_KEY = 'untis.settings.rev';
const MIGRATION = 1;

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
        const rev = Number((await AsyncStorage.getItem(MIGRATION_KEY)) ?? '0');
        const loaded: Settings = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
        if (rev < 1) loaded.alignedDayBar = true;
        if (rev < MIGRATION) await AsyncStorage.setItem(MIGRATION_KEY, String(MIGRATION));
        setSettings(loaded);
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


/** The key notes, colours and bookmarks are stored under — a group if set. */
export function subjectKey(s: Settings, subject: string): string {
  const g = s.subjectGroups?.[subject]?.trim();
  return g ? g : subject;
}

/** Tolerates the old single-string shape stored by earlier versions. */
export function subjectFlagList(s: Settings, subject: string): string[] {
  const v = (s.subjectFlags as Record<string, unknown>)?.[subjectKey(s, subject)];
  if (Array.isArray(v)) return v as string[];
  return typeof v === 'string' && v ? [v] : [];
}
