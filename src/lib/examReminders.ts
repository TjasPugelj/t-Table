import { ExamItem } from '../api/types';
import { toMinutes } from '../api/untis';
import { cancelScheduled, scheduleReminder } from './notify';
import { newId, Reminder, reminderKey } from './reminders';
import { Settings } from '../store/settings';

/**
 * Keeps a reminder in step with every exam WebUntis reports.
 *
 * Only reminders this sync created (`auto: true`) are ever touched — the moment
 * the user edits one in the lesson sheet it becomes theirs, and a later sync
 * leaves it exactly as they left it.
 */
export async function syncExamReminders(
  exams: ExamItem[],
  settings: Settings,
): Promise<Reminder[] | null> {
  const existing = settings.reminders;

  // Feature off: take back only what we created, leave hand-made ones alone.
  if (!settings.autoExamReminders) {
    const ours = existing.filter((r) => r.auto);
    if (!ours.length) return null;
    await cancelScheduled(ours.flatMap((r) => r.scheduled));
    return existing.filter((r) => !r.auto);
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = exams.filter((e) => e.date >= today);

  const wanted = new Map<string, ExamItem>();
  for (const e of upcoming) {
    if (!e.date || !e.start) continue;
    wanted.set(`${e.date}|${e.subject}|${toMinutes(e.start)}`, e);
  }

  const byKey = new Map(existing.map((r) => [reminderKey(r), r]));
  const days = [...(settings.autoExamDays ?? [])].sort((a, b) => b - a);
  const upToDate = (r: Reminder) =>
    r.kind === 'test' &&
    r.daysBefore.length === days.length &&
    r.daysBefore.every((d, i) => d === days[i]);

  let changed = false;
  const kept: Reminder[] = [];

  // drop auto reminders whose exam is gone or already past
  for (const r of existing) {
    if (r.auto && !wanted.has(reminderKey(r))) {
      await cancelScheduled(r.scheduled);
      changed = true;
      continue;
    }
    kept.push(r);
  }

  const out: Reminder[] = [];
  for (const r of kept) {
    // an auto reminder whose kind or day settings drifted needs rebuilding
    if (r.auto && wanted.has(reminderKey(r)) && !upToDate(r)) {
      await cancelScheduled(r.scheduled);
      const next: Reminder = { ...r, kind: 'test', daysBefore: days, scheduled: [] };
      next.scheduled = await scheduleReminder(next, settings.reminderHour, settings.minimalIcons);
      out.push(next);
      changed = true;
      continue;
    }
    out.push(r);
  }

  // add the missing ones
  for (const [key, e] of wanted) {
    if (byKey.has(key)) continue;
    const base: Reminder = {
      id: newId(),
      date: e.date,
      subject: e.subject || e.name || '—',
      startMin: toMinutes(e.start),
      endMin: toMinutes(e.end || e.start),
      room: e.rooms.join(', '),
      kind: 'test',
      note: (e.text || e.name || '').trim(),
      daysBefore: days,
      minutesBefore: [],
      notify: true,
      scheduled: [],
      auto: true,
    };
    base.scheduled = await scheduleReminder(base, settings.reminderHour, settings.minimalIcons);
    out.push(base);
    changed = true;
  }

  return changed ? out : null;
}
