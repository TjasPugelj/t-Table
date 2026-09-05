import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Dimensions,
  Easing,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { Lesson, TimetableDay } from '../api/types';
import { PasswordAuth } from '../api/passwordAuth';
import { resourceTypeForPerson, SessionAuth } from '../api/qrAuth';
import { AnonymousAuth, toLesson, toMinutes, UntisClient, UntisAuth } from '../api/untis';
import DatePicker from '../components/DatePicker';
import LessonCard from '../components/LessonCard';
import LessonSheet from '../components/LessonSheet';
import StickyNote from '../components/StickyNote';
import { cardSkin, pickTextColor } from '../lib/colors';
import { fieldText } from '../lib/display';
import {
  addDays,
  dayShort,
  formatDate,
  formatDayLabel,
  iso,
  isSameDay,
  nowMinutes,
  skipWeekend,
  startOfWeek,
} from '../lib/date';
import {
  buildDayGrid,
  filterGroup,
  hasGroups,
  mergeSameSubject,
  splitGroups,
} from '../lib/layout';
import { syncExamReminders } from '../lib/examReminders';
import { findReminder, kindIcon } from '../lib/reminders';
import { useAccount } from '../store/account';
import { useSchoolData } from '../store/schoolData';
import { subjectFlagList, useSettings } from '../store/settings';
import { Theme } from '../theme';

type WeekCache = Record<string, TimetableDay[]>;

const SCREEN_W = Dimensions.get('window').width;
/** How far a page slides out of the way — a short hop reads better than a full screen. */
const SLIDE = Math.min(140, SCREEN_W * 0.32);
const PERIOD_H = 92;
/**
 * How long a second tap still counts as a double-tap. The lesson sheet waits
 * exactly this long before opening, so a double-tap never flashes it open.
 */
const DOUBLE_TAP_MS = 280;

const keyFor = (l: Lesson | null) => l?.id ?? 'free';

/**
 * Position of the current time inside a period range, 0..1, or null when the
 * school day hasn't started / is over. Breaks map to the boundary between them.
 */
function nowFraction(periods: { start: string; end: string }[], first: number, last: number) {
  const n = nowMinutes();
  const total = last - first + 1;
  if (total <= 0) return null;
  for (let p = first; p <= last; p++) {
    const ps = toMinutes(periods[p].start);
    const pe = toMinutes(periods[p].end);
    if (n < ps) return p === first ? null : (p - first) / total;
    if (n <= pe) return (p - first + (n - ps) / Math.max(1, pe - ps)) / total;
  }
  return null;
}

/**
 * A three-page carousel: the previous, current and next page are all mounted
 * side by side, so a swipe drags real content into view instead of sliding the
 * same page out and back in.
 */
