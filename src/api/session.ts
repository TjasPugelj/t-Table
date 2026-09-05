/**
 * Everything an authenticated WebUntis session needs beyond the login itself.
 *
 * The REST "view" API (the one the WebUntis web client uses, and the one this
 * app reads timetables from) does not run on the login session cookie alone —
 * it wants a short-lived JWT from /api/token/new plus the school's tenant id.
 * It also addresses a student by their *student* id, which is not always the
 * personId that the login call reports, so we read that here too.
 */

export interface SessionExtras {
  jwt: string;
  tenantId: number | null;
  studentId: number | null;
  displayName: string | null;
}

export async function fetchSessionExtras(host: string): Promise<SessionExtras> {
  // No Accept: text/plain here — some WebUntis servers answer that with 406.
  let jwt = '';
  try {
    const jwtRes = await fetch(`https://${host}/WebUntis/api/token/new`, {
      headers: { Accept: '*/*' },
    });
    if (jwtRes.ok) jwt = (await jwtRes.text()).trim();
  } catch {
    // no token — the login session cookie may still be enough
  }

  let tenantId: number | null = null;
  let studentId: number | null = null;
  let displayName: string | null = null;

  try {
    const res = await fetch(`https://${host}/WebUntis/api/rest/view/v1/app/data`, {
      headers: {
        Accept: 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
    });
    if (res.ok) {
      const data: any = await res.json();
      tenantId = data?.tenant?.id ?? null;

      const students: any[] = data?.user?.students ?? [];
      if (students.length) {
        studentId = students[0]?.id ?? null;
        displayName = students[0]?.displayName ?? null;
      }
      // student logins may describe themselves under `person` instead
      if (studentId == null) studentId = data?.user?.person?.id ?? data?.user?.personId ?? null;
      if (!displayName) {
        displayName = data?.user?.person?.displayName ?? data?.user?.displayName ?? null;
      }
    }
  } catch {
    // tenant/student lookup is best-effort — the JWT alone still gets us far
  }

  return { jwt, tenantId, studentId, displayName };
}

/** Headers the view API expects from a logged-in session. */
export function sessionHeaders(extras: SessionExtras | null): Record<string, string> {
  if (!extras) return {};
  const h: Record<string, string> = {};
  if (extras.jwt) h.Authorization = `Bearer ${extras.jwt}`;
  if (extras.tenantId != null) h['tenant-id'] = String(extras.tenantId);
  return h;
}
