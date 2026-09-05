import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PasswordAuth } from '../api/passwordAuth';
import { SessionAuth } from '../api/qrAuth';
import { UntisClient } from '../api/untis';
import { useAccount } from '../store/account';
import { SchoolTab, useSchoolData } from '../store/schoolData';
import { useSettings } from '../store/settings';
import { Theme } from '../theme';

type Tab = SchoolTab;

/** One list entry, flattened so filtering doesn't care which tab it came from. */
interface Row {
  key: string;
  /** ISO date used by the month filter. */
  date: string;
  /** Subject used by the subject filter — empty when the tab has none. */
  subject: string;
  /** Everything the text search looks through. */
  haystack: string;
  node: React.ReactNode;
}

export default function SchoolScreen({
  onClose,
  onOpenDate,
}: {
  onClose: () => void;
  /** Jump the timetable to this ISO date and close this screen. */
  onOpenDate: (iso: string) => void;
}) {
  const { theme, t } = useSettings();
  const { account } = useAccount();
  const { data, loading: loadingMap, errors, load: loadTab } = useSchoolData();
  const [tab, setTab] = useState<Tab>('homework');
  // kept apart from the store's loading flag: bound to RefreshControl, this must
  // only be true for an actual pull, or the platform spinner shows on open too
  const [refreshing, setRefreshing] = useState(false);
  const loading = loadingMap[tab];
  const error = errors[tab];
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<null | 'month' | 'subject'>(null);

  const s = useMemo(() => makeStyles(theme), [theme]);

  const client = useMemo(() => {
    if (!account) return null;
    const auth =
      account.method === 'password'
        ? new PasswordAuth(account.host, account.school, account.user, account.password!)
        : new SessionAuth(account.host, account.school, account.user, account.secret!);
    return new UntisClient({ host: account.host, school: account.school }, auth);
  }, [account]);

  const load = useCallback(
    (which: Tab, force = false) => {
      if (!client || !account) return;
      loadTab(which, client, account, force);
    },
    [client, account, loadTab],
  );

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  const onPull = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(tab, true);
    } finally {
      setRefreshing(false);
    }
  }, [load, tab]);

  // filters belong to the tab that set them
  useEffect(() => {
    setQuery('');
    setMonth(null);
    setSubject(null);
    setOpenMenu(null);
  }, [tab]);

  const fmtDate = (isoStr: string) => {
    if (!isoStr || isoStr.length < 10) return isoStr;
    const [y, m, d] = isoStr.split('-');
    return `${Number(d)}. ${Number(m)}. ${y}`;
  };

  /* ---------------------------------------------------------------- */
  /* Rows                                                              */
  /* ---------------------------------------------------------------- */

  const rows: Row[] | null = useMemo(() => {
    if (tab === 'homework') {
      if (!data.homework) return null;
      return data.homework.map((h, i) => ({
        key: `hw-${h.id}-${h.dueDate}-${i}`,
        date: h.dueDate,
        subject: h.subject,
        haystack: `${h.subject} ${h.text} ${h.remark}`.toLowerCase(),
        node: (
          <View style={s.card}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>{h.subject || '—'}</Text>
              <Text style={s.cardMeta}>
                {t.dueOn} {fmtDate(h.dueDate)}
              </Text>
            </View>
            <Text style={[s.cardBody, h.completed && s.done]}>{h.text}</Text>
            {!!h.remark && <Text style={s.cardSub}>{h.remark}</Text>}
          </View>
        ),
      }));
    }

    if (tab === 'exams') {
      if (!data.exams) return null;
      return data.exams.map((e, i) => {
        return {
          key: `ex-${e.id}-${e.date}-${e.start}-${i}`,
          date: e.date,
          subject: e.subject,
          haystack: `${e.subject} ${e.name} ${e.text} ${e.teachers.join(' ')} ${e.rooms.join(
            ' ',
          )}`.toLowerCase(),
          node: (
            <Pressable style={s.card} onPress={() => onOpenDate(e.date)}>
              <View style={s.cardHead}>
                <Text style={s.cardTitle}>{e.subject || e.name || '—'}</Text>
                <Text style={s.cardMeta}>{fmtDate(e.date)}</Text>
              </View>
              <Text style={s.cardSub}>
                {e.start}–{e.end}
                {e.rooms.length ? ` · ${e.rooms.join(', ')}` : ''}
                {e.teachers.length ? ` · ${e.teachers.join(', ')}` : ''}
              </Text>
              {!!e.name && e.name !== e.subject && <Text style={s.cardBody}>{e.name}</Text>}
              {!!e.text && <Text style={s.cardBody}>{e.text}</Text>}
              {!!e.grade && (
                <Text style={s.grade}>
                  {t.gradeLabel}: {e.grade}
                </Text>
              )}
            </Pressable>
          ),
        };
      });
    }

    if (tab === 'absences') {
      if (!data.absences) return null;
      return data.absences.map((a, i) => ({
        key: `ab-${a.id}-${a.start}-${i}`,
        date: a.start,
        subject: '',
        haystack: `${a.reason} ${a.text} ${a.excuseStatus}`.toLowerCase(),
        node: (
          <View style={s.card}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>
                {fmtDate(a.start)}
                {a.end && a.end !== a.start ? ` – ${fmtDate(a.end)}` : ''}
              </Text>
              <Text
                style={[
                  s.badge,
                  {
                    color: a.excused ? theme.accentText : '#fff',
                    backgroundColor: a.excused ? theme.accent : theme.cancelled,
                  },
                ]}
              >
                {a.excused ? t.excused : t.notExcused}
              </Text>
            </View>
            <Text style={s.cardSub}>
              {a.startTime}–{a.endTime}
              {a.reason ? ` · ${a.reason}` : ''}
            </Text>
            {!!a.text && <Text style={s.cardBody}>{a.text}</Text>}
          </View>
        ),
      }));
    }

    if (!data.messages) return null;
    return data.messages.map((m, i) => ({
      key: `ms-${m.id}-${i}`,
      date: m.sentAt.slice(0, 10),
      subject: '',
      haystack: `${m.subject} ${m.preview} ${m.sender}`.toLowerCase(),
      node: (
        <View style={[s.card, !m.read && { borderColor: theme.accent }]}>
          <View style={s.cardHead}>
            <Text style={s.cardTitle}>{m.subject || '—'}</Text>
            <Text style={s.cardMeta}>{m.sentAt.slice(0, 10)}</Text>
          </View>
          <Text style={s.cardSub}>{m.sender}</Text>
          {!!m.preview && <Text style={s.cardBody}>{m.preview}</Text>}
        </View>
      ),
    }));
  }, [tab, data, s, t, theme, onOpenDate]);

  /* ---------------------------------------------------------------- */
  /* Filters                                                           */
  /* ---------------------------------------------------------------- */

  const months = useMemo(() => {
    const seen = new Set<string>();
    (rows ?? []).forEach((r) => {
      if (r.date?.length >= 7) seen.add(r.date.slice(0, 7));
    });
    return [...seen].sort();
  }, [rows]);

  const subjects = useMemo(() => {
    const seen = new Set<string>();
    (rows ?? []).forEach((r) => {
      if (r.subject) seen.add(r.subject);
    });
    return [...seen].sort();
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (month && r.date.slice(0, 7) !== month) return false;
      if (subject && r.subject !== subject) return false;
      if (q && !r.haystack.includes(q)) return false;
      return true;
    });
  }, [rows, query, month, subject]);

  const monthLabel = (ym: string) => {
    const m = Number(ym.slice(5, 7)) - 1;
    return t.months[m] ?? ym;
  };

  const dropdown = (
    which: 'month' | 'subject',
    label: string,
    active: string | null,
    items: string[],
    setActive: (v: string | null) => void,
    render: (v: string) => string,
  ) => (
    <Pressable
      style={[s.dropdown, active !== null && { borderColor: theme.accent, borderWidth: 2 }]}
      onPress={() => setOpenMenu(openMenu === which ? null : which)}
    >
      <Text
        style={[s.dropdownTxt, active !== null && { color: theme.accent, fontWeight: '700' }]}
        numberOfLines={1}
      >
        {active === null ? label : render(active)}
      </Text>
      <Text style={s.caret}>{openMenu === which ? '▲' : '▼'}</Text>
    </Pressable>
  );

  const menuList = (
    items: string[],
    active: string | null,
    setActive: (v: string | null) => void,
    render: (v: string) => string,
  ) => (
    <View style={s.menu}>
      <ScrollView nestedScrollEnabled style={{ maxHeight: 260 }}>
        <Pressable
          onPress={() => {
            setActive(null);
            setOpenMenu(null);
          }}
          style={s.menuItem}
        >
          <Text style={[s.menuTxt, active === null && { color: theme.accent, fontWeight: '800' }]}>
            {t.groupAll}
          </Text>
        </Pressable>
        {items.map((v) => (
          <Pressable
            key={v}
            onPress={() => {
              setActive(v);
              setOpenMenu(null);
            }}
            style={s.menuItem}
          >
            <Text style={[s.menuTxt, active === v && { color: theme.accent, fontWeight: '800' }]}>
              {render(v)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );

  const tabs: [Tab, string][] = [
    ['homework', t.tabHomework],
    ['exams', t.tabExams],
    ['absences', t.tabAbsences],
    ['messages', t.tabMessages],
  ];

  const emptyText =
    tab === 'homework'
      ? t.noHomework
      : tab === 'exams'
        ? t.noExams
        : tab === 'absences'
          ? t.noAbsences
          : t.noMessages;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>{t.sectionSchoolData}</Text>
        <Pressable onPress={onClose} style={s.closeBtn}>
          <Text style={s.closeTxt}>{t.back}</Text>
        </Pressable>
      </View>

      <View style={s.tabs}>
        {tabs.map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            style={[s.tab, tab === key && { borderColor: theme.accent, borderWidth: 2 }]}
          >
            <Text style={[s.tabTxt, tab === key && { color: theme.accent }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {!account ? (
        <Text style={s.empty}>{t.loginNeeded}</Text>
      ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 10 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onPull}
                tintColor={theme.accent}
                colors={[theme.accent]}
                progressBackgroundColor={theme.surface}
              />
            }
          >
            {/* Filters scroll away with the list rather than sitting pinned above it */}
            {!!rows?.length && (
              <View style={s.filters}>
                <View style={s.filterRow}>
                  <View style={{ flex: 2 }}>
                    <TextInput
                      style={s.search}
                      value={query}
                      onChangeText={setQuery}
                      placeholder={t.searchPlaceholder}
                      placeholderTextColor={theme.textDim}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                  {months.length > 1 && (
                    <View style={{ flex: 1 }}>
                      {dropdown('month', t.filterMonth, month, months, setMonth, monthLabel)}
                    </View>
                  )}
                </View>
                {openMenu === 'month' && menuList(months, month, setMonth, monthLabel)}
                {subjects.length > 1 &&
                  dropdown('subject', t.filterSubject, subject, subjects, setSubject, (v) => v)}
                {openMenu === 'subject' && menuList(subjects, subject, setSubject, (v) => v)}
              </View>
            )}

            {!!error && (
              <Pressable onPress={() => load(tab, true)} style={s.errorBox}>
                <Text style={s.errorTxt}>{error}</Text>
                <Text style={s.errorHint}>{t.tapRetry}</Text>
              </Pressable>
            )}

            {loading && rows === null && (
              <ActivityIndicator size="large" color={theme.accent} style={{ marginTop: 12 }} />
            )}

            {visible.map((r) => (
              <View key={r.key}>{r.node}</View>
            ))}

            {rows !== null && visible.length === 0 && (
              <Text style={s.empty}>{rows.length ? t.noResults : emptyText}</Text>
            )}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    title: { color: t.text, fontSize: 24, fontWeight: '800' },
    closeBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: t.accent,
    },
    closeTxt: { color: t.accentText, fontWeight: '700' },
    tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 4 },
    tab: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 10,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.surfaceAlt,
    },
    tabTxt: { color: t.text, fontWeight: '700', fontSize: 12 },
    filters: { gap: 6, marginBottom: 2 },
    search: {
      backgroundColor: t.surfaceAlt,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      color: t.text,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
    },
    filterRow: { flexDirection: 'row', gap: 8 },
    dropdown: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.surfaceAlt,
    },
    dropdownTxt: { color: t.text, fontSize: 13, flex: 1 },
    caret: { color: t.textDim, fontSize: 11 },
    menu: {
      marginTop: 2,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.surfaceAlt,
    },
    menuItem: { paddingVertical: 11, paddingHorizontal: 14 },
    menuTxt: { color: t.text, fontSize: 14, fontWeight: '600' },
    card: {
      backgroundColor: t.surface,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      padding: 12,
      gap: 4,
    },
    cardHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    cardTitle: { color: t.text, fontWeight: '800', fontSize: 15, flex: 1 },
    cardMeta: { color: t.textDim, fontSize: 12, fontWeight: '600' },
    cardSub: { color: t.textDim, fontSize: 12 },
    cardBody: { color: t.text, fontSize: 14, lineHeight: 19 },
    done: { textDecorationLine: 'line-through', color: t.textDim },
    grade: { color: t.accent, fontWeight: '800', fontSize: 14, marginTop: 2 },
    badge: {
      fontSize: 11,
      fontWeight: '800',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
      overflow: 'hidden',
    },
    empty: { color: t.textDim, fontSize: 14, textAlign: 'center', padding: 24 },
    errorBox: {
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cancelled,
      padding: 12,
    },
    errorTxt: { color: t.cancelled, fontSize: 13 },
    errorHint: { color: t.textDim, fontSize: 12, marginTop: 2 },
  });