function useCarousel(
  stepPrimary: (dir: 1 | -1) => void,
  stepAlt: (dir: 1 | -1) => void,
  mode: 'slide' | 'fade' | 'none',
  onDoublePrimary: () => void,
  onDoubleAlt: () => void,
  onPullDown: () => void,
  allowPull: boolean,
  /** Called as soon as a drag starts, so a pending tap action can be dropped. */
  onDragStart: () => void,
  /**
   * Whether this gesture drags the day strip along with the finger — only the
   * strip's own drag does. A swipe on the timetable leaves the strip in place
   * until release, when stripStep decides whether it slides along.
   */
  stripLive: (which: 'primary' | 'alt') => boolean,
  /**
   * Whether the step this gesture is about to commit changes the week, so the
   * strip slides out and back in together with the timetable.
   */
  stripStep: (which: 'primary' | 'alt', dir: 1 | -1) => boolean,
) {
  const tx = useRef(new Animated.Value(0)).current;
  /** The day strip slides too, but only when the gesture changes the week. */
  const stripTx = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const busy = useRef(false);

  const primary = useRef(stepPrimary);
  const alt = useRef(stepAlt);
  const dblPrimary = useRef(onDoublePrimary);
  const dblAlt = useRef(onDoubleAlt);
  const pull = useRef(onPullDown);
  const pullOk = useRef(allowPull);
  primary.current = stepPrimary;
  alt.current = stepAlt;
  dblPrimary.current = onDoublePrimary;
  dblAlt.current = onDoubleAlt;
  pull.current = onPullDown;
  pullOk.current = allowPull;
  const dragStart = useRef(onDragStart);
  dragStart.current = onDragStart;
  const stripAll = useRef(stripLive);
  stripAll.current = stripLive;
  const stripNext = useRef(stripStep);
  stripNext.current = stripStep;
  /** Set when a commit already slid the strip, so the week-change effect skips it. */
  const stripHandled = useRef(false);

  type Tap = { t: number; x: number; y: number };
  const lastTap = useRef<{ primary: Tap; alt: Tap }>({
    primary: { t: 0, x: 0, y: 0 },
    alt: { t: 0, x: 0, y: 0 },
  });
  const moved = useRef(false);

  /** A double-tap is two quick taps in the same place — not two fingers at once. */
  const tapStart = (which: 'primary' | 'alt', e: GestureResponderEvent) => {
    const reset = () => {
      lastTap.current[which] = { t: 0, x: 0, y: 0 };
      moved.current = false;
    };
    // more than one finger down: that's a pinch or a two-finger tap, not a double-tap
    if ((e.nativeEvent.touches?.length ?? 1) > 1) return reset();

    const { pageX, pageY } = e.nativeEvent;
    const prev = lastTap.current[which];
    const now = Date.now();
    const near = Math.abs(pageX - prev.x) < 44 && Math.abs(pageY - prev.y) < 44;

    if (!moved.current && prev.t && now - prev.t < DOUBLE_TAP_MS && near) {
      reset();
      (which === 'primary' ? dblPrimary : dblAlt).current();
      return;
    }
    lastTap.current[which] = { t: now, x: pageX, y: pageY };
    moved.current = false;
  };

  const modeRef = useRef(mode);
  modeRef.current = mode;

  const settle = () => {
    Animated.spring(tx, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    Animated.spring(stripTx, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
  };

  /**
   * Kept in a ref, not a useCallback: the PanResponders are created once, so a
   * captured callback would freeze whichever animation mode was set at mount.
   */
  const runId = useRef(0);
  /**
   * `step()` only re-renders on React's next commit, while Animated values move
   * immediately. Springing the page back in right after calling it therefore
   * animates the *old* content for a frame — visible as the previous day
   * flashing past on fast swipes. So the incoming animation is parked here and
   * started from a layout effect, once the new content is on screen.
   */
  const afterRender = useRef<(() => void) | null>(null);
  const [renderGen, setRenderGen] = useState(0);
  useLayoutEffect(() => {
    const run = afterRender.current;
    if (!run) return;
    afterRender.current = null;
    run();
  }, [renderGen]);
  const commitRef = useRef<(dir: 1 | -1, step: (d: 1 | -1) => void, withStrip?: boolean) => void>(
    () => {},
  );
  commitRef.current = (dir, step, withStrip = false) => {
    // a new swipe interrupts whatever is still running instead of being ignored
    tx.stopAnimation();
    stripTx.stopAnimation();
    fade.stopAnimation();
    const id = ++runId.current;
    const m = modeRef.current;

    if (m === 'none') {
      tx.setValue(0);
      stripTx.setValue(0);
      fade.setValue(1);
      step(dir);
      return;
    }

    if (m === 'fade') {
      busy.current = true;
      tx.setValue(0);
      stripTx.setValue(0);
      Animated.timing(fade, {
        toValue: 0,
        duration: 90,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (id !== runId.current) return;
        if (!finished) {
          fade.setValue(1);
          busy.current = false;
          return;
        }
        step(dir);
        afterRender.current = () => {
          Animated.timing(fade, {
            toValue: 1,
            duration: 130,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start(() => {
            if (id === runId.current) busy.current = false;
          });
        };
        setRenderGen((g) => g + 1);
      });
      return;
    }

    // slide: a full screen out, swap, spring the new one in
    busy.current = true;
    if (withStrip) stripHandled.current = true;
    const targets = withStrip ? [tx, stripTx] : [tx];
    Animated.parallel(
      targets.map((v) =>
        Animated.timing(v, {
          toValue: -dir * SCREEN_W,
          duration: 130,
          useNativeDriver: true,
        }),
      ),
    ).start(({ finished }) => {
      if (id !== runId.current) return;
      if (!finished) {
        targets.forEach((v) => v.setValue(0));
        busy.current = false;
        return;
      }
      step(dir);
      targets.forEach((v) => v.setValue(dir * SCREEN_W));
      afterRender.current = () => {
        if (id !== runId.current) return;
        Animated.parallel(
          targets.map((v) =>
            Animated.spring(v, { toValue: 0, useNativeDriver: true, bounciness: 3, speed: 18 }),
          ),
        ).start(() => {
          if (id === runId.current) busy.current = false;
        });
      };
      setRenderGen((g) => g + 1);
    });
  };

  const go = useCallback(
    (dir: 1 | -1) => commitRef.current(dir, primary.current, stripNext.current('primary', dir)),
    [],
  );
  const goAlt = useCallback((dir: 1 | -1) => commitRef.current(dir, alt.current, true), []);

  /**
   * Slide the strip in on its own — used when the week changed without the
   * gesture knowing it would (a day swipe crossing Fri → Mon, the calendar,
   * the jump to today).
   */
  const bumpStrip = useCallback(
    (dir: 1 | -1) => {
      if (modeRef.current !== 'slide') return;
      stripTx.stopAnimation();
      stripTx.setValue(dir * SCREEN_W);
      Animated.spring(stripTx, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 3,
        speed: 18,
      }).start();
    },
    [stripTx],
  );

  const horizontal = (g: { dx: number; dy: number }) =>
    Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4;
  const pullingDown = (g: { dx: number; dy: number }) =>
    g.dy > 24 && g.dy > Math.abs(g.dx) * 1.6;

  const makeDrag = (which: 'primary' | 'alt', capture: boolean) =>
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (e) => {
        tapStart(which, e);
        return false;
      },
      ...(capture ? { onMoveShouldSetPanResponderCapture: (_: any, g: any) => horizontal(g) } : {}),
      onMoveShouldSetPanResponder: (_, g) =>
        horizontal(g) || (which === 'primary' && pullOk.current && pullingDown(g)),
      onPanResponderGrant: () => {
        tx.stopAnimation();
        stripTx.stopAnimation();
        fade.stopAnimation();
        fade.setValue(1);
      },
      onPanResponderMove: (_, g) => {
        if (!moved.current) dragStart.current();
        moved.current = true;
        if (modeRef.current === 'slide') {
          tx.setValue(g.dx * 0.55);
          // the strip only follows the finger where that is certain up front
          if (stripAll.current(which)) stripTx.setValue(g.dx * 0.55);
          else stripTx.setValue(0);
        }
      },
      onPanResponderRelease: (_, g) => {
        if (which === 'primary' && pullOk.current && g.dy > 80 && g.dy > Math.abs(g.dx)) {
          pull.current();
          settle();
          return;
        }
        if (Math.abs(g.dx) > 45 || Math.abs(g.vx) > 0.4) {
          const dir = g.dx < 0 ? 1 : -1;
          const withStrip = stripNext.current(which, dir);
          // the strip wasn't following the finger but is about to move: start it
          // from where the timetable is, so the two travel as one
          if (withStrip && !stripAll.current(which) && modeRef.current === 'slide') {
            stripTx.setValue(g.dx * 0.55);
          }
          commitRef.current(dir, which === 'primary' ? primary.current : alt.current, withStrip);
        } else settle();
      },
      onPanResponderTerminate: settle,
    });

  const drag = useRef(makeDrag('primary', false)).current;
  const altDrag = useRef(makeDrag('alt', true)).current;

  const recenter = useCallback(() => tx.setValue(0), [tx]);

  return { tx, stripTx, fade, go, goAlt, drag, altDrag, recenter, bumpStrip, stripHandled };
}

export default function TimetableScreen({
  onOpenSettings,
  onOpenSchool,
  jumpTo,
  onJumped,
}: {
  onOpenSettings: () => void;
  onOpenSchool: () => void;
  /** ISO date to show, set when something outside the timetable asks for a day. */
  jumpTo: string | null;
  onJumped: () => void;
}) {
  const { settings, theme, t, update } = useSettings();
  const { account } = useAccount();
  const { load: loadSchool, loadAll: loadSchoolAll, clear: clearSchool } = useSchoolData();
  const [date, setDate] = useState(() => skipWeekend(new Date()));
  const [view, setView] = useState<'day' | 'week'>(settings.defaultView);
  const [cache, setCache] = useState<WeekCache>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState(0); // 0 = all parallel groups
  const [, setTick] = useState(0); // re-render each minute so the now-line moves
  const [pickerOpen, setPickerOpen] = useState(false);
  const titleTapAt = useRef(0);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sheet, setSheet] = useState<{ lesson: Lesson; date: string } | null>(null);
  const sheetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cacheRef = useRef(cache);
  const dateRef = useRef(date);
  const inflight = useRef(new Set<string>());
  cacheRef.current = cache;
  dateRef.current = date;

  const client = useMemo(() => {
    if (account) {
      const auth: UntisAuth =
        account.method === 'password'
          ? new PasswordAuth(account.host, account.school, account.user, account.password!)
          : new SessionAuth(account.host, account.school, account.user, account.secret!);
      return new UntisClient({ host: account.host, school: account.school }, auth);
    }
    return new UntisClient(
      { host: settings.host, school: settings.school },
      new AnonymousAuth(settings.school),
    );
  }, [account, settings.host, settings.school]);

  const weekStart = useMemo(() => startOfWeek(date), [date]);
  const weekKey = iso(weekStart);
  const weekDays = useMemo(
    () => Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const fetchWeek = useCallback(
    async (ws: Date, force = false) => {
      const key = iso(ws);
      if (inflight.current.has(key)) return;
      if (!force && cacheRef.current[key]) return;
      const isCurrent = key === iso(startOfWeek(dateRef.current));
      inflight.current.add(key);
      if (isCurrent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await client.timetable({
          start: key,
          end: iso(addDays(ws, 5)),
          resourceId: account ? account.studentId ?? account.personId : settings.classId,
          resourceType: account ? resourceTypeForPerson(account.personType) : 'CLASS',
          timetableType: account ? 'MY_TIMETABLE' : 'STANDARD',
        });
        setCache((c) => ({ ...c, [key]: res.days ?? [] }));
      } catch (e: any) {
        if (isCurrent) setError(e?.message ?? t.loadError);
      } finally {
        inflight.current.delete(key);
        if (isCurrent) setLoading(false);
      }
    },
    [client, account, settings.classId, t.loadError],
  );

  const refresh = useCallback(() => {
    for (const o of [0, -7, 7]) fetchWeek(addDays(weekStart, o), true);
  }, [fetchWeek, weekStart]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // opening an exam from the School screen lands on its day
  useEffect(() => {
    if (!jumpTo) return;
    const [y, m, d] = jumpTo.split('-').map(Number);
    setDate(new Date(y, m - 1, d));
    onJumped();
  }, [jumpTo, onJumped]);

  /**
   * Exams get a reminder of their own, without the user having to open the
   * School screen. Reminders the user has edited are left untouched.
   */
  // held in refs: `update` gets a new identity on every settings change, and a
  // dependency on it would re-fetch exams each time any setting is touched
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const updateRef = useRef(update);
  updateRef.current = update;
  useEffect(() => {
    if (!account) return;
    let dropped = false;
    (async () => {
      try {
        // goes through the shared cache, so the School screen opens instantly
        const exams = await loadSchool('exams', client, account);
        if (dropped || !exams) return;
        const next = await syncExamReminders(exams, settingsRef.current);
        if (next && !dropped) updateRef.current({ reminders: next });
      } catch {
        // no exams / offline — nothing to sync, try again next launch
      }
      // the rest can warm up quietly once the timetable itself is up
      if (!dropped) setTimeout(() => loadSchoolAll(client, account), 1500);
    })();
    return () => {
      dropped = true;
    };
  }, [
    account,
    client,
    loadSchool,
    loadSchoolAll,
    settings.autoExamReminders,
    (settings.autoExamDays ?? []).join(','),
    settings.reminderHour,
  ]);

  // a different account must not show the previous one's lists. Skips the first
  // run: on mount there is nothing to clear, and wiping then would throw away
  // the bookkeeping for the preload that has just started.
  const lastPerson = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const id = account?.personId ?? null;
    if (lastPerson.current !== undefined && lastPerson.current !== id) clearSchool();
    lastPerson.current = id;
  }, [account?.personId, clearSchool]);

  // coming back from the background lands on today again
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setTick((n) => n + 1);
      if (settings.resetOnResume) setDate(skipWeekend(new Date()));
    });
    return () => sub.remove();
  }, [settings.resetOnResume]);

  useEffect(() => {
    setCache({});
  }, [settings.classId, settings.host, settings.school, account?.personId]);

  // this week first, the neighbours right after, so a swipe already has data
  useEffect(() => {
    fetchWeek(weekStart);
    const id = setTimeout(() => {
      fetchWeek(addDays(weekStart, -7));
      fetchWeek(addDays(weekStart, 7));
    }, 120);
    return () => clearTimeout(id);
  }, [weekKey, fetchWeek]);

  const daysFor = useCallback((d: Date) => cache[iso(startOfWeek(d))] ?? [], [cache]);
  const days = daysFor(date);

  const lessonsFor = useCallback(
    (d: TimetableDay | undefined): Lesson[] => {
      if (!d) return [];
      const all = d.gridEntries.map(toLesson);
      const filtered = settings.hideCancelled ? all.filter((l) => !l.cancelled) : all;
      return filtered.sort((a, b) => a.startMin - b.startMin || a.layoutGroup - b.layoutGroup);
    },
    [settings.hideCancelled],
  );

  // remember every subject / teacher / room seen, so Settings can list them
  useEffect(() => {
    if (!days.length) return;
    const subjects = new Set(settings.knownSubjects);
    const teachers = new Set(settings.knownTeachers);
    const rooms = new Set(settings.knownRooms);
    for (const d of days) {
      for (const e of d.gridEntries) {
        const l = toLesson(e);
        if (l.subject && l.subject !== '—') subjects.add(l.subject);
        l.teachers.forEach((x) => teachers.add(x));
        l.rooms.forEach((x) => rooms.add(x));
      }
    }
    if (
      subjects.size !== settings.knownSubjects.length ||
      teachers.size !== settings.knownTeachers.length ||
      rooms.size !== settings.knownRooms.length
    ) {
      update({
        knownSubjects: [...subjects].sort(),
        knownTeachers: [...teachers].sort(),
        knownRooms: [...rooms].sort(),
      });
    }
  }, [days]);

  const weekHasGroups = useMemo(
    () => days.some((d) => hasGroups(d.gridEntries.map(toLesson))),
    [days],
  );

  const stepDay = useCallback(
    (dir: 1 | -1) => setDate((d) => skipWeekend(addDays(d, dir), dir)),
    [],
  );
  const stepWeek = useCallback((dir: 1 | -1) => setDate((d) => addDays(d, 7 * dir)), []);
  const viewRef = useRef(view);
  viewRef.current = view;

  /**
   * Opening the details is delayed a little: a second tap in that window means
   * the user is switching day/week, not asking about the lesson.
   */
  const cancelSheet = useCallback(() => {
    if (sheetTimer.current) {
      clearTimeout(sheetTimer.current);
      sheetTimer.current = null;
    }
  }, []);

  const openSheetSoon = useCallback(
    (lesson: Lesson, dayIso: string) => {
      cancelSheet();
      sheetTimer.current = setTimeout(() => {
        sheetTimer.current = null;
        setSheet({ lesson, date: dayIso });
      }, DOUBLE_TAP_MS);
    },
    [cancelSheet],
  );

  useEffect(() => cancelSheet, [cancelSheet]);

  useEffect(
    () => () => {
      if (titleTimer.current) clearTimeout(titleTimer.current);
    },
    [],
  );

  const car = useCarousel(
    (dir) => (viewRef.current === 'week' ? stepWeek(dir) : stepDay(dir)),
    stepWeek,
    // slide is the only transition now; older saved settings may still say fade
    'slide',
    () => {
      cancelSheet();
      setView((v) => (v === 'day' ? 'week' : 'day'));
    },
    () => {
      cancelSheet();
      setDate(skipWeekend(new Date()));
    },
    refresh,
    view === 'week' || settings.fitToScreen,
    cancelSheet,
    // the strip follows the finger only on its own drag and in week view; a day
    // swipe that crosses into another week is animated by the effect below
    // only the strip's own drag follows the finger; a swipe on the timetable
    // leaves the strip still until it is released
    (which) => which === 'alt',
    // does the step about to happen land in another week?
    (which, dir) => {
      if (which === 'alt' || viewRef.current === 'week') return true;
      const next = skipWeekend(addDays(dateRef.current, dir), dir);
      return iso(startOfWeek(next)) !== iso(startOfWeek(dateRef.current));
    },
  );

  /**
   * Whenever the shown week actually changes, slide the strip — unless the
   * swipe that caused it already dragged the strip along.
   */
  const lastWeekKey = useRef(weekKey);
  useEffect(() => {
    if (lastWeekKey.current === weekKey) return;
    const dir: 1 | -1 = weekKey > lastWeekKey.current ? 1 : -1;
    lastWeekKey.current = weekKey;
    if (car.stripHandled.current) {
      car.stripHandled.current = false;
      return;
    }
    car.bumpStrip(dir);
  }, [weekKey]);

  const s = makeStyles(theme);

  /**
   * The calendar opens on the first tap with no delay; a second tap landing
   * during the opening animation cancels it and jumps to today instead.
   */
  const onTitlePress = () => {
    const now = Date.now();
    // second tap: cancel the pending calendar and jump to today instead, so it
    // never flashes open on a double-tap
    if (now - titleTapAt.current < 420) {
      titleTapAt.current = 0;
      if (titleTimer.current) {
        clearTimeout(titleTimer.current);
        titleTimer.current = null;
      }
      setPickerOpen(false);
      setDate(skipWeekend(new Date()));
      return;
    }
    titleTapAt.current = now;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      titleTimer.current = null;
      setPickerOpen(true);
    }, 50);
  };

  /* ---------------- one day page ---------------- */

  const gridFor = useCallback(
    (d: Date) =>
      buildDayGrid(
        filterGroup(lessonsFor(daysFor(d).find((x) => x.date === iso(d))), group),
        settings.periods,
        settings.mergeDay,
        group > 0,
        settings.mergeDay,
        !settings.showAllPeriods,
      ),
    [
      daysFor,
      lessonsFor,
      group,
      settings.periods,
      settings.mergeDay,
      settings.showAllPeriods,
    ],
  );

  const grid = gridFor(date);

  const renderDayPage = (d: Date, fit: boolean) => {
    const g = gridFor(d);
    const total = g.last - g.first + 1;
    const isToday = isSameDay(d, new Date());
    const nowF = isToday && total > 0 ? nowFraction(settings.periods, g.first, g.last) : null;
    const nowColor = settings.nowLineColor ?? theme.accent;
    const n = nowMinutes();

    const range = (b: { p0: number; pSpan: number }) => ({
      from: toMinutes(settings.periods[b.p0].start),
      to: toMinutes(settings.periods[Math.min(b.p0 + b.pSpan - 1, settings.periods.length - 1)].end),
    });

    return (
      <View
        style={[
          s.dayWrap,
          settings.alignedDayBar && s.dayWrapAligned,
          fit ? { flex: 1 } : { height: Math.max(1, total) * PERIOD_H },
        ]}
      >
        <View style={[s.rowTime, settings.alignedDayBar && s.rowTimeAligned]}>
          {Array.from({ length: Math.max(0, total) }, (_, i) => g.first + i).map((pi) => {
            const p = settings.periods[pi];
            const now = isToday && n >= toMinutes(p.start) && n <= toMinutes(p.end);
            return (
              <View key={pi} style={[s.rowTimeCell, { height: `${100 / total}%` }]}>
                {settings.showPeriodNumbers && (
                  <Text style={[s.rowNum, now && { color: theme.accent }]}>{p.label}</Text>
                )}
                <Text style={s.rowStart}>{p.start}</Text>
                <Text style={s.rowEnd}>{p.end}</Text>
              </View>
            );
          })}
        </View>

        <View style={{ flex: 1 }}>
          {g.blocks.map((b) => {
            const { from, to } = range(b);
            const progress =
              settings.nowProgress && isToday && n >= from && n <= to
                ? (n - from) / Math.max(1, to - from)
                : null;
            return (
              <View
                key={`${b.p0}-${b.c0}-${keyFor(b.lesson)}`}
                style={{
                  position: 'absolute',
                  top: `${((b.p0 - g.first) / total) * 100}%`,
                  height: `${(b.pSpan / total) * 100}%`,
                  left: `${(b.c0 / g.cols) * 100}%`,
                  width: `${(b.cSpan / g.cols) * 100}%`,
                  padding: 2,
                }}
              >
                {b.lesson ? (
                  <Pressable
                    style={{ flex: 1 }}
                    onPress={() => openSheetSoon(b.lesson as Lesson, iso(d))}
                  >
                    <LessonCard
                      lesson={b.lesson}
                      theme={theme}
                      settings={settings}
                      cancelledLabel={t.cancelledBadge}
                      fill
                      dense={b.cSpan < g.cols}
                      progress={progress}
                      past={settings.dimPast && isToday && n > to}
                      hideGroupLabel={group > 0}
                      badge={
                        findReminder(settings.reminders, iso(d), b.lesson)
                          ? kindIcon(
                              findReminder(settings.reminders, iso(d), b.lesson)!.kind,
                              settings.minimalIcons,
                            )
                          : null
                      }
                    />
                  </Pressable>
                ) : (
                  <View style={[s.free, { flex: 1 }]}>
                    <Text style={s.freeTxt}>{t.freePeriod}</Text>
                  </View>
                )}
              </View>
            );
          })}

          {settings.nowLine && nowF !== null && (
            <View pointerEvents="none" style={[s.nowLine, { top: `${nowF * 100}%` }]}>
              <View style={[s.nowDot, { backgroundColor: nowColor }]} />
              <View style={[s.nowBar, { backgroundColor: nowColor }]} />
            </View>
          )}
        </View>

        {g.empty && !loading && <Text style={s.emptyOverlay}>{t.noSchool}</Text>}
      </View>
    );
  };

  /** The page at offset -1 / 0 / +1 from the current one. */
  const pageAt = (offset: -1 | 0 | 1) => {
    if (view === 'week') {
      const ws = addDays(weekStart, offset * 7);
      const wDays = Array.from({ length: 5 }, (_, i) => addDays(ws, i));
      return (
        <WeekGrid
          group={group}
          days={wDays}
          data={cache[iso(ws)] ?? []}
          lessonsFor={lessonsFor}
          theme={theme}
          today={new Date()}
          onPickDay={(d) => {
            setDate(d);
            setView('day');
          }}
          onPickLesson={openSheetSoon}
        />
      );
    }

    const d = offset === 0 ? date : skipWeekend(addDays(date, offset), offset > 0 ? 1 : -1);
    if (settings.fitToScreen) {
      return (
        <View style={[s.fitWrap, settings.alignedDayBar && s.pageAligned]}>
          {renderDayPage(d, true)}
        </View>
      );
    }
    return (
      <ScrollView
        contentContainerStyle={[s.list, settings.alignedDayBar && s.pageAligned]}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={theme.accent} />
        }
      >
        {renderDayPage(d, false)}
      </ScrollView>
    );
  };

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, settings.alignedDayBar && s.headerAligned]}>
        {/* tap the title for the calendar, double-tap it to jump to today */}
        <Pressable style={{ flex: 1 }} onPress={onTitlePress}>
          <Text style={s.title}>
            {view === 'day' ? formatDayLabel(date, settings.lang) : t.viewWeek}
          </Text>
          <Text style={s.subtitle}>
            {formatDate(date, settings.lang)} · {settings.className}
          </Text>
        </Pressable>
        {!!account && (
          <Pressable
            onPress={onOpenSchool}
            style={[
              s.iconBtn,
              s.schoolBtn,
              { backgroundColor: theme.accent, borderColor: theme.accent },
            ]}
          >
            <Text style={[s.iconTxt, { color: theme.accentText, fontWeight: '800' }]}>
              {t.sectionSchoolData}
            </Text>
          </Pressable>
        )}
        {weekHasGroups && (
          <Pressable
            onPress={() => setGroup((g) => (g + 1) % 3)}
            style={[
              s.iconBtn,
              group > 0 && { backgroundColor: theme.accent, borderColor: theme.accent },
            ]}
          >
            <Text style={[s.iconTxt, group > 0 && { color: theme.accentText }]}>
              {group === 0 ? t.groupAll : `${t.group} ${group}`}
            </Text>
          </Pressable>
        )}
        <Pressable onPress={onOpenSettings} style={s.iconBtn}>
          <Text style={s.iconTxt}>⚙</Text>
        </Pressable>
      </View>

      {/* Day strip — swiping here moves a whole week */}
      <Animated.View
        style={[
          s.strip,
          settings.alignedDayBar ? s.stripAligned : s.stripWide,
          { transform: [{ translateX: car.stripTx }] },
        ]}
        {...car.altDrag.panHandlers}
      >
        {weekDays.map((d) => {
          const active = isSameDay(d, date) && view === 'day';
          const today = isSameDay(d, new Date());
          return (
            <Pressable
              key={iso(d)}
              onPress={() => {
                if (active) {
                  setView('week');
                } else {
                  setDate(d);
                  setView('day');
                }
              }}
              style={[
                s.chip,
                settings.alignedDayBar && s.chipAligned,
                active && { backgroundColor: theme.accent },
              ]}
            >
              <Text style={[s.chipDay, active && { color: theme.accentText }]}>
                {dayShort(d, settings.lang)}
              </Text>
              <Text
                style={[
                  s.chipNum,
                  active && { color: theme.accentText },
                  today && !active && { color: theme.accent },
                ]}
              >
                {d.getDate()}
              </Text>
            </Pressable>
          );
        })}
      </Animated.View>

      {sheet && (
        <LessonSheet lesson={sheet.lesson} date={sheet.date} onClose={() => setSheet(null)} />
      )}

      <DatePicker
        visible={pickerOpen}
        value={date}
        onPick={(d) => {
          setDate(d);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
        onQuickDismiss={() => {
          setPickerOpen(false);
          setDate(skipWeekend(new Date()));
        }}
      />

      {!!error && (
        <Pressable onPress={refresh} style={s.error}>
          <Text style={s.errorTxt}>{error}</Text>
          <Text style={s.errorHint}>{t.tapRetry}</Text>
        </Pressable>
      )}

      {loading && days.length === 0 && (
        <View style={s.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      )}

      <Animated.View
        style={{ flex: 1, opacity: car.fade, transform: [{ translateX: car.tx }] }}
        {...car.drag.panHandlers}
      >
        {pageAt(0)}
      </Animated.View>
    </View>
  );
}

/**
 * Boxes to draw in one week-grid cell: shared lessons first, then one slot per
 * group — null where that group has a free period.
 */
function weekBoxes(cell: Lesson[], filtered: boolean): (Lesson | null)[] {
  // with a group selected there is nothing to sit beside — use the full width
  if (filtered) return cell.slice(0, 2);
  const sp = splitGroups(cell);
  const out: (Lesson | null)[] = [...sp.full];
  for (const b of sp.boxes) out.push(b.lesson);
  return out.slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Week grid: 5 day columns × period rows, everything on one screen     */
/* ------------------------------------------------------------------ */

function WeekGrid({
  days,
  data,
  lessonsFor,
  theme,
  today,
  onPickDay,
  onPickLesson,
  group,
}: {
  days: Date[];
  data: TimetableDay[];
  lessonsFor: (d: TimetableDay | undefined) => Lesson[];
  theme: Theme;
  today: Date;
  onPickDay: (d: Date) => void;
  onPickLesson: (l: Lesson, dayIso: string) => void;
  /** 0 = show every parallel group, n = show only the n-th one. */
  group: number;
}) {
  const { settings, t } = useSettings();
  const g = makeGridStyles(theme);
  const wf = settings.fields.week;

  const rawGrid = days.map((d) => {
    const lessons = lessonsFor(data.find((x) => x.date === iso(d)));
    return settings.periods.map((p) => {
      const ps = toMinutes(p.start);
      const pe = toMinutes(p.end);
      return mergeSameSubject(
        lessons.filter((l) => l.startMin < pe && l.endMin > ps),
      ).sort((a, b) => a.layoutGroup - b.layoutGroup);
    });
  });

  // a period with a single lesson isn't split, so it belongs to every group
  const grid =
    group === 0 ? rawGrid : rawGrid.map((col) => col.map((cell) => filterGroup(cell, group)));

  let first = 0;
  let last = settings.periods.length - 1;
  const anyAt = (i: number) => grid.some((col) => col[i].length > 0);
  if (!settings.showAllPeriods) {
    while (first <= last && !anyAt(first)) first++;
    while (last >= first && !anyAt(last)) last--;
  }
  const weekEmpty = !settings.periods.some((_, i) => anyAt(i));
  if (first > last) {
    first = 0;
    last = settings.periods.length - 1;
  }
  const periodIdx = Array.from({ length: last - first + 1 }, (_, i) => first + i);

  const cellKey = (ls: Lesson[]) =>
    ls
      .map((l) =>
        `${l.subject}|${l.status}|${l.teachers.join(',')}|${l.rooms.join(',')}|${l.groupLabel ?? ''}`,
      )
      .join('#');
  const sameAsAbove = (col: Lesson[][], i: number) =>
    i > first && col[i].length > 0 && cellKey(col[i]) === cellKey(col[i - 1]);

  const nowF = days.some((d) => isSameDay(d, today))
    ? nowFraction(settings.periods, first, last)
    : null;
  const nowColor = settings.nowLineColor ?? theme.accent;
  const nowMin = nowMinutes();

  /** Runs of consecutive periods that show the same thing, so they can merge. */
  const runsFor = (col: Lesson[][]) => {
    const out: { from: number; span: number; cell: Lesson[] }[] = [];
    for (const i of periodIdx) {
      const prev = out[out.length - 1];
      const key = cellKey(col[i]);
      const canMerge =
        settings.weekMerge &&
        prev &&
        prev.from + prev.span === i &&
        col[i].length > 0 &&
        cellKey(col[prev.from]) === key;
      if (canMerge && prev) prev.span += 1;
      else out.push({ from: i, span: 1, cell: col[i] });
    }
    return out;
  };

  return (
    <View style={g.wrap}>
      {/* with an aligned day bar the strip above already labels the columns */}
      {!settings.alignedDayBar && (
        <View style={g.headRow}>
          <View style={g.timeCol} />
          {days.map((d) => {
            const isToday = isSameDay(d, today);
            return (
              <Pressable key={iso(d)} style={g.headCell} onPress={() => onPickDay(d)}>
                <Text style={[g.headDay, isToday && { color: theme.accent }]}>
                  {dayShort(d, settings.lang)}
                </Text>
                <Text style={[g.headNum, isToday && { color: theme.accent }]}>{d.getDate()}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View
        style={[
          g.body,
          settings.alignedDayBar && {
            flex: 0,
            height: periodIdx.length * settings.weekRowHeight,
          },
        ]}
      >
        <View style={g.timeCol}>
          {periodIdx.map((i) => (
            <View key={i} style={g.timeCell}>
              <Text style={g.timeNum}>{settings.periods[i].label}</Text>
              <Text style={g.timeTxt}>{settings.periods[i].start}</Text>
            </View>
          ))}
        </View>

        {grid.map((col, di) => (
          <View key={di} style={g.dayCol}>
            {runsFor(col).map((run) => {
              const past =
                settings.dimPast &&
                isSameDay(days[di], today) &&
                nowMin > toMinutes(settings.periods[run.from + run.span - 1].end);

              return (
                <View
                  key={run.from}
                  style={[
                    g.runWrap,
                    {
                      top: `${((run.from - first) / periodIdx.length) * 100}%`,
                      height: `${(run.span / periodIdx.length) * 100}%`,
                    },
                  ]}
                >
                  {run.cell.length === 0 ? (
                    <View style={g.cellEmpty} />
                  ) : (
                    <View style={g.cellRow}>
                      {weekBoxes(run.cell, group > 0).map((l, bi) => {
                        if (!l) return <View key={`gap${bi}`} style={g.cellEmpty} />;
                        const skin = cardSkin(l, theme, settings);
                        const reminder = findReminder(settings.reminders, iso(days[di]), l);
                        return (
                          <View key={l.id} style={{ flex: 1 }}>
                          <Pressable
                            onPress={() => onPickLesson(l, iso(days[di]))}
                            style={[
                              g.cell,
                              {
                                backgroundColor: skin.background,
                                borderColor: skin.border,
                                borderWidth: skin.borderWidth,
                                opacity: (l.cancelled ? 0.5 : 1) * (past ? 0.45 : 1),
                              },
                            ]}
                          >
                            {skin.stripe > 0 && (
                              <View style={[g.cellStripe, { backgroundColor: skin.stripeColor }]} />
                            )}
                            <View style={g.cellBody}>
                              {!!fieldText(l, settings, wf.main, 'week') && (
                                <Text
                                  style={[
                                    g.cellSubject,
                                    {
                                      fontSize: settings.weekMainSize,
                                      color: pickTextColor(settings.textColorMain, skin.text),
                                      textDecorationLine: l.cancelled ? 'line-through' : 'none',
                                    },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {fieldText(l, settings, wf.main, 'week')}
                                </Text>
                              )}
                              {!!fieldText(l, settings, wf.sub, 'week') && (
                                <Text
                                  style={[
                                    g.cellRoom,
                                    {
                                      fontSize: settings.weekSubSize,
                                      color: pickTextColor(settings.textColorSub, skin.dim),
                                    },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {fieldText(l, settings, wf.sub, 'week')}
                                </Text>
                              )}
                              {!!reminder && (
                                <Text
                                  style={[
                                    g.cellBadge,
                                    {
                                      fontSize: Math.max(
                                        7,
                                        Math.round(settings.badgeSize * 0.7),
                                      ),
                                    },
                                  ]}
                                >
                                  {kindIcon(reminder.kind, settings.minimalIcons)}
                                </Text>
                              )}
                            </View>
                          </Pressable>
                          {subjectFlagList(settings, l.subject).length > 0 && (
                            <View pointerEvents="none" style={g.cellFlag}>
                              {subjectFlagList(settings, l.subject).map((f) => (
                                <StickyNote
                                  key={f}
                                  color={f}
                                  size={Math.max(9, Math.round(settings.weekMainSize * 1.05))}
                                  bg={skin.background}
                                  notch={false}
                                />
                              ))}
                            </View>
                          )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}

        {settings.nowLine && nowF !== null && (
          <View pointerEvents="none" style={[g.nowLine, { top: `${nowF * 100}%` }]}>
            <View style={[g.nowDot, { backgroundColor: nowColor }]} />
            <View style={[g.nowBar, { backgroundColor: nowColor }]} />
          </View>
        )}
        {weekEmpty && <Text style={g.emptyOverlay}>{t.noSchool}</Text>}
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: 10,
      gap: 6,
    },
    /** Flush with the day bar: its 34px time-column indent plus 2 + 2 padding. */
    headerAligned: { paddingLeft: 38, paddingRight: 4 },
    title: { color: t.text, fontSize: 24, fontWeight: '800' },
    subtitle: { color: t.textDim, fontSize: 12, marginTop: 1 },
    iconBtn: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 10,
      backgroundColor: t.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
    },
    iconTxt: { color: t.text, fontSize: 13, fontWeight: '600' },
    // same height as the other header buttons, just wider with centred text.
    // a hairline border renders unevenly around rounded corners, so use a full
    // pixel and a tinted fill instead
    viewBtn: {
      minWidth: 78,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: t.accent,
      backgroundColor: t.surfaceAlt,
      borderRadius: 12,
    },
    viewTxt: { fontWeight: '800', color: t.accent },
    schoolBtn: { minWidth: 78, alignItems: 'center', justifyContent: 'center' },
    strip: { flexDirection: 'row', marginBottom: 8 },
    /** The original bar: full width, evenly spaced, its own row in the grid. */
    stripWide: { paddingHorizontal: 10, gap: 5 },
    /**
     * Aligned bar: grid geometry — wrap padding 3 + the 34px time column, and
     * the 2px each side that every cell already carries — so a chip lands
     * square on top of its column. Day view uses the same metrics, so the chips
     * keep one size across both views.
     */
    // unlike headerAligned, each chip below still adds its own GAP margin — so
    // this padding stops at the column edge itself (PAD+TIME / PAD) and lets
    // the chip's margin supply the same GAP inset the grid's cards use
    stripAligned: { paddingLeft: 36, paddingRight: 2 },
    chipAligned: { marginHorizontal: 2 },
    chip: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 6,
      borderRadius: 10,
      backgroundColor: t.surface,
    },
    chipDay: { color: t.textDim, fontSize: 10, fontWeight: '700' },
    chipNum: { color: t.text, fontSize: 15, fontWeight: '700' },
    fitWrap: { flex: 1, paddingHorizontal: 10, paddingBottom: 8, gap: 4 },
    list: { paddingHorizontal: 10, paddingBottom: 24 },
    /** Same edges as the day bar, so the cards line up under the chips. */
    pageAligned: { paddingLeft: 2, paddingRight: 4 },
    row: { flexDirection: 'row', gap: 8 },
    dayWrap: { flexDirection: 'row', gap: 6 },
    // 2 (page) + 34 (times) + 2 (gap) = the day bar's 38px left edge
    dayWrapAligned: { gap: 2 },
    nowLine: {
      position: 'absolute',
      left: -6,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      zIndex: 10,
    },
    nowDot: { width: 8, height: 8, borderRadius: 4 },
    nowBar: { flex: 1, height: 2, borderRadius: 1 },
    rowTime: { width: 46 },
    rowTimeAligned: { width: 34 },
    rowTimeCell: { alignItems: 'flex-end', justifyContent: 'center' },
    rowNum: { color: t.textDim, fontSize: 15, fontWeight: '800' },
    rowStart: { color: t.text, fontSize: 11, fontWeight: '600' },
    rowEnd: { color: t.textDim, fontSize: 10 },
    rowBody: { flex: 1, gap: 4 },
    rowBodySide: { flexDirection: 'row' },
    free: {
      borderWidth: StyleSheet.hairlineWidth,
      borderStyle: 'dashed',
      borderColor: t.border,
      borderRadius: 12,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    freeTxt: { color: t.textDim, fontSize: 11 },
    empty: { color: t.textDim, textAlign: 'center', marginTop: 40, fontSize: 15 },
    emptyOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: '42%',
      textAlign: 'center',
      color: t.textDim,
      fontSize: 15,
    },
    center: { paddingVertical: 20 },
    error: {
      marginHorizontal: 12,
      marginBottom: 6,
      padding: 10,
      borderRadius: 12,
      backgroundColor: t.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cancelled,
    },
    errorTxt: { color: t.cancelled, fontSize: 12 },
    errorHint: { color: t.textDim, fontSize: 11, marginTop: 2 },
  });

const makeGridStyles = (t: Theme) =>
  StyleSheet.create({
    // 3 here plus each cell's own 3px inset = the same 6px the cards keep
    // between each other, so the grid breathes evenly right to the screen edge
    // PAD=2 outer + each cell's own GAP=2 inset = a 4px gap at the screen edge
    // too, matching the 4px every card keeps from its neighbours
    wrap: { flex: 1, paddingHorizontal: 2, paddingBottom: 8 },
    headRow: { flexDirection: 'row', paddingBottom: 4 },
    headCell: { flex: 1, alignItems: 'center' },
    headDay: { color: t.textDim, fontSize: 10, fontWeight: '800' },
    headNum: { color: t.text, fontSize: 12, fontWeight: '700' },
    timeCol: { width: 34, alignItems: 'flex-end', paddingRight: 4, justifyContent: 'center' },
    body: { flex: 1, flexDirection: 'row' },
    dayCol: { flex: 1, position: 'relative' },
    // flexBasis 0 makes a run's height come purely from its span — with the
    // default auto basis the text inside a merged block counts as content and
    // nudges its edges out of line with the single-period blocks beside it
    /**
     * Runs are placed by percentage rather than flex: a block spanning three
     * periods then lands on exactly the same pixel row as three single blocks
     * in the column next to it, whatever is inside them.
     */
    runWrap: { position: 'absolute', left: 0, right: 0, padding: 2 },
    timeCell: { flex: 1, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 4 },
    timeNum: { color: t.textDim, fontSize: 11, fontWeight: '800' },
    timeTxt: { color: t.textDim, fontSize: 8 },
    cellWrap: { flex: 1, padding: 1.5 },
    cellRow: { flex: 1, flexDirection: 'row', gap: 2 },
    cell: {
      flex: 1,
      flexDirection: 'row',
      borderRadius: 7,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
    },
    cellCont: { opacity: 0.85 },
    cellStripe: { width: 3 },
    cellFlag: { position: 'absolute', top: 0, right: 8, zIndex: 6, flexDirection: 'row', gap: 2 },
    nowLine: {
      position: 'absolute',
      left: 26,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      zIndex: 10,
    },
    nowDot: { width: 7, height: 7, borderRadius: 3.5 },
    nowBar: { flex: 1, height: 2, borderRadius: 1 },
    cellBody: { flex: 1, justifyContent: 'center', paddingHorizontal: 3 },
    cellSubject: { fontWeight: '700' },
    cellRoom: {},
    cellBadge: { position: 'absolute', right: 1, bottom: 0 },
    cellEmpty: { flex: 1 },
    empty: { color: t.textDim, textAlign: 'center', marginTop: 40, fontSize: 15 },
    emptyOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: '45%',
      textAlign: 'center',
      color: t.textDim,
      fontSize: 15,
    },
  });
