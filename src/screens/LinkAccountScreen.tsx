import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { pairWithPassword } from '../api/passwordAuth';
import { pairAccount, parseUntisQR, UntisQR, UsernameUnknownError } from '../api/qrAuth';
import { LinkedAccount, useAccount } from '../store/account';
import { useSettings } from '../store/settings';
import { Theme } from '../theme';

type Method = 'qr' | 'password';

export default function LinkAccountScreen({ onClose }: { onClose: () => void }) {
  const { settings, theme, t } = useSettings();
  const { link } = useAccount();
  const [method, setMethod] = useState<Method>('qr');
  const [permission, requestPermission] = useCameraPermissions();
  const [pasted, setPasted] = useState('');
  // WebUntis mangles non-ASCII usernames into "?" when it generates the QR, and
  // that username can never log in. pairAccount tries the likely letters itself;
  // this pair of fields is the manual fallback for when none of them matched.
  const [pending, setPending] = useState<UntisQR | null>(null);
  const [pendingUser, setPendingUser] = useState('');
  const [resolving, setResolving] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledRef = useRef(false);

  const s = makeStyles(theme);

  const tryLinkQr = useCallback(
    async (raw: string) => {
      if (handledRef.current || busy) return;
      const qr = parseUntisQR(raw);
      if (!qr) {
        setError(t.invalidQr);
        return;
      }
      // stop the camera firing again while this scan is being used
      handledRef.current = true;
      setError(null);
      setBusy(true);
      // a mangled username makes pairing slower — say what the wait is for
      setResolving(qr.user.includes('?'));
      try {
        const account: LinkedAccount = await pairAccount(qr);
        await link(account);
        onClose();
      } catch (e: any) {
        if (e instanceof UsernameUnknownError) {
          // none of the substitutions matched — let the user type it
          setPending(qr);
          setPendingUser(qr.user);
        } else {
          setError(e?.message ?? t.linkFailed);
          handledRef.current = false;
        }
      } finally {
        setResolving(false);
        setBusy(false);
      }
    },
    [busy, link, onClose, t],
  );

  const confirmQr = useCallback(async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      const paired = await pairAccount({ ...pending, user: pendingUser.trim() });
      const account: LinkedAccount = paired;
      await link(account);
      onClose();
    } catch (e: any) {
      setError(e instanceof UsernameUnknownError ? t.userMangledHint : e?.message ?? t.linkFailed);
    } finally {
      setBusy(false);
    }
  }, [pending, pendingUser, busy, link, onClose, t]);

  const rescan = useCallback(() => {
    setPending(null);
    setError(null);
    handledRef.current = false;
  }, []);

  const tryLinkPassword = useCallback(async () => {
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const paired = await pairWithPassword(
        settings.host,
        settings.school,
        username.trim(),
        password,
      );
      const account: LinkedAccount = paired;
      await link(account);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? t.linkFailed);
    } finally {
      setBusy(false);
    }
  }, [busy, username, password, settings.host, settings.school, link, onClose, t]);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>{t.linkAccount}</Text>
        <Pressable onPress={onClose} style={s.closeBtn}>
          <Text style={s.closeTxt}>{t.cancel}</Text>
        </Pressable>
      </View>

      <View style={s.tabs}>
        {(
          [
            ['qr', t.methodQr],
            ['password', t.methodPassword],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => {
              setMethod(key);
              setError(null);
            }}
            style={[s.tab, method === key && { borderColor: theme.accent, borderWidth: 2 }]}
          >
            <Text style={s.tabTxt}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {method === 'qr' ? (
        pending ? (
          <>
            <Text style={s.hint}>{t.qrScanned}</Text>

            <Text style={s.fieldLabel}>{t.confirmUser}</Text>
            <TextInput
              style={s.input}
              value={pendingUser}
              onChangeText={setPendingUser}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {pendingUser.includes('?') && <Text style={s.warn}>{t.userMangledHint}</Text>}

            <Text style={s.scannedMeta}>
              {pending.school} · {pending.host}
            </Text>

            {!!error && <Text style={s.err}>{error}</Text>}

            <Pressable
              style={[s.btn, { marginTop: 16 }, (!pendingUser.trim() || busy) && { opacity: 0.5 }]}
              disabled={!pendingUser.trim() || busy}
              onPress={confirmQr}
            >
              {busy ? (
                <ActivityIndicator color={theme.accentText} />
              ) : (
                <Text style={s.btnTxt}>{t.linkAccount}</Text>
              )}
            </Pressable>

            <Pressable style={[s.btnGhost, { marginTop: 8 }]} onPress={rescan}>
              <Text style={s.btnGhostTxt}>{t.scanAgain}</Text>
            </Pressable>
          </>
        ) : (
        <>
          <Text style={s.hint}>{t.scanQrHint}</Text>

          <View style={s.cameraWrap}>
            {!permission ? (
              <ActivityIndicator color={theme.accent} />
            ) : !permission.granted ? (
              <View style={s.permissionBox}>
                <Text style={s.permissionTxt}>{t.cameraPermissionNeeded}</Text>
                <Pressable style={s.btn} onPress={requestPermission}>
                  <Text style={s.btnTxt}>{t.grantCameraAccess}</Text>
                </Pressable>
              </View>
            ) : (
              <CameraView
                style={StyleSheet.absoluteFill}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={(res) => tryLinkQr(res.data)}
              />
            )}
            {busy && (
              <View style={s.busyOverlay}>
                <ActivityIndicator color="#fff" size="large" />
                <Text style={s.busyTxt}>{resolving ? t.resolvingUser : t.linking}</Text>
              </View>
            )}
          </View>

          {!!error && <Text style={s.err}>{error}</Text>}

          <Text style={s.fieldLabel}>{t.pasteLinkInstead}</Text>
          <View style={s.pasteRow}>
            <TextInput
              style={s.input}
              value={pasted}
              onChangeText={setPasted}
              placeholder={t.pasteLinkPlaceholder}
              placeholderTextColor={theme.textDim}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={[s.btn, !pasted.trim() && { opacity: 0.5 }]}
              disabled={!pasted.trim() || busy}
              onPress={() => tryLinkQr(pasted.trim())}
            >
              <Text style={s.btnTxt}>{t.usePastedLink}</Text>
            </Pressable>
          </View>
        </>
        )
      ) : (
        <>
          <Text style={s.hint}>{t.passwordHint}</Text>

          <Text style={s.fieldLabel}>{t.usernameField}</Text>
          <TextInput
            style={s.input}
            value={username}
            onChangeText={setUsername}
            placeholder={t.usernameField}
            placeholderTextColor={theme.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />

          <Text style={s.fieldLabel}>{t.passwordField}</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            placeholder={t.passwordField}
            placeholderTextColor={theme.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          {!!error && <Text style={s.err}>{error}</Text>}

          <Pressable
            style={[
              s.btn,
              { marginTop: 16 },
              (!username.trim() || !password || busy) && { opacity: 0.5 },
            ]}
            disabled={!username.trim() || !password || busy}
            onPress={tryLinkPassword}
          >
            {busy ? (
              <ActivityIndicator color={theme.accentText} />
            ) : (
              <Text style={s.btnTxt}>{t.logIn}</Text>
            )}
          </Pressable>
        </>
      )}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg, padding: 16 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    title: { color: t.text, fontSize: 22, fontWeight: '800' },
    closeBtn: { paddingHorizontal: 12, paddingVertical: 8 },
    closeTxt: { color: t.accent, fontWeight: '700' },
    tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    tab: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.surfaceAlt,
    },
    tabTxt: { color: t.text, fontWeight: '700', fontSize: 13 },
    hint: { color: t.textDim, fontSize: 13, lineHeight: 19, marginBottom: 12 },
    cameraWrap: {
      height: 320,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: t.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    permissionBox: { alignItems: 'center', gap: 12, padding: 20 },
    permissionTxt: { color: t.textDim, fontSize: 13, textAlign: 'center' },
    busyOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    busyTxt: { color: '#fff', fontWeight: '700' },
    err: { color: t.cancelled, fontSize: 13, marginTop: 12 },
    warn: { color: t.changed, fontSize: 12, lineHeight: 17, marginTop: 6 },
    scannedMeta: { color: t.textDim, fontSize: 12, marginTop: 10 },
    btnGhost: {
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
    },
    btnGhostTxt: { color: t.text, fontWeight: '600' },
    fieldLabel: { color: t.textDim, fontSize: 12, fontWeight: '600', marginTop: 20 },
    pasteRow: { gap: 8, marginTop: 6 },
    input: {
      backgroundColor: t.surfaceAlt,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: t.text,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      marginTop: 6,
    },
    btn: {
      backgroundColor: t.accent,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    btnTxt: { color: t.accentText, fontWeight: '700' },
  });
