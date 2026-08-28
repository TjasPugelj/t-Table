import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { addDays, isSameDay, isWeekend, startOfWeek } from '../lib/date';
import { useSettings } from '../store/settings';

const HOP = Math.min(110, Dimensions.get('window').width * 0.28);

interface Props {
  visible: boolean;
  value: Date;
  onPick: (d: Date) => void;
  onClose: () => void;
  /** A second tap right after opening — treated as a double-tap on the title. */
  onQuickDismiss?: () => void;
}

/** Compact month calendar — Monday first, weekends dimmed. */
export default function DatePicker({
  visible,
  value,
  onPick,
  onClose,
  onQuickDismiss,
}: Props) {
  const { theme, t } = useSettings();
  const [month, setMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));

  // always open on the month of the day being shown
  useEffect(() => {
    if (visible) setMonth(new Date(value.getFullYear(), value.getMonth(), 1));
  }, [visible, value]);
  const s = makeStyles(theme);

  /* own open/close animation — the Modal's built-in fade is far too slow */
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;

  // while armed, any tap counts as the second half of a double-tap
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setArmed(true);
    const id = setTimeout(() => setArmed(false), 320);
    return () => clearTimeout(id);
  }, [visible]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: 90,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => finished && setMounted(false));
    }
  }, [visible, anim]);

  // six rows of seven, starting on the Monday of the week the 1st falls in
  const gridStart = startOfWeek(month);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = new Date();

  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  /* swipe the grid left/right to change month, same feel as the timetable */
  const tx = useRef(new Animated.Value(0)).current;
  const shiftRef = useRef(shift);
  shiftRef.current = shift;

  const settle = (to: number, done?: () => void) =>
    Animated.timing(tx, {
      toValue: to,
      duration: to === 0 ? 170 : 120,
      easing: to === 0 ? Easing.out(Easing.quad) : Easing.linear,
      useNativeDriver: true,
    }).start(({ finished }) => finished && done?.());

  const swipeMonth = (dir: 1 | -1) =>
    settle(-dir * HOP, () => {
      shiftRef.current(dir);
      tx.setValue(dir * HOP);
      settle(0);
    });

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderMove: (_, g) => tx.setValue(Math.max(-HOP, Math.min(HOP, g.dx * 0.45))),
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > 50 || Math.abs(g.vx) > 0.4) swipeMonth(g.dx < 0 ? 1 : -1);
        else settle(0);
      },
      onPanResponderTerminate: () => settle(0),
    }),
  ).current;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[s.backdrop, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {armed && onQuickDismiss && (
          <Pressable
            style={[StyleSheet.absoluteFill, { zIndex: 5 }]}
            onPress={onQuickDismiss}
          />
        )}
        <Animated.View
          style={[
            s.card,
            { transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }] },
          ]}
        >
          <View style={s.head}>
            <Pressable onPress={() => shift(-1)} style={s.navBtn}>
              <Text style={s.navTxt}>‹</Text>
            </Pressable>
            <Text style={s.title}>
              {t.months[month.getMonth()]} {month.getFullYear()}
            </Text>
            <Pressable onPress={() => shift(1)} style={s.navBtn}>
              <Text style={s.navTxt}>›</Text>
            </Pressable>
          </View>

          <View style={s.clip}>
          <Animated.View
            style={{ transform: [{ translateX: tx }] }}
            {...pan.panHandlers}
          >
          <View style={s.row}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <Text key={d} style={s.dow}>
                {t.daysShort[d]}
              </Text>
            ))}
          </View>

          {Array.from({ length: 6 }, (_, r) => (
            <View key={r} style={s.row}>
              {cells.slice(r * 7, r * 7 + 7).map((d) => {
                const inMonth = d.getMonth() === month.getMonth();
                const selected = isSameDay(d, value);
                const isToday = isSameDay(d, today);
                return (
                  <Pressable
                    key={d.toISOString()}
                    onPress={() => onPick(d)}
                    style={[s.cell, selected && { backgroundColor: theme.accent }]}
                  >
                    <Text
                      style={[
                        s.day,
                        !inMonth && { color: theme.textDim, opacity: 0.5 },
                        isWeekend(d) && !selected && { color: theme.textDim },
                        isToday && !selected && { color: theme.accent, fontWeight: '900' },
                        selected && { color: theme.accentText, fontWeight: '900' },
                      ]}
                    >
                      {d.getDate()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          </Animated.View>
          </View>

          <View style={s.foot}>
            <Pressable onPress={() => onPick(new Date())} style={s.footBtn}>
              <Text style={[s.footTxt, { color: theme.accent }]}>{t.today}</Text>
            </Pressable>
            <Pressable onPress={onClose} style={s.footBtn}>
              <Text style={s.footTxt}>{t.cancel}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (t: ReturnType<typeof useSettings>['theme']) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: '#000000aa',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: t.surface,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      padding: 14,
    },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: t.text, fontSize: 16, fontWeight: '800' },
    navBtn: { paddingHorizontal: 14, paddingVertical: 4 },
    navTxt: { color: t.accent, fontSize: 22, fontWeight: '800' },
    // keeps the month grid from sliding out over the card edges
    clip: { overflow: 'hidden', borderRadius: 10 },
    row: { flexDirection: 'row', marginTop: 6 },
    dow: {
      flex: 1,
      textAlign: 'center',
      color: t.textDim,
      fontSize: 11,
      fontWeight: '800',
    },
    cell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
    day: { color: t.text, fontSize: 14, fontWeight: '600' },
    foot: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
    footBtn: { paddingHorizontal: 14, paddingVertical: 8 },
    footTxt: { color: t.text, fontWeight: '700' },
  });
