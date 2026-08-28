import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { AnonymousAuth, toLesson, toMinutes, UntisClient } from '../api/untis';
import DatePicker from '../components/DatePicker';
import LessonCard from '../components/LessonCard';
import LessonSheet from '../components/LessonSheet';
import { cardSkin } from '../lib/colors';
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
import { findReminder, KIND_ICON } from '../lib/reminders';
import { useSettings } from '../store/settings';
import { Theme } from '../theme';

type WeekCache = Record<string, TimetableDay[]>;

const SCREEN_W = Dimensions.get('window').width;
/** How far a page slides out of the way — a short hop reads better than a full screen. */
const SLIDE = Math.min(140, SCREEN_W * 0.32);
const PERIOD_H = 92;

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
) {
  const tx = useRef(new Animated.Value(0)).current;
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

    if (!moved.current && prev.t && now - prev.t < 250 && near) {
      reset();
      (which === 'primary' ? dblPrimary : dblAlt).current();
      return;
    }
    lastTap.current[which] = { t: now, x: pageX, y: pageY };
    moved.current = false;
  };

  const modeRef = useRef(mode);
  modeRef.current = mode;

  const settle = () =>
    Animated.spring(tx, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();

  /**
   * Kept in a ref, not a useCallback: the PanResponders are created once, so a
   * captured callback would freeze whichever animation mode was set at mount.
   */
  const runId = useRef(0);
  const commitRef = useRef<(dir: 1 | -1, step: (d: 1 | -1) => void) => void>(() => {});
  commitRef.current = (dir, step) => {
    // a new swipe interrupts whatever is still running instead of being ignored
    tx.stopAnimation();
    fade.stopAnimation();
    const id = ++runId.current;
    const m = modeRef.current;

    if (m === 'none') {
      tx.setValue(0);
      fade.setValue(1);
      step(dir);
      return;
    }

    if (m === 'fade') {
      busy.current = true;
      tx.setValue(0);
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
        Animated.timing(fade, {
          toValue: 1,
          duration: 130,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start(() => {
          if (id === runId.current) busy.current = false;
        });
      });
      return;
    }

    // slide: a full screen out, swap, spring the new one in
    busy.current = true;
    Animated.timing(tx, {
      toValue: -dir * SCREEN_W,
      duration: 130,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (id !== runId.current) return;
      if (!finished) {
        tx.setValue(0);
        busy.current = false;
        return;
      }
      step(dir);
      tx.setValue(dir * SCREEN_W);
      Animated.spring(tx, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 3,
        speed: 18,
      }).start(() => {
        if (id === runId.current) busy.current = false;
      });
    });
  };

  const go = useCallback((dir: 1 | -1) => commitRef.current(dir, primary.current), []);
  const goAlt = useCallback((dir: 1 | -1) => commitRef.current(dir, alt.current), []);

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
        fade.stopAnimation();
        fade.setValue(1);
      },
      onPanResponderMove: (_, g) => {
        if (!moved.current) dragStart.current();
        moved.current = true;
        if (modeRef.current === 'slide') tx.setValue(g.dx * 0.55);
      },
      onPanResponderRelease: (_, g) => {
        if (which === 'primary' && pullOk.current && g.dy > 80 && g.dy > Math.abs(g.dx)) {
          pull.current();
          settle();
          return;
        }
        if (Math.abs(g.dx) > 45 || Math.abs(g.vx) > 0.4) {
          commitRef.current(g.dx < 0 ? 1 : -1, which === 'primary' ? primary.current : alt.current);
        } else settle();
      },
      onPanResponderTerminate: settle,
    });

  const drag = useRef(makeDrag('primary', false)).current;
  const altDrag = useRef(makeDrag('alt', true)).current;

  const recenter = useCallback(() => tx.setValue(0), [tx]);

  return { tx, fade, go, goAlt, drag, altDrag, recenter };
}

