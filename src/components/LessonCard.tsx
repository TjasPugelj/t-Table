import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lesson } from '../api/types';
import { cardSkin, pickTextColor } from '../lib/colors';
import { fieldParts, FieldPart, fieldText, NameVariant } from '../lib/display';
import { Settings, subjectFlagList } from '../store/settings';
import StickyNote from './StickyNote';
import { Theme } from '../theme';

/**
 * Substitution text and info chips often repeat each other — show each once.
 * With a group filter on, the group tag ("2sk") is dropped: it is the same for
 * every lesson on screen and only steals room from the subject.
 */
export function lessonNote(lesson: Lesson, hideGroup = false): string {
  const seen = new Set<string>();
  const tag = (lesson.groupLabel ?? '').trim();
  for (const s of [lesson.substitutionText, ...lesson.info]) {
    const v = (s ?? '').trim();
    if (!v) continue;
    if (hideGroup && tag && v === tag) continue;
    seen.add(v);
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
  /** A group is already selected, so its tag is noise. */
  hideGroupLabel?: boolean;
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
  hideGroupLabel = false,
}: Props) {
  const skin = cardSkin(lesson, theme, settings);
  const layout = settings.fields[variant];
  const main = fieldText(lesson, settings, layout.main, variant);
  const right = fieldText(lesson, settings, layout.right, variant);
  const sub = fieldText(lesson, settings, layout.sub, variant);
  const mainParts = fieldParts(lesson, settings, layout.main, variant);
  const rightParts = fieldParts(lesson, settings, layout.right, variant);
  const subParts = fieldParts(lesson, settings, layout.sub, variant);

  /** Names Untis struck out are drawn struck out; the rest render as before. */
  const renderParts = (parts: FieldPart[], fallback: string) => {
    if (!parts.some((p) => p.struck)) return fallback;
    return parts.map((p, i) => (
      <Text key={`${p.text}-${i}`} style={p.struck ? styles.struck : undefined}>
        {p.text}
        {i < parts.length - 1 ? ', ' : ''}
      </Text>
    ));
  };
  const note = lessonNote(lesson, hideGroupLabel);
  const flags = subjectFlagList(settings, lesson.subject);
  const tiny = dense || settings.compact;
  // width of the right-hand column, so the ribbon can sit just left of it
  const [rightW, setRightW] = useState(0);

  const card = (
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
        {!!main && (
          <Text
            style={[
              styles.subject,
              {
                fontSize: settings.mainSize,
                color: pickTextColor(settings.textColorMain, skin.text),
                textDecorationLine: lesson.cancelled ? 'line-through' : 'none',
              },
            ]}
            numberOfLines={2}
          >
            {renderParts(mainParts, main)}
          </Text>
        )}

        {!!sub && (
          <Text
            style={[
              styles.teacher,
              { fontSize: settings.subSize, color: pickTextColor(settings.textColorSub, skin.dim) },
            ]}
            numberOfLines={1}
          >
            {renderParts(subParts, sub)}
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

      {!!right && (
        <View
          onLayout={(e) => setRightW(e.nativeEvent.layout.width)}
          style={[
            styles.rightBox,
            settings.rightAlign === 'top' && { justifyContent: 'flex-start', paddingTop: 10 },
            settings.rightAlign === 'bottom' && { justifyContent: 'flex-end', paddingBottom: 10 },
          ]}
        >
          <View style={styles.rightRow}>
            {!!right && (
              <Text
                style={[
                  styles.room,
                  {
                    color: pickTextColor(settings.textColorRight, skin.dim),
                    fontSize: settings.roomSize,
                  },
                ]}
                numberOfLines={1}
              >
                {renderParts(rightParts, right)}
              </Text>
            )}
          </View>
        </View>
      )}
    </View>
  );

  if (!flags.length) return card;

  return (
    <View style={fill ? styles.fill : undefined}>
      {card}
      <View
        pointerEvents="none"
        style={[styles.flagCol, { right: (right ? rightW : 0) + 4 }]}
      >
        {flags.map((f) => (
          <StickyNote
            key={f}
            color={f}
            size={Math.round(settings.roomSize * 1.1)}
            bg={skin.background}
            notch={false}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  struck: { textDecorationLine: 'line-through' },
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
  rightBox: { justifyContent: 'center', paddingHorizontal: 10, maxWidth: '52%' },
  rightRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  flagCol: { position: 'absolute', top: 0, zIndex: 6, flexDirection: 'row', gap: 3 },
  subject: { fontWeight: '700', flexShrink: 1 },
  room: { fontWeight: '700', textAlign: 'right' },
  teacher: { marginTop: 2 },
  note: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  badge: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 4 },
});
