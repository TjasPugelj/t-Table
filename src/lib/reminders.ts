import { Lesson } from '../api/types';

export type ReminderKind =
  | 'exam'
  | 'test'
  | 'homework'
  | 'project'
  | 'presentation'
  | 'material'
  | 'note';

/** The default set — colourful and instantly readable. */
export const KIND_ICON: Record<ReminderKind, string> = {
  exam: '📕',
  test: '📝',
  homework: '✏️',
  project: '🛠️',
  presentation: '🎤',
  material: '🎒',
  note: '🔔',
};

/**
 * Monochrome stand-ins for the same seven — a page, a ticked sheet, a pencil,
 * tools, a quote mark for speaking, a packed box, a bell. Plain BMP symbols, so
 * they take the card's own text colour instead of rendering as colour emoji.
 */
export const KIND_ICON_MIN: Record<ReminderKind, string> = {
  exam: '▤',
  test: '☑︎',
  homework: '✎︎',
  project: '⚒︎',
  presentation: '❝',
  material: '⊞',
  note: '⍾',
};

export const kindIcon = (kind: ReminderKind, minimal: boolean) =>
  (minimal ? KIND_ICON_MIN : KIND_ICON)[kind];

export interface Reminder {
  id: string;
  /** The lesson it hangs on. */
  date: string; // YYYY-MM-DD
  subject: string;
  startMin: number;
  endMin: number;
  room: string;
  kind: ReminderKind;
  note: string;
  /** Whole days before the lesson, e.g. [7, 3, 1]; 0 = the same morning. */
  daysBefore: number[];
  /** Minutes before the lesson starts, e.g. [60]. */
  minutesBefore: number[];
  /** Off = the reminder is just a marker on the timetable. */
  notify: boolean;
  /** OS notification ids, so they can be cancelled when the reminder changes. */
  scheduled: string[];
  /**
   * Created automatically from a WebUntis exam rather than by hand. Editing one
   * in the lesson sheet clears the flag, so the user's version is never
   * overwritten or removed by a later sync.
   */
  auto?: boolean;
}

/** Identifies the lesson a reminder belongs to. */
export const lessonKey = (date: string, l: Lesson) => `${date}|${l.subject}|${l.startMin}`;

export const reminderKey = (r: Reminder) => `${r.date}|${r.subject}|${r.startMin}`;

export const findReminder = (list: Reminder[], date: string, l: Lesson) =>
  list.find((r) => reminderKey(r) === lessonKey(date, l));

export const DAY_OPTIONS = [7, 6, 5, 4, 3, 2, 1, 0];
export const MINUTE_OPTIONS = [60, 30, 15, 5];

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Every moment this reminder should fire, as real Dates in the future. */
export function fireTimes(r: Reminder, dayHour: number): Date[] {
  const [y, m, d] = r.date.split('-').map(Number);
  const lesson = new Date(y, m - 1, d, Math.floor(r.startMin / 60), r.startMin % 60, 0, 0);
  const out: Date[] = [];

  for (const days of r.daysBefore) {
    const t = new Date(lesson);
    t.setDate(t.getDate() - days);
    t.setHours(dayHour, 0, 0, 0);
    out.push(t);
  }
  for (const mins of r.minutesBefore) {
    out.push(new Date(lesson.getTime() - mins * 60_000));
  }

  const now = Date.now();
  return out.filter((t) => t.getTime() > now + 5_000).sort((a, b) => a.getTime() - b.getTime());
}
