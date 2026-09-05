import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * A "linked" Untis account, obtained one of two ways:
 *  - 'qr': pairing with the QR code WebUntis shows under Profile → "share
 *    with other apps". `secret` lets us generate fresh login codes forever
 *    (see src/lib/totp.ts) without ever touching the user's actual password.
 *  - 'password': submitting a username + password straight to WebUntis's own
 *    login endpoint. Some schools validate that endpoint against their
 *    Office 365 / Azure AD directory server-side, so the school email +
 *    Office 365 password can work here even without the QR flow.
 *
 * Stored in SecureStore rather than AsyncStorage since `secret`/`password`
 * are exactly as sensitive as a permanent password (for 'password' accounts
 * it literally *is* one).
 */
export interface LinkedAccount {
  method: 'qr' | 'password';
  host: string;
  school: string;
  user: string;
  /** TOTP secret — only set when method === 'qr'. */
  secret?: string;
  /** Plain password — only set when method === 'password'. */
  password?: string;
  personId: number;
  personType: number;
  klasseId: number | null;
  /** Id the REST view API addresses this person by (may differ from personId). */
  studentId?: number | null;
  tenantId?: number | null;
  displayName: string;
}

const KEY = 'untis.account.v1';

interface Ctx {
  account: LinkedAccount | null;
  ready: boolean;
  link: (a: LinkedAccount) => Promise<void>;
  unlink: () => Promise<void>;
}

const AccountContext = createContext<Ctx | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<LinkedAccount | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(KEY);
        if (raw) setAccount(JSON.parse(raw));
      } catch {
        // corrupt/unavailable secure storage — just start unlinked
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const link = useCallback(async (a: LinkedAccount) => {
    setAccount(a);
    await SecureStore.setItemAsync(KEY, JSON.stringify(a));
  }, []);

  const unlink = useCallback(async () => {
    setAccount(null);
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
  }, []);

  return (
    <AccountContext.Provider value={{ account, ready, link, unlink }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): Ctx {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used inside <AccountProvider>');
  return ctx;
}
