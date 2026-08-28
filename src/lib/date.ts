import { dict, Lang } from './i18n';

export const iso = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const parseISO = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (d: Date, n: number): Date => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

/** Monday of the week containing d. */
export const startOfWeek = (d: Date): Date => {
  const c = new Date(d);
  const day = (c.getDay() + 6) % 7; // Mon = 0
  c.setDate(c.getDate() - day);
  c.setHours(0, 0, 0, 0);
  return c;
};

export const isWeekend = (d: Date): boolean => d.getDay() === 0 || d.getDay() === 6;

/** Next weekday if d falls on a weekend, otherwise d. */
export const skipWeekend = (d: Date, dir: 1 | -1 = 1): Date => {
  let c = new Date(d);
  while (isWeekend(c)) c = addDays(c, dir);
  return c;
};

export const isSameDay = (a: Date, b: Date): boolean => iso(a) === iso(b);

export const dayShort = (d: Date, lang: Lang): string => dict(lang).daysShort[d.getDay()];

export const formatDayLabel = (d: Date, lang: Lang): string => {
  const t = dict(lang);
  const today = new Date();
  if (isSameDay(d, today)) return t.today;
  if (isSameDay(d, addDays(today, 1))) return t.tomorrow;
  if (isSameDay(d, addDays(today, -1))) return t.yesterday;
  return t.daysLong[d.getDay()];
};

export const formatDate = (d: Date, lang: Lang): string =>
  lang === 'en'
    ? `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`
    : `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;

export const nowMinutes = (): number => {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
};
