import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lesson } from '../api/types';
import { cardSkin } from '../lib/colors';
import { fieldText, NameVariant } from '../lib/display';
import { Settings } from '../store/settings';
import { Theme } from '../theme';

/** Substitution text and info chips often repeat each other — show each once. */
export function lessonNote(lesson: Lesson): string {
  const seen = new Set<string>();
  for (const s of [lesson.substitutionText, ...lesson.info]) {
    const v = (s ?? '').trim();
    if (v) seen.add(v);
  }
  return [...seen].join(' · ');
}

interface Props {
  lesson: Lesson;
  theme: Theme;
  settings: Settings;
  cancelledLabel: string;
  /** Which view's field layout and names to use. */
  variant?: NameVariant;
  /** Fill the parent instead of sizing to content — used by the fit-to-screen day view. */
  fill?: boolean;
  /** Tighter type for narrow boxes. */
  dense?: boolean;
  /** 0..1 — how much of this lesson is already over (null = not the current one). */
  progress?: number | null;
  /** Already finished earlier today. */
  past?: boolean;
  /** Reminder icon, drawn in the corner. */
  badge?: string | null;
}

export default function LessonCard({
  lesson,
  theme,
  settings,
  cancelledLabel,
  variant = 'day',
  fill,
  dense,
  progress = null,
  past = false,
  badge = null,
}: Props) {
  const skin = cardSkin(lesson, theme, settings);
  const layout = settings.fields[variant];
  const main = fieldText(lesson, settings, layout.main, variant);
  const right = fieldText(lesson, settings, layout.right, variant);
  const sub = fieldText(lesson, settings, layout.sub, variant);
  const note = lessonNote(lesson);
  const tiny = dense || settings.compact;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: skin.background,
          borderColor: skin.border,
          borderWidth: skin.borderWidth,
          opacity: (lesson.cancelled ? 0.6 : 1) * (past ? 0.45 : 1),
        },
        fill ? styles.fill : { paddingVertical: tiny ? 6 : 12 },
      ]}
    >
      {skin.stripe > 0 && (
        <View style={{ width: skin.stripe, backgroundColor: skin.stripeColor }} />
      )}
      {progress !== null && progress > 0 && progress < 1 && (
        <View
          pointerEvents="none"
          style={[styles.remaining, { top: `${Math.round(progress * 100)}%` }]}
        />
      )}
      {!!badge && (
        <Text style={[styles.badgeIcon, { fontSize: settings.badgeSize }]}>{badge}</Text>
      )}
      <View style={[styles.body, fill && styles.bodyFill]}>
        <View style={styles.row}>
          {!!main && (
            <Text
              style={[
                styles.subject,
                tiny && styles.subjectTiny,
                {
                  color: skin.text,
                  textDecorationLine: lesson.cancelled ? 'line-through' : 'none',
                },
              ]}
              numberOfLines={1}
            >
              {main}
            </Text>
          )}
          {!!right && (
            <Text
              style={[styles.room, tiny && styles.roomTiny, { color: skin.dim }]}
              numberOfLines={1}
            >
              {right}
            </Text>
          )}
        </View>

        {!!sub && (
          <Text
            style={[styles.teacher, tiny && styles.teacherTiny, { color: skin.dim }]}
            numberOfLines={1}
          >
            {sub}
          </Text>
        )}

        {!tiny && !!note && (
          <Text
            style={[
              styles.note,
              {
                color:
                  settings.cardStyle === 'solid'
                    ? skin.dim
                    : lesson.cancelled
                      ? theme.cancelled
                      : theme.changed,
              },
            ]}
            numberOfLines={2}
          >
            {note}
          </Text>
        )}

        {!tiny && lesson.cancelled && (
          <Text
            style={[
              styles.badge,
              { color: settings.cardStyle === 'solid' ? skin.text : theme.cancelled },
            ]}
          >
            {cancelledLabel}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: 12,
    overflow: 'hidden',
  },
  fill: { flex: 1 },
  // shades the part of the current lesson that is still to come
  remaining: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.34)',
    zIndex: 2,
  },
  badgeIcon: { position: 'absolute', right: 4, bottom: 2, zIndex: 3, includeFontPadding: false },
  body: { flex: 1, paddingHorizontal: 10 },
  bodyFill: { justifyContent: 'center', paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 },
  subject: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  subjectTiny: { fontSize: 13 },
  room: { fontSize: 13, fontWeight: '600' },
  roomTiny: { fontSize: 11 },
  teacher: { fontSize: 13, marginTop: 2 },
  teacherTiny: { fontSize: 10, marginTop: 0 },
  note: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  badge: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 4 },
});
