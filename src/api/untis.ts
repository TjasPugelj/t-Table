import {
  AbsenceItem,
  ClassEntry,
  ExamItem,
  FilterResponse,
  GridEntry,
  HomeworkItem,
  Lesson,
  MessageItem,
  Position,
  TimetableResponse,
} from './types';

/**
 * Auth is pluggable: today everything runs through AnonymousAuth (public class
 * timetables, no login). When the username/password flow lands, drop in a
 * SessionAuth that returns cookies / a bearer token from the same interface and
 * nothing else in the app has to change.
 */
export interface UntisAuth {
  /** Extra headers for every request. */
  headers(): Promise<Record<string, string>> | Record<string, string>;
  /** Called once before the first request (login, token refresh, ...). */
  prepare?(): Promise<void>;
  readonly kind: 'anonymous' | 'session';
}

export class AnonymousAuth implements UntisAuth {
  readonly kind = 'anonymous';
  constructor(private school: string) {}
  headers() {
    return { 'Anonymous-School': this.school };
  }
}

export interface UntisConfig {
  /** Host without protocol, e.g. "sc-celje.webuntis.com". */
  host: string;
  /** Untis school key, e.g. "sc-celje". */
  school: string;
}

export class UntisClient {
  constructor(private config: UntisConfig, private auth: UntisAuth) {}

  private get base() {
    return `https://${this.config.host}`;
  }

