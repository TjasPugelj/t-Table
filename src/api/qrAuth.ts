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

/**
 * Parses the "untis://setschool?url=...&school=...&user=...&key=..." pairing link.
 *
 * The query string is picked apart by hand rather than through `URL`: React
 * Native's URL is a partial polyfill whose `searchParams` behaviour varies by
 * version, and a username that survives as `tja%C5%A1.pugelj` instead of
 * `tjaš.pugelj` is rejected by the server as bad credentials — with no hint
 * that the encoding was the problem.
 */
export function parseUntisQR(data: string): UntisQR | null {
  try {
    const raw = data.trim();
    const q = raw.indexOf('?');
    if (q === -1) return null;

    const params: Record<string, string> = {};
    for (const part of raw.slice(q + 1).split('&')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = decodeURIComponent(part.slice(0, eq));
      const value = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
      params[key] = value;
    }

    const host = params.url;
    const school = params.school;
    const user = params.user;
    const secret = params.key;
    if (!host || !school || !user || !secret) return null;

    return {
      host: host.replace(/^https?:\/\//i, '').replace(/\/+$/, ''),
      school,
      user,
      secret: secret.replace(/\s+/g, ''),
    };
  } catch {
    return null;
  }
}

/**
 * Client names the mobile endpoint accepts. `jsonrpc_intern.do` validates this
 * separately from the public endpoint — the app's own name is fine for
 * `jsonrpc.do` (password login) but comes back as "invalid client name" here.
 * "Awesome" is the identity the widely-used JS client defaults to, so it is
 * known to pass on real servers.
 */
const CLIENT_NAMES = ['Awesome', 'UntisMobile', 'urnik'];

/** Set once a name is accepted, so later calls don't rediscover it. */
let knownClient: string | null = null;

async function postOtp(
  host: string,
  school: string,
  user: string,
  otp: string | number,
  clientTime: number,
  identity: string,
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(
    `https://${host}/WebUntis/jsonrpc_intern.do?m=getUserData2017&school=${encodeURIComponent(
      school,
    )}&v=i2.2`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        id: identity,
        method: 'getUserData2017',
        params: [{ auth: { clientTime, user, otp } }],
        jsonrpc: '2.0',
      }),
    },
  );
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body — the res.ok check below still catches HTTP errors
  }
  if (!res.ok || json?.error) {
    return { ok: false, message: json?.error?.message || `Login failed (${res.status})` };
  }
  return { ok: true, message: '' };
}

/**
 * WebUntis writes a plain "?" into the QR code in place of a letter it can't
 * encode, so the username it hands out cannot log in. These are the letters
 * that go missing in Slovenian and Croatian names, most common first.
 */
const MANGLED_LETTERS = ['š', 'ž', 'č', 'ć'];

/**
 * Every username worth trying for a mangled one. Lower case first (Untis
 * usernames are normally lower case), then upper. Two missing letters are still
 * worth guessing; beyond that the combinations outgrow their usefulness and the
 * user is asked instead.
 */
export function usernameCandidates(user: string): string[] {
  const missing = (user.match(/\?/g) || []).length;
  if (missing === 0) return [user];

  if (missing === 1) {
    return [
      ...MANGLED_LETTERS.map((c) => user.replace('?', c)),
      ...MANGLED_LETTERS.map((c) => user.replace('?', c.toUpperCase())),
    ];
  }

  if (missing === 2) {
    const out: string[] = [];
    for (const a of MANGLED_LETTERS) {
      for (const b of MANGLED_LETTERS) {
        out.push(user.replace('?', a).replace('?', b));
      }
    }
    return out;
  }

  return [];
}

/** Thrown when the username can't be worked out and the user has to supply it. */
export class UsernameUnknownError extends Error {
  constructor() {
    super('Could not work out the username from the QR code');
    this.name = 'UsernameUnknownError';
  }
}

/**
 * One code, one username — just enough to tell "this username is wrong" from
 * "this username is right". Used to search the candidates without paying for
 * the full retry matrix on each one.
 */
async function probeUser(
  host: string,
  school: string,
  user: string,
  secret: string,
): Promise<boolean> {
  const code = totp(secret);
  const names = knownClient ? [knownClient] : CLIENT_NAMES;
  for (const identity of names) {
    const r = await postOtp(host, school, user, code, Date.now(), identity);
    if (r.ok) {
      knownClient = identity;
      return true;
    }
    if (/client\s*name/i.test(r.message)) continue; // this name is no good, try the next
    if (/client\s*time/i.test(r.message)) {
      throw new Error(
        `${r.message} — check that your phone's date and time are set automatically.`,
      );
    }
    return false; // the server understood us and refused: wrong username
  }
  return false;
}

/**
 * Works out the real username behind a mangled one by trying each candidate
 * against the server.
 */
export async function resolveUser(qr: UntisQR): Promise<string> {
  if (!qr.user.includes('?')) return qr.user;

  const candidates = usernameCandidates(qr.user);
  if (!candidates.length) throw new UsernameUnknownError();

  for (const candidate of candidates) {
    if (await probeUser(qr.host, qr.school, candidate, qr.secret)) return candidate;
  }
  throw new UsernameUnknownError();
}

/** A wrong code is worth another try; a wrong school or user is not. */
const worthRetrying = (message: string) => /credential|otp|token|invalid|denied/i.test(message);

/**
 * Logs in with a code derived from the QR secret.
 *
 * Three separate things can make an attempt fail, and the server's wording is
 * the only way to tell them apart:
 *
 *  - a code beginning with 0. Sent as a JSON number it arrives as five digits,
 *    so it goes as a zero-padded string first, with the numeric form as a
 *    fallback for servers that insist on a number.
 *  - a client name the server doesn't recognise (see CLIENT_NAMES).
 *  - a phone clock out of step with the server's. `clientTime` is always the
 *    real current time — the server checks it against its own clock, so
 *    shifting it to chase a TOTP window just trades one rejection for another.
 *    Only the code's window is shifted, which covers a server whose clock is
 *    slightly off while ours is right.
 */
async function loginWithSecret(
  host: string,
  school: string,
  user: string,
  secret: string,
): Promise<void> {
  const offsets = [0, -30_000, 30_000];
  let firstMessage = '';

  for (const identity of knownClient ? [knownClient, ...CLIENT_NAMES] : CLIENT_NAMES) {
    for (const offset of offsets) {
      const code = totp(secret, Date.now() + offset);
      for (const otp of [code, Number(code)] as (string | number)[]) {
        // never offset clientTime itself: the server validates it
        const r = await postOtp(host, school, user, otp, Date.now(), identity);
        if (r.ok) {
          knownClient = identity;
          return;
        }
        if (!firstMessage) firstMessage = r.message;

        // the name was refused — no code will help, try the next one
        if (/client\s*name/i.test(r.message)) break;
        // our clock is the problem, and no retry can paper over that
        if (/client\s*time/i.test(r.message)) {
          throw new Error(
            `${r.message} — check that your phone's date and time are set automatically.`,
          );
        }
        if (!worthRetrying(r.message)) throw new Error(r.message);
      }
      if (/client\s*name/i.test(firstMessage)) break;
    }
  }
  throw new Error(firstMessage || 'Login failed');
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
  // the QR's username may have a letter replaced by "?" — find the real one
  const user = await resolveUser(qr);
  await loginWithSecret(qr.host, qr.school, user, qr.secret);

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
    user,
    secret: qr.secret,
    personId,
    personType,
    klasseId,
    studentId: extras.studentId ?? personId,
    tenantId: extras.tenantId,
    displayName: extras.displayName || user,
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
