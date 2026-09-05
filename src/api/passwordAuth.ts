import { fetchSessionExtras, SessionExtras, sessionHeaders } from './session';
import { UntisAuth } from './untis';

/**
 * Plain username + password login, straight against WebUntis's own
 * `authenticate` endpoint — the same one the WebUntis website's "Uporabniško
 * ime / Geslo" fields use. Whether the school's Office 365 email + password
 * actually work here depends on how the school wired their WebUntis up
 * (some validate that field against Azure AD server-side; others only
 * accept it through the full Office 365 redirect on the website, in which
 * case this endpoint will simply reject it and the QR-pairing method in
 * qrAuth.ts is the way in).
 */

interface AuthResult {
  sessionId: string;
  personId: number;
  personType: number;
  klasseId?: number;
}

async function loginWithPassword(
  host: string,
  school: string,
  user: string,
  password: string,
): Promise<AuthResult> {
  const res = await fetch(`https://${host}/WebUntis/jsonrpc.do?school=${encodeURIComponent(school)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      id: 'urnik',
      method: 'authenticate',
      params: { user, password, client: 'urnik' },
      jsonrpc: '2.0',
    }),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // fall through — res.ok check below still catches HTTP-level failures
  }
  const result = json?.result;
  if (!res.ok || json?.error || (result && typeof result.code === 'number')) {
    const code = result?.code;
    throw new Error(
      json?.error?.message ||
        (code ? `Login failed (code ${code})` : `Login failed (${res.status})`),
    );
  }
  if (!result?.personId) throw new Error('WebUntis did not return an account id');
  return result as AuthResult;
}

export interface PasswordPairedAccount {
  method: 'password';
  host: string;
  school: string;
  user: string;
  password: string;
  personId: number;
  personType: number;
  klasseId: number | null;
  /** Id the view API addresses this person by — what timetable requests use. */
  studentId: number | null;
  tenantId: number | null;
  displayName: string;
}

export async function pairWithPassword(
  host: string,
  school: string,
  user: string,
  password: string,
): Promise<PasswordPairedAccount> {
  const result = await loginWithPassword(host, school, user, password);
  const extras = await fetchSessionExtras(host);
  return {
    method: 'password',
    host,
    school,
    user,
    password,
    personId: result.personId,
    personType: result.personType,
    klasseId: result.klasseId ?? null,
    studentId: extras.studentId ?? result.personId,
    tenantId: extras.tenantId,
    displayName: extras.displayName || user,
  };
}

/** UntisAuth backed by a stored username/password — re-logs-in when the session goes stale. */
export class PasswordAuth implements UntisAuth {
  readonly kind = 'session' as const;
  private loggedInAt = 0;
  private extras: SessionExtras | null = null;

  constructor(
    private host: string,
    private school: string,
    private user: string,
    private password: string,
  ) {}

  async prepare() {
    if (this.extras && Date.now() - this.loggedInAt < 8 * 60 * 1000) return;
    await loginWithPassword(this.host, this.school, this.user, this.password);
    this.extras = await fetchSessionExtras(this.host);
    this.loggedInAt = Date.now();
  }

  headers() {
    return sessionHeaders(this.extras);
  }
}