export default function TimetableScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { settings, theme, t, update } = useSettings();
  const [date, setDate] = useState(() => skipWeekend(new Date()));
  const [view, setView] = useState<'day' | 'week'>(settings.defaultView);
  const [cache, setCache] = useState<WeekCache>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState(0); // 0 = all parallel groups
  const [, setTick] = useState(0); // re-render each minute so the now-line moves
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheet, setSheet] = useState<{ lesson: Lesson; date: string } | null>(null);
  const sheetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cacheRef = useRef(cache);
  const dateRef = useRef(date);
  const inflight = useRef(new Set<string>());
  cacheRef.current = cache;
  dateRef.current = date;

  const client = useMemo(
    () =>
      new UntisClient(
        { host: settings.host, school: settings.school },
        new AnonymousAuth(settings.school),
      ),
    [settings.host, settings.school],
  );

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
          resourceId: settings.classId,
        });
        setCache((c) => ({ ...c, [key]: res.days ?? [] }));
      } catch (e: any) {
        if (isCurrent) setError(e?.message ?? t.loadError);
      } finally {
        inflight.current.delete(key);
        if (isCurrent) setLoading(false);
      }
    },
    [client, settings.classId, t.loadError],
  );

  const refresh = useCallback(() => {
    for (const o of [0, -7, 7]) fetchWeek(addDays(weekStart, o), true);
  }, [fetchWeek, weekStart]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

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
  }, [settings.classId, settings.host, settings.school]);

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
      }, 270);
    },
    [cancelSheet],
  );

  useEffect(() => cancelSheet, [cancelSheet]);

  const car = useCarousel(
    (dir) => (viewRef.current === 'week' ? stepWeek(dir) : stepDay(dir)),
    stepWeek,
    settings.swipeAnim,
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
  );

  const s = makeStyles(theme);

  /**
   * The calendar opens on the first tap with no delay; a second tap landing
   * during the opening animation cancels it and jumps to today instead.
   */
  const onTitlePress = () => setPickerOpen(true);

  /* ---------------- one day page ---------------- */

  const gridFor = useCallback(
    (d: Date) =>
      buildDayGrid(
        filterGroup(lessonsFor(daysFor(d).find((x) => x.date === iso(d))), group),
        settings.periods,
        settings.mergeBlocks,
        group > 0,
        settings.mergeIdentical,
        !settings.showAllPeriods,
      ),
    [
      daysFor,
      lessonsFor,
      group,
      settings.periods,
      settings.mergeBlocks,
      settings.mergeIdentical,
      settings.showAllPeriods,
    ],
  );

  const grid = gridFor(date);

  const DayPage = ({ d, fit }: { d: Date; fit: boolean }) => {
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
      <View style={[s.dayWrap, fit ? { flex: 1 } : { height: Math.max(1, total) * PERIOD_H }]}>
        <View style={s.rowTime}>
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
                      badge={
                        findReminder(settings.reminders, iso(d), b.lesson)
                          ? KIND_ICON[findReminder(settings.reminders, iso(d), b.lesson)!.kind]
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
        <View style={s.fitWrap}>
          <DayPage d={d} fit />
        </View>
      );
    }
    return (
      <ScrollView
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={theme.accent} />
        }
      >
        <DayPage d={d} fit={false} />
      </ScrollView>
    );
  };

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        {/* tap the title for the calendar, double-tap it to jump to today */}
        <Pressable style={{ flex: 1 }} onPress={onTitlePress}>
          <Text style={s.title}>
            {view === 'day' ? formatDayLabel(date, settings.lang) : t.viewWeek}
          </Text>
          <Text style={s.subtitle}>
            {formatDate(date, settings.lang)} · {settings.className}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setView(view === 'day' ? 'week' : 'day')}
          style={[s.iconBtn, s.viewBtn]}
        >
          <Text style={[s.iconTxt, s.viewTxt]}>{view === 'day' ? t.viewDay : t.viewWeek}</Text>
        </Pressable>
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
      <View style={s.strip} {...car.altDrag.panHandlers}>
        {weekDays.map((d) => {
          const active = isSameDay(d, date) && view === 'day';
          const today = isSameDay(d, new Date());
          return (
            <Pressable
              key={iso(d)}
              onPress={() => {
                setDate(d);
                setView('day');
              }}
              style={[s.chip, active && { backgroundColor: theme.accent }]}
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
      </View>

      {/* Week nav */}
      <View style={s.nav}>
        <Pressable onPress={() => car.goAlt(-1)} style={s.navBtn}>
          <Text style={s.navTxt}>{t.prevWeek}</Text>
        </Pressable>
        <Pressable onPress={() => car.goAlt(1)} style={s.navBtn}>
          <Text style={s.navTxt}>{t.nextWeek}</Text>
        </Pressable>
      </View>

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
        settings.mergeIdentical
          ? `${l.subject}|${l.status}|${l.teachers.join(',')}|${l.rooms.join(',')}|${l.groupLabel ?? ''}`
          : l.id,
      )
      .join('#');
  const sameAsAbove = (col: Lesson[][], i: number) =>
    i > first && col[i].length > 0 && cellKey(col[i]) === cellKey(col[i - 1]);

  const nowF = days.some((d) => isSameDay(d, today))
    ? nowFraction(settings.periods, first, last)
    : null;
  const nowColor = settings.nowLineColor ?? theme.accent;
  const nowMin = nowMinutes();

  return (
    <View style={g.wrap}>
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

      <View style={{ flex: 1 }}>
      {periodIdx.map((i) => (
        <View key={i} style={g.row}>
          <View style={g.timeCol}>
            <Text style={g.timeNum}>{settings.periods[i].label}</Text>
            <Text style={g.timeTxt}>{settings.periods[i].start}</Text>
          </View>
          {grid.map((col, di) => {
            const cell = col[i];
            const cont = sameAsAbove(col, i);
            return (
              <View key={di} style={g.cellWrap}>
                {cell.length === 0 ? (
                  <View style={g.cellEmpty} />
                ) : (
                  <View style={g.cellRow}>
                    {weekBoxes(cell, group > 0).map((l, bi) => {
                      if (!l) return <View key={`gap${bi}`} style={g.cellEmpty} />;
                      const skin = cardSkin(l, theme, settings);
                      return (
                        <Pressable
                          key={l.id}
                          onPress={() => onPickLesson(l, iso(days[di]))}
                          style={[
                            g.cell,
                            {
                              backgroundColor: skin.background,
                              borderColor: skin.border,
                              borderWidth: skin.borderWidth,
                              opacity:
                                (l.cancelled ? 0.5 : 1) *
                                (settings.dimPast &&
                                isSameDay(days[di], today) &&
                                nowMin > toMinutes(settings.periods[i].end)
                                  ? 0.45
                                  : 1),
                            },
                            // a continuing lesson keeps the colour but drops the label
                            cont && g.cellCont,
                          ]}
                        >
                          {skin.stripe > 0 && (
                            <View
                              style={[g.cellStripe, { backgroundColor: skin.stripeColor }]}
                            />
                          )}
                          <View style={g.cellBody}>
                            <View style={g.cellTop}>
                              {!!fieldText(l, settings, wf.main, 'week') && (
                                <Text
                                  style={[
                                    g.cellSubject,
                                    {
                                      color: skin.text,
                                      textDecorationLine: l.cancelled ? 'line-through' : 'none',
                                    },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {fieldText(l, settings, wf.main, 'week')}
                                </Text>
                              )}
                              {!!fieldText(l, settings, wf.right, 'week') && (
                                <Text
                                  style={[g.cellRoom, { color: skin.dim }]}
                                  numberOfLines={1}
                                >
                                  {fieldText(l, settings, wf.right, 'week')}
                                </Text>
                              )}
                            </View>
                            {!!fieldText(l, settings, wf.sub, 'week') && (
                              <Text style={[g.cellRoom, { color: skin.dim }]} numberOfLines={1}>
                                {fieldText(l, settings, wf.sub, 'week')}
                              </Text>
                            )}
                            {!!findReminder(settings.reminders, iso(days[di]), l) && (
                              <Text
                                style={[
                                  g.cellBadge,
                                  { fontSize: Math.max(7, Math.round(settings.badgeSize * 0.7)) },
                                ]}
                              >
                                {
                                  KIND_ICON[
                                    findReminder(settings.reminders, iso(days[di]), l)!.kind
                                  ]
                                }
                              </Text>
                            )}

                          </View>
                        </Pressable>
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
    strip: { flexDirection: 'row', paddingHorizontal: 10, gap: 5 },
    chip: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 6,
      borderRadius: 10,
      backgroundColor: t.surface,
    },
    chipDay: { color: t.textDim, fontSize: 10, fontWeight: '700' },
    chipNum: { color: t.text, fontSize: 15, fontWeight: '700' },
    nav: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    navBtn: { paddingVertical: 2 },
    navTxt: { color: t.textDim, fontSize: 11, fontWeight: '600' },
    fitWrap: { flex: 1, paddingHorizontal: 10, paddingBottom: 8, gap: 4 },
    list: { paddingHorizontal: 10, paddingBottom: 24 },
    row: { flexDirection: 'row', gap: 8 },
    dayWrap: { flexDirection: 'row', gap: 6 },
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
    rowTimeCell: { alignItems: 'flex-end', justifyContent: 'center' },
    rowNum: { color: t.textDim, fontSize: 13, fontWeight: '800' },
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
    wrap: { flex: 1, paddingHorizontal: 8, paddingBottom: 8 },
    headRow: { flexDirection: 'row', paddingBottom: 4 },
    timeCol: { width: 34, alignItems: 'flex-end', paddingRight: 4, justifyContent: 'center' },
    headCell: { flex: 1, alignItems: 'center' },
    headDay: { color: t.textDim, fontSize: 10, fontWeight: '800' },
    headNum: { color: t.text, fontSize: 12, fontWeight: '700' },
    row: { flex: 1, flexDirection: 'row' },
    timeNum: { color: t.textDim, fontSize: 11, fontWeight: '800' },
    timeTxt: { color: t.textDim, fontSize: 8 },
    cellWrap: { flex: 1, padding: 1.5 },
    cellRow: { flex: 1, flexDirection: 'row', gap: 1.5 },
    cell: {
      flex: 1,
      flexDirection: 'row',
      borderRadius: 7,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
    },
    cellCont: { opacity: 0.85 },
    cellStripe: { width: 3 },
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
    cellTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 3 },
    cellSubject: { fontSize: 11, fontWeight: '700' },
    cellRoom: { fontSize: 8 },
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
