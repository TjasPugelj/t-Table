import { Lesson } from '../api/types';
import { toMinutes } from '../api/untis';
import { Period } from '../store/settings';

export interface Row {
  /** Period indices this row covers (inclusive, 0-based). */
  from: number;
  to: number;
  lessons: Lesson[];
}

/**
 * A class split into three PE groups shows up as three entries at the same time
 * with the same subject — collapse those into one box, keeping every room and
 * teacher. Entries with a different status (one cancelled, one not) stay apart.
 */
export function mergeSameSubject(lessons: Lesson[]): Lesson[] {
  const byKey = new Map<string, Lesson>();
  const out: Lesson[] = [];
  for (const l of lessons) {
    // never merge across groups — group 1 and group 2 can share a subject
    const key = `${l.subject}|${l.status}|${l.startMin}|${l.endMin}|${columnOf(l)}|${columnCount(l)}|${l.groupLabel ?? ''}`;
    const prev = byKey.get(key);
    if (!prev) {
      const copy: Lesson = { ...l, rooms: [...l.rooms], teachers: [...l.teachers] };
      byKey.set(key, copy);
      out.push(copy);
      continue;
    }
    for (const r of l.rooms) if (!prev.rooms.includes(r)) prev.rooms.push(r);
    for (const t of l.teachers) if (!prev.teachers.includes(t)) prev.teachers.push(t);
  }
  return out;
}

const signature = (ls: Lesson[]) =>
  ls
    .map((l) => l.id)
    .sort()
    .join('|');

/**
 * Slot lessons into the bell schedule, then merge consecutive periods that hold
 * the same lesson(s) so a double period becomes one block. Leading and trailing
 * empty periods are trimmed so the day starts at the first lesson.
 */
export function buildRows(lessons: Lesson[], periods: Period[], merge: boolean): Row[] {
  const perPeriod = periods.map((p) => {
    const ps = toMinutes(p.start);
    const pe = toMinutes(p.end);
    // overlap, not full coverage — short or offset lessons still show up
    return mergeSameSubject(
      lessons.filter((l) => l.startMin < pe && l.endMin > ps),
    ).sort((a, b) => a.layoutGroup - b.layoutGroup);
  });

  const rows: Row[] = [];
  perPeriod.forEach((ls, i) => {
    const prev = rows[rows.length - 1];
    if (
      merge &&
      prev &&
      prev.to === i - 1 &&
      signature(prev.lessons) === signature(ls) &&
      ls.length > 0
    ) {
      prev.to = i;
    } else {
      rows.push({ from: i, to: i, lessons: ls });
    }
  });

  let a = 0;
  let b = rows.length - 1;
  while (a < rows.length && rows[a].lessons.length === 0) a++;
  while (b >= 0 && rows[b].lessons.length === 0) b--;
  return a > b ? [] : rows.slice(a, b + 1);
}

/** Lessons that fall outside every configured period (odd events, excursions). */
export function unslotted(lessons: Lesson[], periods: Period[]): Lesson[] {
  if (!periods.length) return lessons;
  return lessons.filter(
    (l) => !periods.some((p) => l.startMin < toMinutes(p.end) && l.endMin > toMinutes(p.start)),
  );
}


/* ------------------------------------------------------------------ */
/* Parallel groups, straight from Untis's own layout geometry           */
/* ------------------------------------------------------------------ */

/** How many groups the period is split into for this lesson (1 = whole class). */
export const columnCount = (l: Lesson): number =>
  Math.max(1, Math.round(1000 / (l.layoutWidth || 1000)));

/** Which group column this lesson sits in (0-based). */
export const columnOf = (l: Lesson): number =>
  Math.round((l.layoutStart || 0) / (l.layoutWidth || 1000));

export interface GroupBox {
  /** null = this group has a free period here. */
  lesson: Lesson | null;
  /** First group column this box covers (0-based) and how many it spans. */
  start: number;
  span: number;
}

export interface Split {
  /** Lessons the whole class attends — always full width. */
  full: Lesson[];
  /** Number of parallel group columns (0 when the period isn't split). */
  cols: number;
  /** One box per column run, already coalesced where groups share a lesson. */
  boxes: GroupBox[];
}

const sameLesson = (a: Lesson, b: Lesson) =>
  a.subject === b.subject &&
  a.status === b.status &&
  (a.groupLabel ?? '') === (b.groupLabel ?? '') &&
  a.startMin === b.startMin &&
  a.endMin === b.endMin;

/**
 * Rebuilds Untis's own column layout for a period. A group with nothing in this
 * period gets an empty box instead of inheriting the other group's lesson, and
 * neighbouring groups that share the same lesson (ŠVZ in two gyms) collapse
 * into one box spanning both columns.
 */
