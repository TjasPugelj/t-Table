import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AbsenceItem, ExamItem, HomeworkItem, MessageItem } from '../api/types';
import { UntisClient } from '../api/untis';
import { schoolYearRange } from '../lib/date';
import { LinkedAccount } from './account';

/**
 * Homework, exams, absences and messages, held for the whole session.
 *
 * The School screen lives inside a Modal, so its own state is thrown away every
 * time it closes — keeping the data here instead means the screen opens
 * instantly on every visit after the first, and lets the app warm the lists in
 * the background at launch.
 */

export type SchoolTab = 'homework' | 'exams' | 'absences' | 'messages';

export interface SchoolData {
  homework: HomeworkItem[] | null;
  exams: ExamItem[] | null;
  absences: AbsenceItem[] | null;
  messages: MessageItem[] | null;
}

const EMPTY: SchoolData = { homework: null, exams: null, absences: null, messages: null };
const NONE: Record<SchoolTab, boolean> = {
  homework: false,
  exams: false,
  absences: false,
  messages: false,
};

/** How long a fetched list is considered current. */
const FRESH_MS = 10 * 60 * 1000;

interface Ctx {
  data: SchoolData;
  loading: Record<SchoolTab, boolean>;
  errors: Record<SchoolTab, string | null>;
  /**
   * Fetches one list unless a fresh copy is already held. Returns what it has,
   * typed to the tab asked for.
   */
  load: <T extends SchoolTab>(
    tab: T,
    client: UntisClient,
    account: LinkedAccount,
    force?: boolean,
  ) => Promise<SchoolData[T]>;
  /** Warms every list in the background. */
  loadAll: (client: UntisClient, account: LinkedAccount) => Promise<void>;
  /** Drops everything — used when the account changes. */
  clear: () => void;
}

const SchoolDataContext = createContext<Ctx | null>(null);

export function SchoolDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<SchoolData>(EMPTY);
  const [loading, setLoading] = useState<Record<SchoolTab, boolean>>(NONE);
  const [errors, setErrors] = useState<Record<SchoolTab, string | null>>({
    homework: null,
    exams: null,
    absences: null,
    messages: null,
  });

  const fetchedAt = useRef<Partial<Record<SchoolTab, number>>>({});
  // one in-flight request per tab, so a preload and an open don't both fetch
  const inflight = useRef<Partial<Record<SchoolTab, Promise<any>>>>({});
  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(
    async <T extends SchoolTab>(
      tab: T,
      client: UntisClient,
      account: LinkedAccount,
      force = false,
    ): Promise<SchoolData[T]> => {
      const fresh =
        !force &&
        dataRef.current[tab] !== null &&
        Date.now() - (fetchedAt.current[tab] ?? 0) < FRESH_MS;
      if (fresh) return dataRef.current[tab] as SchoolData[T];

      const running = inflight.current[tab];
      if (running && !force) return running as Promise<SchoolData[T]>;

      const run = (async () => {
        setLoading((l) => ({ ...l, [tab]: true }));
        setErrors((e) => ({ ...e, [tab]: null }));
        try {
          const { start, end } = schoolYearRange();
          let result: any;
          if (tab === 'homework') {
            result = await client.homework(start, end);
            result.sort((a: HomeworkItem, b: HomeworkItem) => a.dueDate.localeCompare(b.dueDate));
          } else if (tab === 'exams') {
            result = await client.exams(start, end, account.klasseId ?? -1);
            result.sort(
              (a: ExamItem, b: ExamItem) =>
                a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
            );
          } else if (tab === 'absences') {
            result = await client.absences(start, end, account.studentId ?? account.personId);
            result.sort((a: AbsenceItem, b: AbsenceItem) => b.start.localeCompare(a.start));
          } else {
            result = await client.messages();
            result.sort((a: MessageItem, b: MessageItem) => b.sentAt.localeCompare(a.sentAt));
          }
          fetchedAt.current[tab] = Date.now();
          setData((d) => ({ ...d, [tab]: result }));
          return result;
        } catch (e: any) {
          setErrors((er) => ({ ...er, [tab]: e?.message ?? 'Error' }));
          return dataRef.current[tab] as SchoolData[T];
        } finally {
          setLoading((l) => ({ ...l, [tab]: false }));
          delete inflight.current[tab];
        }
      })();

      inflight.current[tab] = run;
      return run as Promise<SchoolData[T]>;
    },
    [],
  );

  const loadAll = useCallback(
    async (client: UntisClient, account: LinkedAccount) => {
      // exams first: the timetable wants them for its reminders
      await load('exams', client, account);
      await Promise.all([
        load('homework', client, account),
        load('absences', client, account),
        load('messages', client, account),
      ]);
    },
    [load],
  );

  const clear = useCallback(() => {
    fetchedAt.current = {};
    inflight.current = {};
    setData(EMPTY);
    setErrors({ homework: null, exams: null, absences: null, messages: null });
  }, []);

  return (
    <SchoolDataContext.Provider value={{ data, loading, errors, load, loadAll, clear }}>
      {children}
    </SchoolDataContext.Provider>
  );
}

export function useSchoolData(): Ctx {
  const ctx = useContext(SchoolDataContext);
  if (!ctx) throw new Error('useSchoolData must be used inside <SchoolDataProvider>');
  return ctx;
}