  private async request<T>(path: string, params: Record<string, string | number>): Promise<T> {
    if (this.auth.prepare) await this.auth.prepare();
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.base}${path}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...(await this.auth.headers()) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new UntisError(res.status, body || res.statusText, url);
    }
    return (await res.json()) as T;
  }

  /** Timetable for a resource between two YYYY-MM-DD dates (inclusive). */
  timetable(opts: {
    start: string;
    end: string;
    resourceId: number;
    resourceType?: 'CLASS' | 'TEACHER' | 'ROOM' | 'STUDENT';
    /** STANDARD for a public/class timetable, MY_TIMETABLE for the signed-in user's own. */
    timetableType?: 'STANDARD' | 'MY_TIMETABLE';
  }) {
    return this.request<TimetableResponse>('/WebUntis/api/rest/view/v1/timetable/entries', {
      start: opts.start,
      end: opts.end,
      format: 5,
      resourceType: opts.resourceType ?? 'CLASS',
      resources: opts.resourceId,
      periodTypes: '',
      timetableType: opts.timetableType ?? 'STANDARD',
      layout: 'START_TIME',
    });
  }

  /** Every class in the school, with its department — used by the class picker. */
  async classes(): Promise<ClassEntry[]> {
    const data = await this.request<FilterResponse>(
      '/WebUntis/api/rest/view/v1/timetable/filter',
      { resourceType: 'CLASS', timetableType: 'STANDARD' },
    );
    return data.classes ?? [];
  }

  /* ---------------------------------------------------------------- */
  /* Signed-in extras. These endpoints all reject anonymous access.    */
  /* They also speak Untis's own yyyyMMdd date format, not ISO.        */
  /* ---------------------------------------------------------------- */

  /**
   * Homework between two YYYY-MM-DD dates.
   *
   * Fetched one month at a time: the WebUntis web client does the same, and a
   * year-wide range comes back empty even when the month-wide ones don't.
   */
  async homework(start: string, end: string): Promise<HomeworkItem[]> {
    const chunks = monthChunks(start, end);
    // one request first, so the session is established once rather than by
    // every parallel call at the same time
    const [head, ...rest] = chunks;
    const first = await this.homeworkChunk(head.start, head.end);
    const others = await Promise.all(rest.map((c) => this.homeworkChunk(c.start, c.end)));

    const seen = new Set<string>();
    return [first, ...others].flat().filter((h) => {
      const k = `${h.id}-${h.dueDate}-${h.text}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  private async homeworkChunk(start: string, end: string): Promise<HomeworkItem[]> {
    const data = await this.request<any>('/WebUntis/api/homeworks/lessons', {
      startDate: untisDate(start),
      endDate: untisDate(end),
    });
    // Tolerant on purpose: this runs once per month, and one odd month must
    // not take down the whole list.
    const lessons: any[] = data?.data?.lessons ?? [];
    const subjectFor = (lessonId: number): string =>
      lessons.find((l) => l.id === lessonId)?.subject ?? '';
    return (data?.data?.homeworks ?? []).map(
      (h: any): HomeworkItem => ({
        id: h.id,
        date: isoDate(h.date),
        dueDate: isoDate(h.dueDate),
        subject: subjectFor(h.lessonId),
        text: h.text ?? '',
        remark: h.remark ?? '',
        completed: !!h.completed,
      }),
    );
  }

  /** Exams between two YYYY-MM-DD dates. */
  async exams(start: string, end: string, klasseId = -1): Promise<ExamItem[]> {
    const data = await this.request<any>('/WebUntis/api/exams', {
      startDate: untisDate(start),
      endDate: untisDate(end),
      klasseId,
      withGrades: 'true',
    });
    return (data?.data?.exams ?? []).map(
      (e: any): ExamItem => ({
        id: e.id,
        date: isoDate(e.examDate),
        start: hhmm(e.startTime),
        end: hhmm(e.endTime),
        subject: e.subject ?? '',
        name: e.name ?? '',
        examType: e.examType ?? '',
        teachers: e.teachers ?? [],
        rooms: e.rooms ?? [],
        text: e.text ?? '',
        grade: e.grade ?? null,
      }),
    );
  }

  /** Absence records for one student between two YYYY-MM-DD dates. */
  async absences(start: string, end: string, studentId: number): Promise<AbsenceItem[]> {
    const data = await this.request<any>('/WebUntis/api/classreg/absences/students', {
      startDate: untisDate(start),
      endDate: untisDate(end),
      studentId,
      excuseStatusId: -1,
    });
    return (data?.data?.absences ?? []).map(
      (a: any): AbsenceItem => ({
        id: a.id,
        start: isoDate(a.startDate),
        end: isoDate(a.endDate),
        startTime: hhmm(a.startTime),
        endTime: hhmm(a.endTime),
        reason: a.reason ?? '',
        text: a.text ?? '',
        excused: !!a.isExcused,
        excuseStatus: a.excuseStatus ?? '',
      }),
    );
  }

  /** WebUntis inbox. */
  async messages(): Promise<MessageItem[]> {
    const data = await this.request<any>('/WebUntis/api/rest/view/v1/messages', {});
    const list: any[] = data?.incomingMessages ?? data?.data?.incomingMessages ?? [];
    return list.map(
      (m: any): MessageItem => ({
        id: m.id,
        subject: m.subject ?? '',
        preview: m.contentPreview ?? '',
        sender: m.sender?.displayName ?? '',
        sentAt: m.sentDateTime ?? '',
        read: !!m.isMessageRead,
      }),
    );
  }
}

/** Splits an ISO date range into calendar-month pieces. */
function monthChunks(start: string, end: string): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  const [sy, sm] = start.split('-').map(Number);
  const last = new Date(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, 1);
  const cur = new Date(sy, sm - 1, 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  while (cur <= last) {
    const y = cur.getFullYear();
    const m = cur.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    out.push({
      start: `${y}-${pad(m + 1)}-01`,
      end: `${y}-${pad(m + 1)}-${pad(lastDay)}`,
    });
    cur.setMonth(m + 1);
  }
  return out.length ? out : [{ start, end }];
}

/** "2026-09-04" -> 20260904, the format the older Untis endpoints want. */
const untisDate = (iso: string): number => Number(iso.replace(/-/g, ''));

/** 20260904 (or "20260904") -> "2026-09-04". */
const isoDate = (v: number | string | null | undefined): string => {
  const s = String(v ?? '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
};

/** Untis times are Hmm/HHmm integers: 830 -> "08:30". */
const hhmm = (v: number | null | undefined): string => {
  const s = String(v ?? '').padStart(4, '0');
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
};

export class UntisError extends Error {
  constructor(public status: number, public body: string, public url: string) {
    super(`Untis ${status}: ${body.slice(0, 200)}`);
  }
}

/* ------------------------------------------------------------------ */
/* Normalising raw entries into something the UI can render            */
/* ------------------------------------------------------------------ */

/**
 * A position holds {current, removed}. When `current` is missing the resource
 * was taken away and not replaced — Untis draws that name struck through — and
 * a resource can also carry REMOVED as its own status.
 */
const namesWithState = (
  positions: Position[] | null,
  long = false,
): { name: string; struck: boolean }[] =>
  (positions ?? [])
    .map((p) => {
      const r = p.current ?? p.removed;
      if (!r) return { name: '', struck: false };
      const name = long ? r.longName || r.displayName || r.shortName : r.displayName || r.shortName;
      return { name, struck: !p.current || r.status === 'REMOVED' };
    })
    .filter((x) => !!x.name);

const names = (positions: Position[] | null, long = false): string[] =>
  namesWithState(positions, long).map((x) => x.name);

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const fromMinutes = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Group tags Untis prints on a lesson: "1sk", "sk 2", "Gruppe 3" — and often
 * several at once ("1sk, 2sk"), meaning every one of those groups attends.
 */
function parseGroups(text: string): number[] {
  const out: number[] = [];
  const re = /(\d+)\s*sk|sk\s*(\d+)|gr(?:oup|upa|uppe)?\.?\s*(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = Number(m[1] ?? m[2] ?? m[3]);
    if (Number.isFinite(n) && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

export function toLesson(entry: GridEntry): Lesson {
  const teachers = namesWithState(entry.position1);
  const rooms = namesWithState(entry.position3);
  const start = entry.duration.start.slice(11, 16);
  const end = entry.duration.end.slice(11, 16);
  const subjects = names(entry.position2);
  const groupLabel = (entry.lessonInfo ?? names(entry.position4)[0] ?? '').trim() || null;
  return {
    id: entry.ids.join('-') + entry.duration.start,
    start,
    end,
    startMin: toMinutes(start),
    endMin: toMinutes(end),
    subject: subjects[0] ?? entry.name ?? '—',
    subjectLong: names(entry.position2, true)[0] ?? '',
    teachers: teachers.map((x) => x.name),
    teachersStruck: teachers.map((x) => x.struck),
    rooms: rooms.map((x) => x.name),
    roomsStruck: rooms.map((x) => x.struck),
    info: names(entry.position4),
    substitutionText: entry.substitutionText ?? '',
    status: entry.status,
    type: entry.type,
    cancelled: entry.status === 'CANCELLED',
    changed: entry.status === 'CHANGED' || entry.status === 'SUBSTITUTION',
    exam: entry.type === 'EXAM',
    color: entry.color ? `#${entry.color}` : null,
    layoutGroup: entry.layoutGroup,
    layoutStart: entry.layoutStartPosition ?? 0,
    layoutWidth: entry.layoutWidth || 1000,
    groupLabel,
    groupNos: groupLabel ? parseGroups(groupLabel) : [],
  };
}