export function splitGroups(lessons: Lesson[], coalesce = true): Split {
  const full: Lesson[] = [];
  const grouped: Lesson[] = [];
  for (const l of lessons) (columnCount(l) === 1 ? full : grouped).push(l);
  if (!grouped.length) return { full, cols: 0, boxes: [] };

  const cols = Math.max(...grouped.map(columnCount));
  const unit = 1000 / cols;
  const slots: (Lesson | null)[] = Array.from({ length: cols }, () => null);

  for (const l of grouped) {
    const start = Math.min(cols - 1, Math.max(0, Math.round((l.layoutStart || 0) / unit)));
    const span = Math.max(1, Math.min(cols - start, Math.round((l.layoutWidth || unit) / unit)));
    for (let i = start; i < start + span; i++) if (!slots[i]) slots[i] = l;
  }

  const boxes: GroupBox[] = [];
  for (let i = 0; i < cols; i++) {
    const cur = slots[i];
    const prev = boxes[boxes.length - 1];
    const prevLesson = prev?.lesson ?? null;
    const mergeable =
      prev &&
      prev.start + prev.span === i &&
      ((cur === null && prevLesson === null) ||
        (cur !== null &&
          prevLesson !== null &&
          (cur === prevLesson || (coalesce && sameLesson(cur, prevLesson)))));

    if (mergeable && prev) {
      prev.span += 1;
      if (cur && prev.lesson && cur !== prev.lesson) {
        // same lesson taught to both groups in different rooms — keep both rooms
        const merged: Lesson = {
          ...prev.lesson,
          rooms: [...prev.lesson.rooms],
          teachers: [...prev.lesson.teachers],
        };
        for (const r of cur.rooms) if (!merged.rooms.includes(r)) merged.rooms.push(r);
        for (const t of cur.teachers) if (!merged.teachers.includes(t)) merged.teachers.push(t);
        prev.lesson = merged;
      }
    } else {
      boxes.push({ lesson: cur, start: i, span: 1 });
    }
  }

  return { full, cols, boxes };
}


/* ------------------------------------------------------------------ */
/* Day grid: rectangles spanning both periods and group columns         */
/* ------------------------------------------------------------------ */

export interface Block {
  /** null = free period for that group. */
  lesson: Lesson | null;
  /** First period index and how many periods tall. */
  p0: number;
  pSpan: number;
  /** First group column and how many columns wide. */
  c0: number;
  cSpan: number;
}

export interface DayGrid {
  first: number;
  last: number;
  cols: number;
  blocks: Block[];
  /** No lessons at all — first/last then cover the whole bell schedule. */
  empty: boolean;
}

/**
 * Two boxes merge when they show the same thing, not only when they are the
 * same Untis entry — a subject split into back-to-back entries (07:10–08:45 and
 * 08:50–09:35) then becomes one block.
 */
const keyOf = (l: Lesson | null, byContent: boolean) => {
  if (!l) return 'free';
  return byContent
    ? [
        l.subject,
        l.status,
        l.type,
        l.teachers.join(','),
        l.rooms.join(','),
        l.substitutionText,
        // a lesson taught to group 1 is not the same block as the one for group 2
        l.groupLabel ?? '',
      ].join('|')
    : l.id;
};

/**
 * Lays a day out as rectangles. A lesson running periods 3–5 in group 1 becomes
 * ONE tall block, even if group 2 only joins at period 4, and a lesson both
 * groups share becomes one block spanning the full width.
 */
