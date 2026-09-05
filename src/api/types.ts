/**
 * Shapes returned by the WebUntis "view" REST API (the one the web client uses).
 * Captured from a live response of sc-celje.webuntis.com, format 5.
 */

export type EntryStatus =
  | 'REGULAR'
  | 'CANCELLED'
  | 'CHANGED'
  | 'ADDED'
  | 'SUBSTITUTION'
  | string;

export type EntryType =
  | 'NORMAL_TEACHING_PERIOD'
  | 'EVENT'
  | 'EXAM'
  | 'STAND_BY'
  | 'OFFICE_HOUR'
  | 'BREAK_SUPERVISION'
  | string;

/** One teacher / subject / room / info chip inside an entry. */
export interface Resource {
  type: 'TEACHER' | 'SUBJECT' | 'ROOM' | 'CLASS' | 'INFO' | string;
  status: EntryStatus;
  shortName: string;
  longName: string;
  displayName: string;
  displayNameLabel: string | null;
}

/** Positions hold {current, removed} so substitutions show old + new. */
export interface Position {
  current: Resource | null;
  removed: Resource | null;
}

export interface GridEntry {
  ids: number[];
  duration: { start: string; end: string }; // "2026-09-01T07:10"
  type: EntryType;
  status: EntryStatus;
  statusDetail: string | null;
  name: string | null;
  /** Horizontal layout hints for overlapping lessons (0..1000). */
  layoutStartPosition: number;
  layoutWidth: number;
  layoutGroup: number;
  /** Untis subject colour, hex without '#'. */
  color: string | null;
  notesAll: string;
  icons: string[];
  position1: Position[] | null; // teachers
  position2: Position[] | null; // subjects
  position3: Position[] | null; // rooms
  position4: Position[] | null; // info / substitution text
  position5: Position[] | null;
  position6: Position[] | null;
  position7: Position[] | null;
  texts: string[];
  lessonText: string | null;
  lessonInfo: string | null;
  substitutionText: string | null;
  userName: string | null;
  moved: unknown;
  durationTotal: unknown;
  link: string | null;
}

export interface TimetableDay {
  date: string; // YYYY-MM-DD
  resourceType: string;
  resource: { id: number; shortName: string; longName: string; displayName: string };
  status: EntryStatus;
  /** All-day items (holidays, notes). */
  dayEntries: GridEntry[];
  gridEntries: GridEntry[];
}

export interface TimetableResponse {
  format: number;
  days: TimetableDay[];
}

export interface Department {
  id: number;
  shortName: string;
  longName: string;
  displayName: string;
}

export interface ClassEntry {
  class: { id: number; shortName: string; longName: string; displayName: string };
  classTeacher1: { id: number; displayName: string } | null;
  classTeacher2: { id: number; displayName: string } | null;
  department: Department | null;
}

export interface FilterResponse {
  resourceType: string;
  departments: Department[];
  classes: ClassEntry[];
  rooms: unknown[];
  subjects: unknown[];
  teachers: unknown[];
}

/** Flattened lesson the UI actually renders. */
export interface Lesson {
  id: string;
  start: string; // "07:10"
  end: string; // "08:45"
  startMin: number;
  endMin: number;
  subject: string;
  subjectLong: string;
  teachers: string[];
  /**
   * Per teacher, whether Untis struck the name out — the teacher is away and
   * nobody replaced them. Same order as `teachers`.
   */
  teachersStruck: boolean[];
  rooms: string[];
  roomsStruck: boolean[];
  info: string[];
  substitutionText: string;
  status: EntryStatus;
  type: EntryType;
  cancelled: boolean;
  changed: boolean;
  exam: boolean;
  color: string | null;
  layoutGroup: number;
  /** Untis layout geometry: 0..1000 across the period's width. */
  layoutStart: number;
  layoutWidth: number;
  /** Group label Untis prints on the lesson, e.g. "1sk". */
  groupLabel: string | null;
  /** Every group number in that label — "1sk, 2sk" means both groups attend. */
  groupNos: number[];
}

/* ------------------------------------------------------------------ */
/* Things a signed-in account can see beyond the timetable             */
/* ------------------------------------------------------------------ */

export interface HomeworkItem {
  id: number;
  /** ISO date the homework was set. */
  date: string;
  /** ISO date it is due. */
  dueDate: string;
  subject: string;
  text: string;
  remark: string;
  completed: boolean;
}

export interface ExamItem {
  id: number;
  /** ISO date. */
  date: string;
  start: string; // "08:00"
  end: string; // "09:35"
  subject: string;
  name: string;
  examType: string;
  teachers: string[];
  rooms: string[];
  text: string;
  grade: string | null;
}

export interface AbsenceItem {
  id: number;
  /** ISO date. */
  start: string;
  end: string;
  startTime: string; // "08:00"
  endTime: string;
  reason: string;
  text: string;
  excused: boolean;
  excuseStatus: string;
}

export interface MessageItem {
  id: number;
  subject: string;
  preview: string;
  sender: string;
  /** ISO-ish timestamp string as WebUntis returns it. */
  sentAt: string;
  read: boolean;
}
