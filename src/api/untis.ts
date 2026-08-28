import {
  ClassEntry,
  FilterResponse,
  GridEntry,
  Lesson,
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
  }) {
    return this.request<TimetableResponse>('/WebUntis/api/rest/view/v1/timetable/entries', {
      start: opts.start,
      end: opts.end,
      format: 5,
      resourceType: opts.resourceType ?? 'CLASS',
      resources: opts.resourceId,
      periodTypes: '',
      timetableType: 'STANDARD',
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
}

export class UntisError extends Error {
  constructor(public status: number, public body: string, public url: string) {
    super(`Untis ${status}: ${body.slice(0, 200)}`);
  }
}

/* ------------------------------------------------------------------ */
/* Normalising raw entries into something the UI can render            */
/* ------------------------------------------------------------------ */

const names = (positions: Position[] | null, long = false): string[] =>
  (positions ?? [])
    .map((p) => {
      const r = p.current ?? p.removed;
      if (!r) return '';
      return long ? r.longName || r.displayName || r.shortName : r.displayName || r.shortName;
    })
    .filter(Boolean);

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const fromMinutes = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** "1sk", "sk 2", "Gruppe 3" … whatever the school prints as the group tag. */
function parseGroup(text: string): number | null {
  const m = /(\d+)\s*sk|sk\s*(\d+)|gr(?:oup|upa|uppe)?\.?\s*(\d+)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1] ?? m[2] ?? m[3]);
  return Number.isFinite(n) ? n : null;
}

export function toLesson(entry: GridEntry): Lesson {
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
    teachers: names(entry.position1),
    rooms: names(entry.position3),
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
    groupNo: groupLabel ? parseGroup(groupLabel) : null,
  };
}
