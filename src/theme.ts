export interface Theme {
  name: string;
  dark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentText: string;
  cancelled: string;
  changed: string;
  exam: string;
}

const dark: Theme = {
  name: 'Dark',
  dark: true,
  bg: '#0e1116',
  surface: '#171b22',
  surfaceAlt: '#1e242d',
  border: '#2a323d',
  text: '#e7ecf3',
  textDim: '#8b96a5',
  accent: '#4c8dff',
  accentText: '#ffffff',
  cancelled: '#ff6b6b',
  changed: '#ffb84d',
  exam: '#c084fc',
};

const light: Theme = {
  name: 'Light',
  dark: false,
  bg: '#f5f7fa',
  surface: '#ffffff',
  surfaceAlt: '#eef1f6',
  border: '#dde3ec',
  text: '#131820',
  textDim: '#66707e',
  accent: '#2563eb',
  accentText: '#ffffff',
  cancelled: '#dc2626',
  changed: '#c2740a',
  exam: '#7c3aed',
};

const midnight: Theme = {
  ...dark,
  name: 'Midnight',
  bg: '#08080c',
  surface: '#101018',
  surfaceAlt: '#171722',
  border: '#242435',
  accent: '#8b5cf6',
};

const paper: Theme = {
  ...light,
  name: 'Paper',
  bg: '#faf7f0',
  surface: '#fffdf8',
  surfaceAlt: '#f2ede2',
  border: '#e3dbca',
  accent: '#b45309',
};

export const THEMES: Record<string, Theme> = { dark, light, midnight, paper };

export const ACCENTS = [
  '#4c8dff',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
];

export function buildTheme(key: string, accent: string | null): Theme {
  const base = THEMES[key] ?? THEMES.dark;
  return accent ? { ...base, accent } : base;
}
