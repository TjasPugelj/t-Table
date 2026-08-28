import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Lesson } from '../api/types';
import { fromMinutes } from '../api/untis';
import { cardSkin } from '../lib/colors';
import { displayRooms, displaySubject, displayTeachers } from '../lib/display';
import { cancelScheduled, scheduleReminder } from '../lib/notify';
import {
  DAY_OPTIONS,
  findReminder,
  KIND_ICON,
  MINUTE_OPTIONS,
  newId,
  Reminder,
  ReminderKind,
  reminderKey,
  lessonKey,
} from '../lib/reminders';
import { useSettings } from '../store/settings';

interface Props {
  lesson: Lesson | null;
  date: string; // YYYY-MM-DD
  onClose: () => void;
}

export default function LessonSheet({ lesson, date, onClose }: Props) {
  const { settings, theme, t, update } = useSettings();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const existing = lesson ? findReminder(settings.reminders, date, lesson) : undefined;

  const [kind, setKind] = useState<ReminderKind>('exam');
  const [note, setNote] = useState('');
  const [days, setDays] = useState<number[]>([1]);
  const [mins, setMins] = useState<number[]>([]);
  const [notify, setNotify] = useState(true);

  // reset the form whenever a different lesson is opened
  useEffect(() => {
    if (!lesson) return;
    setKind(existing?.kind ?? 'exam');
    setNote(existing?.note ?? '');
    setDays(existing?.daysBefore ?? [1]);
    setMins(existing?.minutesBefore ?? []);
    setNotify(existing?.notify ?? true);
  }, [lesson, date]);

  if (!lesson) return null;

  const skin = cardSkin(lesson, theme, settings);
  const kinds: ReminderKind[] = [
    'exam',
    'test',
    'homework',
    'project',
    'presentation',
    'material',
    'note',
  ];
  const kindLabel: Record<ReminderKind, string> = {
    exam: t.kindExam,
    test: t.kindTest,
    homework: t.kindHomework,
    project: t.kindProject,
    presentation: t.kindPresentation,
    material: t.kindMaterial,
    note: t.kindNote,
  };

  const toggleIn = (list: number[], v: number, set: (n: number[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort((a, b) => b - a));

  const save = async () => {
    const base: Reminder = {
      id: existing?.id ?? newId(),
      date,
      subject: lesson.subject,
      startMin: lesson.startMin,
      endMin: lesson.endMin,
      room: lesson.rooms.join(', '),
      kind,
      note,
      daysBefore: days,
      minutesBefore: mins,
      notify,
      scheduled: existing?.scheduled ?? [],
    };
    const scheduled = await scheduleReminder(base, settings.reminderHour);
    const saved: Reminder = { ...base, scheduled };
    const rest = settings.reminders.filter((r) => reminderKey(r) !== lessonKey(date, lesson));
    update({ reminders: [...rest, saved] });
    onClose();
  };

  const remove = async () => {
    if (existing) await cancelScheduled(existing.scheduled);
    update({
      reminders: settings.reminders.filter((r) => reminderKey(r) !== lessonKey(date, lesson)),
    });
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={s.sheet}>
          {/* ---- lesson ---- */}
          <View style={[s.head, { borderLeftColor: skin.stripeColor }]}>
            <Text style={s.subject}>{displaySubject(lesson, settings)}</Text>
            <Text style={s.time}>
              {fromMinutes(lesson.startMin)} – {fromMinutes(lesson.endMin)}
            </Text>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            {!!lesson.subjectLong && lesson.subjectLong !== lesson.subject && (
              <Text style={s.long}>{lesson.subjectLong}</Text>
            )}
            <Info label={t.teacherLabel} value={displayTeachers(lesson, settings).join(', ')} s={s} />
            <Info label={t.roomLabel} value={displayRooms(lesson, settings).join(', ')} s={s} />
            <Info label={t.groupLabel} value={lesson.groupLabel ?? ''} s={s} />
            <Info
              label={t.statusLabel}
              value={lesson.cancelled ? t.cancelledBadge : lesson.status}
              s={s}
            />
            {!!lesson.substitutionText && (
              <Text style={[s.note, { color: theme.changed }]}>{lesson.substitutionText}</Text>
            )}

            {/* ---- reminder ---- */}
            <Text style={s.section}>{t.reminder}</Text>

            <Text style={s.label}>{t.kind}</Text>
            <View style={s.chips}>
              {kinds.map((k) => (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  style={[s.chip, kind === k && { borderColor: theme.accent, borderWidth: 2 }]}
                >
                  <Text style={s.chipTxt}>
                    {KIND_ICON[k]} {kindLabel[k]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>{t.note}</Text>
            <TextInput
              style={s.input}
              value={note}
              onChangeText={setNote}
              placeholder={t.notePlaceholder}
              placeholderTextColor={theme.textDim}
              multiline
            />

            <Text style={s.label}>{t.daysAhead}</Text>
            <View style={s.chips}>
              {DAY_OPTIONS.map((d) => (
                <Pressable
                  key={d}
                  onPress={() => toggleIn(days, d, setDays)}
                  style={[
                    s.pill,
                    days.includes(d) && { backgroundColor: theme.accent, borderColor: theme.accent },
                  ]}
                >
                  <Text style={[s.pillTxt, days.includes(d) && { color: theme.accentText }]}>
                    {d === 0 ? t.sameDay : `${d}${t.dayShortSuffix}`}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>{t.minutesAhead}</Text>
            <View style={s.chips}>
              {MINUTE_OPTIONS.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => toggleIn(mins, m, setMins)}
                  style={[
                    s.pill,
                    mins.includes(m) && { backgroundColor: theme.accent, borderColor: theme.accent },
                  ]}
                >
                  <Text style={[s.pillTxt, mins.includes(m) && { color: theme.accentText }]}>
                    {m === 60 ? `1${t.hourShortSuffix}` : `${m}${t.minShortSuffix}`}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={s.row}>
              <Text style={[s.label, { flex: 1, marginTop: 0 }]}>{t.phoneNotification}</Text>
              <Switch
                value={notify}
                onValueChange={setNotify}
                trackColor={{ true: theme.accent, false: theme.border }}
                thumbColor="#fff"
              />
            </View>

            <View style={s.actions}>
              <Pressable style={s.primary} onPress={save}>
                <Text style={s.primaryTxt}>{existing ? t.save : t.addReminder}</Text>
              </Pressable>
              {!!existing && (
                <Pressable style={s.ghost} onPress={remove}>
                  <Text style={[s.ghostTxt, { color: theme.cancelled }]}>{t.removeReminder}</Text>
                </Pressable>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Info({ label, value, s }: { label: string; value: string; s: any }) {
  if (!value) return null;
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (t: ReturnType<typeof useSettings>['theme']) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
    sheet: {
      maxHeight: '88%',
      backgroundColor: t.bg,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      padding: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
    },
    head: { borderLeftWidth: 5, paddingLeft: 10, marginBottom: 10 },
    subject: { color: t.text, fontSize: 24, fontWeight: '800' },
    time: { color: t.textDim, fontSize: 14, marginTop: 2 },
    long: { color: t.textDim, fontSize: 13, marginBottom: 6 },
    infoRow: { flexDirection: 'row', paddingVertical: 4, gap: 10 },
    infoLabel: { color: t.textDim, fontSize: 13, width: 84 },
    infoValue: { color: t.text, fontSize: 14, flex: 1, fontWeight: '600' },
    note: { fontSize: 13, marginTop: 6, fontStyle: 'italic' },
    section: {
      color: t.textDim,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginTop: 18,
    },
    label: { color: t.textDim, fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 6 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.surface,
    },
    chipTxt: { color: t.text, fontSize: 13, fontWeight: '600' },
    pill: {
      minWidth: 46,
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.surface,
    },
    pillTxt: { color: t.text, fontSize: 13, fontWeight: '700' },
    input: {
      backgroundColor: t.surface,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: t.text,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      minHeight: 44,
    },
    row: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 12 },
    actions: { marginTop: 18, gap: 8 },
    primary: {
      backgroundColor: t.accent,
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: 'center',
    },
    primaryTxt: { color: t.accentText, fontWeight: '800', fontSize: 15 },
    ghost: {
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
    },
    ghostTxt: { color: t.text, fontWeight: '700' },
  });
