import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ClassEntry } from '../api/types';
import { AnonymousAuth, UntisClient } from '../api/untis';
import Slider from '../components/Slider';
import { cancelScheduled, scheduledCount, sendTestNotification } from '../lib/notify';
import { SUBJECT_COLORS, subjectColor } from '../lib/colors';
import { LANGUAGES } from '../lib/i18n';
import { DAY_OPTIONS } from '../lib/reminders';
import LinkAccountScreen from './LinkAccountScreen';
import { useAccount } from '../store/account';
import { DEFAULT_PERIODS, Settings, subjectKey, useSettings } from '../store/settings';
import { ACCENTS, Theme, THEMES } from '../theme';

export default function SettingsScreen({ onClose }: { onClose: () => void }) {
  const { settings, theme, t, update, reset } = useSettings();
  const { account, unlink } = useAccount();
  const [linkOpen, setLinkOpen] = useState(false);
  const [classes, setClasses] = useState<ClassEntry[] | null>(null);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [classError, setClassError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [devMsg, setDevMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [groupOpen, setGroupOpen] = useState<string | null>(null);
  // the long lists are what made this screen slow to open — keep them folded
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (k: string) => !!open[k];
  const toggleSection = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const s = useMemo(() => makeStyles(theme), [theme]);

  const foldHeader = (k: string, label: string) => (
    <Pressable onPress={() => toggleSection(k)} style={s.foldHead}>
      <Text style={s.section}>{label}</Text>
      <Text style={s.foldSign}>{isOpen(k) ? '−' : '+'}</Text>
    </Pressable>
  );

  const client = useMemo(
    () =>
      new UntisClient(
        { host: settings.host, school: settings.school },
        new AnonymousAuth(settings.school),
      ),
    [settings.host, settings.school],
  );

  const loadClasses = async () => {
    setLoadingClasses(true);
    setClassError(null);
    try {
      setClasses(await client.classes());
    } catch (e: any) {
      setClassError(e?.message ?? t.error);
    } finally {
      setLoadingClasses(false);
    }
  };

  const filtered = (classes ?? []).filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.class.shortName.toLowerCase().includes(q) ||
      c.class.longName.toLowerCase().includes(q) ||
      (c.department?.shortName ?? '').toLowerCase().includes(q)
    );
  });

  const toggle = (key: keyof Settings, label: string) => (
    <View style={s.row} key={key}>
      <Text style={[s.rowLabel, { flex: 1 }]}>{label}</Text>
      <Switch
        value={settings[key] as boolean}
        onValueChange={(v) => update({ [key]: v } as Partial<Settings>)}
        trackColor={{ true: theme.accent, false: theme.border }}
        thumbColor="#fff"
      />
    </View>
  );

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>{t.settings}</Text>
        <Pressable onPress={onClose} style={s.closeBtn}>
          <Text style={s.closeTxt}>{t.done}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {/* ---- Language ---- */}
        <Text style={s.section}>{t.language}</Text>
        <View style={s.card}>
          <View style={s.chips}>
            {LANGUAGES.map((l) => (
              <Pressable
                key={l.key}
                onPress={() => update({ lang: l.key })}
                style={[
                  s.chip,
                  settings.lang === l.key && { borderColor: theme.accent, borderWidth: 2 },
                ]}
              >
                <Text style={s.chipTxt}>{l.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ---- School ---- */}
        {foldHeader('school', t.sectionSchool)}
        {isOpen('school') && (
        <View style={s.card}>
            <Text style={s.fieldLabel}>{t.server}</Text>
            <TextInput
              style={s.input}
              value={settings.host}
              autoCapitalize="none"
              onChangeText={(v) => update({ host: v.trim() })}
              placeholder="sc-celje.webuntis.com"
              placeholderTextColor={theme.textDim}
            />
            <Text style={s.fieldLabel}>{t.schoolKey}</Text>
            <TextInput
              style={s.input}
              value={settings.school}
              autoCapitalize="none"
              onChangeText={(v) => update({ school: v.trim() })}
              placeholder="sc-celje"
              placeholderTextColor={theme.textDim}
            />
          </View>
        )}

        {/* ---- Account ---- */}
        {foldHeader('account', t.sectionAccount)}
        {isOpen('account') && (
        <View style={s.card}>
            {account ? (
              <>
                <Text style={s.current}>
                  {t.accountLinkedAs} {account.displayName}
                </Text>
                <Text style={s.rowHint}>{account.host}</Text>
                <Pressable
                  style={s.btnGhost}
                  onPress={() =>
                    Alert.alert(t.unlinkAccount, t.unlinkConfirm, [
                      { text: t.cancel, style: 'cancel' },
                      { text: t.unlinkAccount, style: 'destructive', onPress: () => unlink() },
                    ])
                  }
                >
                  <Text style={[s.btnGhostTxt, { color: theme.cancelled }]}>{t.unlinkAccount}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={s.rowHint}>{t.accountHint}</Text>
                <Pressable style={s.btn} onPress={() => setLinkOpen(true)}>
                  <Text style={s.btnTxt}>{t.linkAccount}</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {/* ---- Class ---- */}
        {foldHeader('class', t.sectionClass)}
        {isOpen('class') && (
        <View style={s.card}>
            <Text style={s.current}>
              {settings.className} · ID {settings.classId}
            </Text>

            {classes === null ? (
              <Pressable style={s.btn} onPress={loadClasses} disabled={loadingClasses}>
                {loadingClasses ? (
                  <ActivityIndicator color={theme.accentText} />
                ) : (
                  <Text style={s.btnTxt}>{t.loadClasses}</Text>
                )}
              </Pressable>
            ) : (
              <>
                <TextInput
                  style={s.input}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t.searchClass}
                  placeholderTextColor={theme.textDim}
                  autoCapitalize="none"
                />
                <View style={{ maxHeight: 320 }}>
                  <ScrollView nestedScrollEnabled>
                    {filtered.map((c) => {
                      const active = c.class.id === settings.classId;
                      return (
                        <Pressable
                          key={c.class.id}
                          onPress={() =>
                            update({ classId: c.class.id, className: c.class.shortName })
                          }
                          style={[s.classRow, active && { borderColor: theme.accent }]}
                        >
                          <Text style={[s.className, active && { color: theme.accent }]}>
                            {c.class.shortName}
                          </Text>
                          <Text style={s.classLong} numberOfLines={1}>
                            {c.class.longName}
                          </Text>
                          <Text style={s.classDept}>{c.department?.shortName ?? ''}</Text>
                        </Pressable>
                      );
                    })}
                    {filtered.length === 0 && <Text style={s.rowHint}>{t.noResults}</Text>}
                  </ScrollView>
                </View>
              </>
            )}
            {!!classError && <Text style={s.err}>{classError}</Text>}
          </View>
        )}

        {/* ---- Appearance ---- */}
        {foldHeader('appearance', t.sectionAppearance)}
        {isOpen('appearance') && (
        <View style={s.card}>
            <Text style={s.fieldLabel}>{t.theme}</Text>
            <View style={s.chips}>
              {Object.entries(THEMES).map(([key, th]) => (
                <Pressable
                  key={key}
                  onPress={() => update({ themeKey: key })}
                  style={[
                    s.chip,
                    settings.themeKey === key && { borderColor: theme.accent, borderWidth: 2 },
                  ]}
                >
                  <View style={[s.swatch, { backgroundColor: th.bg, borderColor: th.border }]} />
                  <Text style={s.chipTxt}>{th.name}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.fieldLabel}>{t.accent}</Text>
            <View style={s.chips}>
              <Pressable
                onPress={() => update({ accent: null })}
                style={[
                  s.dot,
                  { backgroundColor: THEMES[settings.themeKey]?.accent ?? '#4c8dff' },
                  settings.accent === null && s.dotActive,
                ]}
              />
              {ACCENTS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => update({ accent: c })}
                  style={[s.dot, { backgroundColor: c }, settings.accent === c && s.dotActive]}
                />
              ))}
            </View>
          </View>
        )}

        {/* ---- Display ---- */}
        {foldHeader('display', t.sectionDisplay)}
        {isOpen('display') && (
        <View style={s.card}>
            {toggle('showAllPeriods', t.showAllPeriods)}
            {toggle('fitToScreen', t.fitToScreen)}
            {toggle('resetOnResume', t.resetOnResume)}
            {toggle('mergeDay', t.mergeDay)}
            {toggle('weekMerge', t.weekMerge)}

            <Text style={s.fieldLabel}>{t.rightAlign}</Text>
            <View style={s.chips}>
              {(
                [
                  ['top', t.alignTop],
                  ['center', t.alignCenter],
                  ['bottom', t.alignBottom],
                ] as const
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => update({ rightAlign: key })}
                  style={[
                    s.chip,
                    settings.rightAlign === key && { borderColor: theme.accent, borderWidth: 2 },
                  ]}
                >
                  <Text style={s.chipTxt}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldLabel, { fontSize: 13, color: theme.text }]}>{t.textColors}</Text>
            {(
              [
                ['textColorMain', t.mainSize],
                ['textColorRight', t.roomSize],
                ['textColorSub', t.subSize],
              ] as const
            ).map(([key, label]) => (
              <View key={key} style={s.sliderRow}>
                <Text style={s.sliderLabel}>{label}</Text>
                <View style={[s.chips, { flex: 1 }]}>
                  {(
                    [
                      ['auto', t.colorAuto],
                      ['black', t.colorBlack],
                      ['white', t.colorWhite],
                    ] as const
                  ).map(([mode, modeLabel]) => (
                    <Pressable
                      key={mode}
                      onPress={() => update({ [key]: mode } as Partial<Settings>)}
                      style={[
                        s.chip,
                        settings[key] === mode && { borderColor: theme.accent, borderWidth: 2 },
                      ]}
                    >
                      <Text style={s.chipTxt}>{modeLabel}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}

            <Text style={[s.fieldLabel, { fontSize: 13, color: theme.text }]}>{t.sectionSizes}</Text>
            {(
              [
                [t.sizesDay, 10, 28, [
                  ['mainSize', t.mainSize],
                  ['roomSize', t.roomSize],
                  ['subSize', t.subSize],
                ]],
                [t.sizesWeek, 6, 18, [
                  ['weekMainSize', t.mainSize],
                  ['weekSubSize', t.subSize],
                ]],
              ] as const
            ).map(([groupLabel, min, max, rows]) => (
              <View key={groupLabel} style={{ gap: 2, marginTop: 4 }}>
                <Text style={[s.fieldLabel, { color: theme.text }]}>{groupLabel}</Text>
                {rows.map(([key, label]) => (
                  <View key={key} style={s.sliderRow}>
                    <Text style={s.sliderLabel}>{label}</Text>
                    <View style={{ flex: 1 }}>
                      <Slider
                        value={settings[key]}
                        min={min}
                        max={max}
                        theme={theme}
                        onChange={(v) => update({ [key]: v } as Partial<Settings>)}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ))}

            <Text style={s.fieldLabel}>{t.weekRowHeight}</Text>
            <Slider
              value={settings.weekRowHeight}
              min={40}
              max={110}
              theme={theme}
              onChange={(v) => update({ weekRowHeight: v })}
            />

            <Text style={s.fieldLabel}>{t.badgeSize}</Text>
            <Slider
              value={settings.badgeSize}
              min={8}
              max={36}
              theme={theme}
              onChange={(v) => update({ badgeSize: v })}
            />

            <Text style={s.fieldLabel}>{t.colorSource}</Text>
            <View style={s.chips}>
              {(
                [
                  ['status', t.colorStatus],
                  ['subject', t.colorSubject],
                  ['untis', t.colorUntis],
                ] as const
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => update({ colorSource: key })}
                  style={[
                    s.chip,
                    settings.colorSource === key && { borderColor: theme.accent, borderWidth: 2 },
                  ]}
                >
                  <Text style={s.chipTxt}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.fieldLabel}>{t.cardStyle}</Text>
            <View style={s.chips}>
              {(
                [
                  ['stripe', t.cardStripe],
                  ['tint', t.cardTint],
                  ['solid', t.cardSolid],
                ] as const
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => update({ cardStyle: key })}
                  style={[
                    s.chip,
                    settings.cardStyle === key && { borderColor: theme.accent, borderWidth: 2 },
                  ]}
                >
                  <Text style={s.chipTxt}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {toggle('hideCancelled', t.hideCancelled)}
            {toggle('compact', t.compact)}
          </View>
        )}

        {/* ---- Current time ---- */}
        {foldHeader('now', t.sectionNow)}
        {isOpen('now') && (
        <View style={s.card}>
            {toggle('nowLine', t.nowLine)}
            <Text style={s.fieldLabel}>{t.nowLineColor}</Text>
            <View style={s.chips}>
              <Pressable
                onPress={() => update({ nowLineColor: null })}
                style={[
                  s.dot,
                  { backgroundColor: theme.accent },
                  settings.nowLineColor === null && s.dotActive,
                ]}
              />
              {ACCENTS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => update({ nowLineColor: c })}
                  style={[s.dot, { backgroundColor: c }, settings.nowLineColor === c && s.dotActive]}
                />
              ))}
            </View>
            {toggle('dimPast', t.dimPast)}
            {toggle('nowProgress', t.nowProgress)}
          </View>
        )}

        {/* ---- Substitution outline ---- */}
        {foldHeader('outline', t.changedOutline)}
        {isOpen('outline') && (
        <View style={s.card}>
            <Text style={s.fieldLabel}>{t.outlineWidth}</Text>
            <Slider
              value={settings.changedWidth}
              min={0.5}
              max={6}
              step={0.5}
              theme={theme}
              onChange={(v) => update({ changedWidth: v })}
              suffix={
                <View
                  style={{
                    width: 30,
                    height: 18,
                    borderRadius: 6,
                    borderWidth: settings.changedWidth,
                    borderColor: settings.changedColor ?? theme.changed,
                  }}
                />
              }
            />

            <View style={s.chips}>
              <Pressable
                onPress={() => update({ changedColor: null })}
                style={[
                  s.dot,
                  { backgroundColor: theme.changed },
                  settings.changedColor === null && s.dotActive,
                ]}
              />
              {ACCENTS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => update({ changedColor: c })}
                  style={[s.dot, { backgroundColor: c }, settings.changedColor === c && s.dotActive]}
                />
              ))}
            </View>
          </View>
        )}

        {/* ---- Field layout ---- */}
        {foldHeader('fields', t.sectionFields)}
        {isOpen('fields') && (
        <View style={s.card}>
            {(
              [
                ['day', t.renameDayCol],
                ['week', t.renameWeekCol],
              ] as const
            ).map(([view, viewLabel]) => (
              <View key={view} style={{ gap: 6, marginBottom: 6 }}>
                <Text style={[s.fieldLabel, { fontSize: 13, color: theme.text }]}>{viewLabel}</Text>
                {(
                  view === 'week'
                    ? ([
                        ['main', t.fieldMain],
                        ['sub', t.fieldSub],
                      ] as const)
                    : ([
                        ['main', t.fieldMain],
                        ['right', t.fieldRight],
                        ['sub', t.fieldSub],
                      ] as const)
                ).map(([slot, slotLabel]) => (
                  <View key={slot} style={{ gap: 4 }}>
                    <Text style={s.fieldLabel}>{slotLabel}</Text>
                    <View style={s.chips}>
                      {(
                        [
                          ['subject', t.fSubject],
                          ['teacher', t.fTeacher],
                          ['room', t.fRoom],
                          ['none', t.fNone],
                        ] as const
                      ).map(([f, fLabel]) => (
                        <Pressable
                          key={f}
                          onPress={() =>
                            update({
                              fields: {
                                ...settings.fields,
                                [view]: { ...settings.fields[view], [slot]: f },
                              },
                            })
                          }
                          style={[
                            s.chip,
                            settings.fields[view][slot] === f && {
                              borderColor: theme.accent,
                              borderWidth: 2,
                            },
                          ]}
                        >
                          <Text style={s.chipTxt}>{fLabel}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* ---- Subject colours ---- */}
        {foldHeader('groups', t.sectionGroups)}
        {isOpen('groups') && (
        <View style={s.card}>
          <Text style={s.rowHint}>{t.groupsHint}</Text>
          {settings.knownSubjects.length === 0 && (
            <Text style={s.rowHint}>{t.noSubjectsYet}</Text>
          )}
          {settings.knownSubjects.map((name) => {
            const groupKey = subjectKey(settings, name);
            const members = settings.knownSubjects.filter(
              (x) => x !== name && subjectKey(settings, x) === groupKey,
            );
            const open = groupOpen === name;
            return (
              <View key={name}>
                <View style={s.renameRow}>
                  <Text style={s.renameOrig} numberOfLines={1}>
                    {name}
                  </Text>
                  <Pressable
                    style={[s.input, s.dropdown]}
                    onPress={() => setGroupOpen(open ? null : name)}
                  >
                    <Text
                      style={{ color: members.length ? theme.text : theme.textDim, flex: 1 }}
                      numberOfLines={1}
                    >
                      {members.length ? [name, ...members].join(' + ') : groupKey}
                    </Text>
                    <Text style={{ color: theme.textDim }}>{open ? '▲' : '▼'}</Text>
                  </Pressable>
                </View>

                {open && (
                  <View style={s.dropdownList}>
                    <ScrollView nestedScrollEnabled style={{ maxHeight: 240 }}>
                      {settings.knownSubjects
                        .filter((x) => x !== name)
                        .map((opt) => {
                          const joined = subjectKey(settings, opt) === groupKey;
                          return (
                            <Pressable
                              key={opt}
                              onPress={() => {
                                const next = { ...settings.subjectGroups };
                                // several subjects can join in one go — the list stays open
                                if (joined) delete next[opt];
                                else next[opt] = groupKey;
                                update({ subjectGroups: next });
                              }}
                              style={s.dropdownItem}
                            >
                              <Text
                                style={{
                                  color: joined ? theme.accent : theme.text,
                                  fontWeight: joined ? '800' : '500',
                                }}
                              >
                                {joined ? '✓ ' : '   '}
                                {opt}
                              </Text>
                            </Pressable>
                          );
                        })}

                      {members.length > 0 && (
                        <Pressable
                          onPress={() => {
                            const next = { ...settings.subjectGroups };
                            for (const m of members) delete next[m];
                            delete next[name];
                            update({ subjectGroups: next });
                            setGroupOpen(null);
                          }}
                          style={[s.dropdownItem, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}
                        >
                          <Text style={{ color: theme.cancelled, fontWeight: '700' }}>
                            {t.flagNone}
                          </Text>
                        </Pressable>
                      )}
                    </ScrollView>
                  </View>
                )}
              </View>
            );
          })}
        </View>
        )}

        {foldHeader('colors', t.sectionSubjectColors)}
        {isOpen('colors') && (
        <View style={s.card}>
          {settings.knownSubjects.length === 0 && (
            <Text style={s.rowHint}>{t.noSubjectsYet}</Text>
          )}
          {settings.knownSubjects.map((name) => {
            const key = subjectKey(settings, name);
            const picked = settings.subjectColors[key];
            return (
              <View key={name} style={s.subjRow}>
                <Text style={s.subjName} numberOfLines={1}>
                  {settings.aliases.subjects[name]?.trim() || name}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <Pressable
                    onPress={() => {
                      const next = { ...settings.subjectColors };
                      delete next[key];
                      update({ subjectColors: next });
                    }}
                    style={[
                      s.swatchDot,
                      { backgroundColor: subjectColor(key), opacity: 0.45 },
                      !picked && s.swatchActive,
                    ]}
                  />
                  {SUBJECT_COLORS.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() =>
                        update({ subjectColors: { ...settings.subjectColors, [key]: c } })
                      }
                      style={[
                        s.swatchDot,
                        { backgroundColor: c },
                        picked === c && s.swatchActive,
                      ]}
                    />
                  ))}
                </ScrollView>
              </View>
            );
          })}
        </View>
        )}

        {/* ---- Rename ---- */}
        {foldHeader('rename', t.sectionRename)}
        {isOpen('rename') && (
        <View style={s.card}>
          {(
            [
              ['subjects', t.renameSubjects, settings.knownSubjects],
              ['teachers', t.renameTeachers, settings.knownTeachers],
              ['rooms', t.renameRooms, settings.knownRooms],
            ] as const
          ).map(([key, label, names]) => (
            <View key={key} style={{ gap: 6 }}>
              <Text style={s.fieldLabel}>{label}</Text>
              {names.length === 0 && <Text style={s.rowHint}>{t.noSubjectsYet}</Text>}
              <View style={s.renameRow}>
                <Text style={[s.renameOrig, { fontWeight: '700' }]} />
                <Text style={[s.renameHead, { flex: 1 }]}>{t.renameDayCol}</Text>
                <Text style={[s.renameHead, { flex: 1 }]}>{t.renameWeekCol}</Text>
              </View>
              {names.map((name) => (
                <View key={name} style={s.renameRow}>
                  <Text style={s.renameOrig} numberOfLines={1}>
                    {name}
                  </Text>
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    value={settings.aliases[key][name] ?? ''}
                    placeholder={name}
                    placeholderTextColor={theme.textDim}
                    onChangeText={(v) =>
                      update({
                        aliases: {
                          ...settings.aliases,
                          [key]: { ...settings.aliases[key], [name]: v },
                        },
                      })
                    }
                  />
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    value={settings.aliasesWeek[key][name] ?? ''}
                    placeholder={settings.aliases[key][name]?.trim() || name}
                    placeholderTextColor={theme.textDim}
                    onChangeText={(v) =>
                      update({
                        aliasesWeek: {
                          ...settings.aliasesWeek,
                          [key]: { ...settings.aliasesWeek[key], [name]: v },
                        },
                      })
                    }
                  />
                </View>
              ))}
            </View>
          ))}
        </View>
        )}

        {/* ---- Periods ---- */}
        {foldHeader('periods', t.sectionPeriods)}
        {isOpen('periods') && (
        <View style={s.card}>
          {settings.periods.map((p, i) => (
            <View style={s.periodRow} key={i}>
              <TextInput
                style={[s.input, s.periodLabel]}
                value={p.label}
                onChangeText={(v) => {
                  const periods = [...settings.periods];
                  periods[i] = { ...p, label: v };
                  update({ periods });
                }}
              />
              <TextInput
                style={[s.input, s.periodTime]}
                value={p.start}
                onChangeText={(v) => {
                  const periods = [...settings.periods];
                  periods[i] = { ...p, start: v };
                  update({ periods });
                }}
                placeholder="07:10"
                placeholderTextColor={theme.textDim}
              />
              <TextInput
                style={[s.input, s.periodTime]}
                value={p.end}
                onChangeText={(v) => {
                  const periods = [...settings.periods];
                  periods[i] = { ...p, end: v };
                  update({ periods });
                }}
                placeholder="07:55"
                placeholderTextColor={theme.textDim}
              />
              <Pressable
                onPress={() => update({ periods: settings.periods.filter((_, j) => j !== i) })}
                style={s.del}
              >
                <Text style={{ color: theme.cancelled, fontSize: 18 }}>×</Text>
              </Pressable>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              style={[s.btn, { flex: 1 }]}
              onPress={() =>
                update({
                  periods: [
                    ...settings.periods,
                    { label: String(settings.periods.length + 1), start: '14:40', end: '15:25' },
                  ],
                })
              }
            >
              <Text style={s.btnTxt}>{t.addPeriod}</Text>
            </Pressable>
            <Pressable
              style={[s.btnGhost, { flex: 1 }]}
              onPress={() => update({ periods: DEFAULT_PERIODS })}
            >
              <Text style={s.btnGhostTxt}>{t.defaultPeriods}</Text>
            </Pressable>
          </View>
        </View>
        )}

        {/* ---- Reminders ---- */}
        {foldHeader('reminders', t.sectionReminders)}
        {isOpen('reminders') && (
          <View style={s.card}>
            {toggle('autoExamReminders', t.autoExamReminders)}
            <Text style={s.rowHint}>{t.autoExamHint}</Text>

            <Text style={s.fieldLabel}>{t.autoExamDays}</Text>
            <View style={s.chips}>
              {DAY_OPTIONS.map((d) => {
                const on = (settings.autoExamDays ?? []).includes(d);
                return (
                  <Pressable
                    key={d}
                    onPress={() =>
                      update({
                        autoExamDays: on
                          ? (settings.autoExamDays ?? []).filter((x) => x !== d)
                          : [...(settings.autoExamDays ?? []), d].sort((a, b) => b - a),
                      })
                    }
                    style={[s.chip, on && { borderColor: theme.accent, borderWidth: 2 }]}
                  >
                    <Text style={[s.chipTxt, on && { color: theme.accent }]}>
                      {d === 0 ? t.sameDay : `${d}${t.dayShortSuffix}`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={s.fieldLabel}>{t.notifyHour}</Text>
            <Slider
              value={settings.reminderHour}
              min={0}
              max={23}
              theme={theme}
              onChange={(v) => update({ reminderHour: v })}
            />
          </View>
        )}

        {/* ---- Developer ---- */}
        {foldHeader('dev', t.sectionDev)}
        {isOpen('dev') && (
        <View style={s.card}>
            {toggle('alignedDayBar', t.alignedDayBar)}
            {toggle('minimalIcons', t.minimalIcons)}

            <Pressable
              style={s.btn}
              onPress={async () => {
                const ok = await sendTestNotification(5);
                setDevMsg(ok ? t.testSent : t.testFailed);
                setPending(await scheduledCount());
              }}
            >
              <Text style={s.btnTxt}>{t.testNotification}</Text>
            </Pressable>

            <Pressable
              style={s.btnGhost}
              onPress={async () => setPending(await scheduledCount())}
            >
              <Text style={s.btnGhostTxt}>
                {t.scheduledCount}
                {pending === null ? '' : `: ${pending}`}
              </Text>
            </Pressable>

            <Pressable
              style={s.btnGhost}
              onPress={async () => {
                const ids = settings.reminders.flatMap((r) => r.scheduled);
                await cancelScheduled(ids);
                update({ reminders: settings.reminders.map((r) => ({ ...r, scheduled: [] })) });
                setPending(await scheduledCount());
              }}
            >
              <Text style={[s.btnGhostTxt, { color: theme.cancelled }]}>{t.clearScheduled}</Text>
            </Pressable>

            {!!devMsg && <Text style={s.rowHint}>{devMsg}</Text>}
          </View>
        )}

        <Pressable style={[s.btnGhost, { marginTop: 24 }]} onPress={reset}>
          <Text style={[s.btnGhostTxt, { color: theme.cancelled }]}>{t.resetAll}</Text>
        </Pressable>

        <Text style={s.footer}>{t.footer}</Text>
      </ScrollView>

      <Modal
        visible={linkOpen}
        animationType="slide"
        onRequestClose={() => setLinkOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top', 'bottom']}>
          <LinkAccountScreen onClose={() => setLinkOpen(false)} />
        </SafeAreaView>
      </Modal>
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
    foldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    foldSign: { color: t.textDim, fontSize: 20, fontWeight: '800', marginTop: 16 },
    section: {
      color: t.textDim,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginTop: 20,
      marginBottom: 8,
    },
    card: {
      backgroundColor: t.surface,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      padding: 12,
      gap: 8,
    },
    fieldLabel: { color: t.textDim, fontSize: 12, fontWeight: '600' },
    input: {
      backgroundColor: t.surfaceAlt,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: t.text,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
    },
    current: { color: t.text, fontWeight: '700', fontSize: 15 },
    btn: {
      backgroundColor: t.accent,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    btnTxt: { color: t.accentText, fontWeight: '700' },
    btnGhost: {
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
    },
    btnGhostTxt: { color: t.text, fontWeight: '600' },
    classRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      marginBottom: 6,
    },
    className: { color: t.text, fontWeight: '800', width: 52 },
    classLong: { color: t.textDim, fontSize: 12, flex: 1 },
    classDept: { color: t.textDim, fontSize: 10, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 12 },
    rowLabel: { color: t.text, fontSize: 15 },
    rowHint: { color: t.textDim, fontSize: 12, marginTop: 2 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.surfaceAlt,
    },
    chipTxt: { color: t.text, fontSize: 13, fontWeight: '600' },
    swatch: { width: 16, height: 16, borderRadius: 8, borderWidth: 1 },
    dot: { width: 30, height: 30, borderRadius: 15 },
    dotActive: { borderWidth: 3, borderColor: '#ffffff88' },
    sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sliderLabel: { color: t.textDim, fontSize: 12, fontWeight: '600', width: 56 },
    subjRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    subjName: { color: t.text, fontWeight: '700', width: 62, fontSize: 13 },
    swatchDot: { width: 26, height: 26, borderRadius: 13, marginRight: 6 },
    swatchActive: { borderWidth: 3, borderColor: '#ffffff99' },
    renameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    renameOrig: { color: t.textDim, fontSize: 12, width: 66 },
    dropdown: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
    dropdownList: {
      marginTop: 4,
      marginBottom: 6,
      marginLeft: 66,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.surfaceAlt,
    },
    dropdownItem: { paddingVertical: 10, paddingHorizontal: 12 },
    renameHead: { color: t.textDim, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
    periodRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    periodLabel: { width: 48, textAlign: 'center' },
    periodTime: { flex: 1, textAlign: 'center' },
    del: { paddingHorizontal: 6 },
    err: { color: t.cancelled, fontSize: 12 },
    footer: { color: t.textDim, fontSize: 11, marginTop: 20, lineHeight: 16 },
  });
