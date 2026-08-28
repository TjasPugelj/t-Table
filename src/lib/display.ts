import { Lesson } from '../api/types';
import { Settings } from '../store/settings';

export type NameVariant = 'day' | 'week';

/** Week names fall back to day names, which fall back to what Untis sent. */
const alias = (
  s: Settings,
  kind: 'subjects' | 'teachers' | 'rooms',
  name: string,
  variant: NameVariant,
): string => {
  if (variant === 'week') {
    const w = s.aliasesWeek?.[kind]?.[name]?.trim();
    if (w) return w;
  }
  const d = s.aliases?.[kind]?.[name]?.trim();
  return d ? d : name;
};

export const displaySubject = (l: Lesson, s: Settings, variant: NameVariant = 'day'): string =>
  alias(s, 'subjects', l.subject, variant);

export const displayTeachers = (l: Lesson, s: Settings, variant: NameVariant = 'day'): string[] =>
  l.teachers.map((n) => alias(s, 'teachers', n, variant));

export const displayRooms = (l: Lesson, s: Settings, variant: NameVariant = 'day'): string[] =>
  l.rooms.map((n) => alias(s, 'rooms', n, variant));


/** Text for one card slot, already renamed for the view it will appear in. */
export function fieldText(
  l: Lesson,
  s: Settings,
  field: 'subject' | 'teacher' | 'room' | 'none',
  variant: NameVariant,
): string {
  switch (field) {
    case 'subject':
      return displaySubject(l, s, variant);
    case 'teacher':
      return displayTeachers(l, s, variant).join(', ');
    case 'room':
      return displayRooms(l, s, variant).join(', ');
    default:
      return '';
  }
}