export function buildDayGrid(
  lessons: Lesson[],
  periods: Period[],
  merge = true,
  /** Ignore Untis's group columns — used when a single group is selected. */
  flatten = false,
  /** Merge neighbouring boxes that show the same thing, not just the same entry. */
  byContent = true,
  /** false = always show the whole bell schedule, empty periods included. */
  trim = true,
): DayGrid {
  const perPeriod = periods.map((p) => {
    const ps = toMinutes(p.start);
    const pe = toMinutes(p.end);
    return mergeSameSubject(lessons.filter((l) => l.startMin < pe && l.endMin > ps));
  });

  let first = 0;
  let last = periods.length - 1;
  if (trim) {
    while (first <= last && perPeriod[first].length === 0) first++;
    while (last >= first && perPeriod[last].length === 0) last--;
  }
  // nothing today: keep the full bell schedule so the day still has a scale
  if (first > last) {
    return { first: 0, last: periods.length - 1, cols: 1, blocks: [], empty: true };
  }

  const splits = perPeriod.map((ls) => splitGroups(ls, false));
  const cols = flatten
    ? Math.max(1, ...perPeriod.map((ls) => ls.length))
    : Math.max(1, ...splits.map((sp) => sp.cols || sp.full.length || 1));

  // one cell per period per group column
  const grid: (Lesson | null)[][] = periods.map((_, pi) => {
    const sp = splits[pi];
    const row: (Lesson | null)[] = Array.from({ length: cols }, () => null);

    if (flatten) {
      // one group selected: whatever is left simply shares the full width
      const ls = perPeriod[pi];
      if (ls.length) {
        const per = cols / ls.length;
        ls.forEach((l, i) => {
          const from = Math.round(i * per);
          const to = i === ls.length - 1 ? cols : Math.round((i + 1) * per);
          for (let c = from; c < to; c++) row[c] = l;
        });
      }
      return row;
    }

    if (sp.cols > 0) {
      const scale = cols / sp.cols;
      for (const b of sp.boxes) {
        const from = Math.round(b.start * scale);
        const to = Math.round((b.start + b.span) * scale);
        for (let c = from; c < to && c < cols; c++) row[c] = b.lesson;
      }
      // a lesson the whole class shares sits behind the split ones
      for (const f of sp.full) for (let c = 0; c < cols; c++) if (!row[c]) row[c] = f;
    } else if (sp.full.length === 1) {
      row.fill(sp.full[0]);
    } else if (sp.full.length > 1) {
      const per = Math.max(1, Math.floor(cols / sp.full.length));
      sp.full.forEach((l, i) => {
        for (let c = i * per; c < (i === sp.full.length - 1 ? cols : (i + 1) * per); c++) row[c] = l;
      });
    }
    return row;
  });

  const used = periods.map(() => Array.from({ length: cols }, () => false));
  const blocks: Block[] = [];

  for (let p = first; p <= last; p++) {
    for (let c = 0; c < cols; c++) {
      if (used[p][c]) continue;
      const key = keyOf(grid[p][c], byContent);

      let cSpan = 1;
      while (c + cSpan < cols && !used[p][c + cSpan] && keyOf(grid[p][c + cSpan], byContent) === key)
        cSpan++;

      let pSpan = 1;
      outer: while (merge && p + pSpan <= last) {
        for (let i = 0; i < cSpan; i++) {
          if (used[p + pSpan][c + i] || keyOf(grid[p + pSpan][c + i], byContent) !== key) break outer;
        }
        pSpan++;
      }

      for (let i = 0; i < pSpan; i++) for (let j = 0; j < cSpan; j++) used[p + i][c + j] = true;
      blocks.push({ lesson: grid[p][c], p0: p, pSpan, c0: c, cSpan });
    }
  }

  return { first, last, cols, blocks, empty: false };
}


/**
 * Keeps only what group `n` attends (1 or 2); 0 keeps everything. Lessons the
 * whole class shares always stay. A middle column in a three-way split overlaps
 * both halves, so it shows for either group.
 */
export function filterGroup(lessons: Lesson[], group: number): Lesson[] {
  if (!group) return lessons;
  return lessons.filter((l) => {
    // Untis prints the real groups on the lesson ("1sk", or "1sk, 2sk" when both
    // attend) where it bothers to; the layout column only says where it was drawn
    if (l.groupNos.length) return l.groupNos.includes(group);
    if (!groupSplit(l, lessons)) return true;
    const w = l.layoutWidth || 1000;
    if (w >= 1000) return true;
    const start = l.layoutStart || 0;
    return group === 1 ? start < 500 : start + w > 500;
  });
}

/**
 * Whether a half-width lesson is half-width because the class is genuinely
 * split, or only because it shares the period with something else. Not every
 * school tags its groups with a label ("1sk", a PE code) the way sc-celje
 * does, so this no longer requires one — instead it looks at what else is
 * actually happening at the exact same time: two or more real lessons at
 * once means real, independent groups meeting in parallel.
 *
 * "Real" excludes EVENT-type entries specifically, because a substitution is
 * drawn the same way a group split is — the cancelled original in one column,
 * a one-off EVENT announcing the replacement in the other — and that pair
 * would otherwise look identical to two groups each having their own class.
 * A cancelled entry still counts on its own (one group's class being
 * cancelled while the other group meets as usual is a real split too).
 */
const groupSplit = (l: Lesson, siblings: Lesson[]): boolean => {
  if (l.type === 'EVENT') return false;
  const concurrent = siblings.filter(
    (o) => o.type !== 'EVENT' && o.startMin === l.startMin && o.endMin === l.endMin,
  );
  return concurrent.length > 1;
};

/** True when any lesson in the set belongs to a parallel group. */
export const hasGroups = (lessons: Lesson[]): boolean =>
  lessons.some(
    (l) => l.groupNos.length > 0 || (groupSplit(l, lessons) && (l.layoutWidth || 1000) < 1000),
  );
