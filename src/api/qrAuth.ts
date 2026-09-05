import { totp } from '../lib/totp';
import { fetchSessionExtras, SessionExtras, sessionHeaders } from './session';
import { UntisAuth } from './untis';

/**
 * Real WebUntis login, via the same QR-pairing mechanism the official Untis
 * Mobile app (and third-party clients like BetterUntis) use — including for
 * schools where the human login step is Office 365 / SAML SSO.
 *
 * WebUntis itself has no API for a third-party app to drive an Office 365
 * login directly (the official app doesn't support that either — see
 * WebUntis's own help centre). Instead: the user signs into the WebUntis
 * *website* however their school requires, opens their profile's "share
 * with other apps" page, and gets a QR code. That code encodes a per-account
 * secret that WebUntis generates itself — independent of how the user
 * originally signed in. Any app holding that secret can generate valid
 * 6-digit login codes (TOTP, RFC 6238) forever, exactly like the official
 * app does after scanning the same code.
 */

export interface UntisQR {
  host: string;
  school: string;
  user: string;
  secret: string;
}

/** Parses the "untis://setschool?url=...&school=...&user=...&key=..." pairing link. */
export function parseUntisQR(data: string): UntisQR | null {
  try {
    const raw = data.trim();
    // Swap the custom scheme for one URL can actually parse — only the query
    // string matters, the host half is discarded.
    const parseable = raw.replace(/^untis:\/\//i, 'https://x/');
    const url = new URL(parseable);
    const host = url.searchParams.get('url');
    const school = url.searchParams.get('school');
    const user = url.searchParams.get('user');
    const secret = url.searchParams.get('key');
    if (!host || !school || !user || !secret) return null;
    return { host: host.replace(/^https?:\/\//i, '').replace(/\/+$/, ''), school, user, secret };
  } catch {
    return null;
  }
}

async function loginWithSecret(
  host: string,
  school: string,
  user: string,
  secret: string,
): Promise<void> {
  const code = totp(secret);
  const res = await fetch(
    `https://${host}/WebUntis/jsonrpc_intern.do?m=getUserData2017&school=${encodeURIComponent(
      school,
    )}&v=i2.2`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        id: 'urnik',
        method: 'getUserData2017',
        params: [{ auth: { clientTime: Date.now(), user, otp: Number(code) } }],
        jsonrpc: '2.0',
      }),
    },
  );
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body — fall through, res.ok check below still catches HTTP errors
  }
  if (!res.ok || json?.error) {
    throw new Error(json?.error?.message || `Login failed (${res.status})`);
  }
}

export interface PairedAccount {
  method: 'qr';
  host: string;
  school: string;
  user: string;
  secret: string;
  personId: number;
  personType: number;
  klasseId: number | null;
  /** Id the view API addresses this person by — what timetable requests use. */
  studentId: number | null;
  tenantId: number | null;
  displayName: string;
}

/** One-time full pairing: logs in, then reads back who this account actually is. */
export async function pairAccount(qr: UntisQR): Promise<PairedAccount> {
  await loginWithSecret(qr.host, qr.school, qr.user, qr.secret);

  const configRes = await fetch(`https://${qr.host}/WebUntis/api/app/config`, {
    headers: { Accept: 'application/json' },
  });
  if (!configRes.ok) throw new Error(`Could not read account info (${configRes.status})`);
  const config = await configRes.json();
  const loginUser = config?.data?.loginServiceConfig?.user;
  const personId: number | undefined = loginUser?.personId;
  if (!personId) throw new Error('WebUntis did not return an account id');
  const personType: number =
    (loginUser?.persons ?? []).find((p: any) => p.id === personId)?.type ?? 5;

  let klasseId: number | null = null;
  try {
    const dtRes = await fetch(`https://${qr.host}/WebUntis/api/daytimetable/config`, {
      headers: { Accept: 'application/json' },
    });
    if (dtRes.ok) {
      const dt = await dtRes.json();
      klasseId = dt?.data?.klasseId ?? null;
    }
  } catch {
    // optional — a personal timetable works fine without it
  }

  const extras = await fetchSessionExtras(qr.host);

  return {
    method: 'qr',
    host: qr.host,
    school: qr.school,
    user: qr.user,
    secret: qr.secret,
    personId,
    personType,
    klasseId,
    studentId: extras.studentId ?? personId,
    tenantId: extras.tenantId,
    displayName: extras.displayName || qr.user,
  };
}

/** The `getTimetable`/view-API element type that matches a login's personType. */
export function resourceTypeForPerson(
  personType: number,
): 'CLASS' | 'TEACHER' | 'ROOM' | 'STUDENT' {
  switch (personType) {
    case 1:
      return 'CLASS';
    case 2:
      return 'TEACHER';
    case 4:
      return 'ROOM';
    default:
      return 'STUDENT';
  }
}

/** UntisAuth backed by a paired account — silently re-logs-in when the session goes stale. */
export class SessionAuth implements UntisAuth {
  readonly kind = 'session' as const;
  private loggedInAt = 0;
  private extras: SessionExtras | null = null;

  constructor(
    private host: string,
    private school: string,
    private user: string,
    private secret: string,
  ) {}

  async prepare() {
    // WebUntis sessions expire after ~10 minutes idle — refresh a bit early.
    if (this.extras && Date.now() - this.loggedInAt < 8 * 60 * 1000) return;
    await loginWithSecret(this.host, this.school, this.user, this.secret);
    this.extras = await fetchSessionExtras(this.host);
    this.loggedInAt = Date.now();
  }

  headers() {
    return sessionHeaders(this.extras);
  }
}
