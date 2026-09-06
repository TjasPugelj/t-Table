# t-Table

An alternative WebUntis client for Android — your own timetable, exams and homework, with a layout you can actually change.

Built with React Native (Expo, TypeScript). UI in Slovenian and English.

## Download

**[Get the latest APK →](../../releases/latest)**

Open the `.apk` on your phone and allow "install from unknown sources" — it isn't from the Play Store. Android 7+.

## What it does

**Your timetable**

- Day view with your bell schedule, free periods as gaps, and the current period highlighted
- Week view, five columns
- Cancellations struck through, substitutions marked, and teachers Untis has struck out shown struck out
- Parallel groups (language groups, PE splits) rendered side by side, with a filter for your own group
- Swipe between days and weeks; double-tap to switch view

**Everything else from WebUntis** — under **School**:

- Homework, with due dates
- Exams, searchable and filterable by month and subject; tap one to jump to that day
- Absences, with excused/unexcused status
- Your message inbox

**Reminders**

- Every exam automatically gets one, 2 days and 1 day before (configurable, or off)
- Add your own to any lesson, with notes, at whatever notice you like
- Notes stick to a subject across every lesson of it

**Made to be changed**

- 4 themes, 7 accent colours, per-subject colours
- Choose what each field on a card shows — subject, teacher, room or nothing — separately for day and week view
- Rename subjects, teachers and rooms (separately per view, so week view can be shorter)
- Text sizes, row heights, card styles, sticky notes, bookmarks
- Fully editable period/bell schedule

## Signing in

Untis has no API that lets a third-party app drive an Office 365 / SSO login — not even the official Untis Mobile app does that. It uses QR pairing instead, and so does this:

1. Open WebUntis in a browser and log in however your school requires
2. Profile → the sharing tab (*Freigaben* / *Delnice*) → show the QR code
3. Scan it in the app: **Settings → My account → Link your account**

The QR code carries a secret WebUntis generates for your account, independent of how you signed in. The app turns it into a login code the same way an authenticator app does (TOTP, RFC 6238). Some schools also accept a plain username and password, so that tab is there too.

Without an account the app still works — it shows a class's public timetable, if your school publishes them.

**Your credentials stay on your phone.** The pairing secret goes into the device keystore (`expo-secure-store`), and the app talks only to your school's WebUntis server. There is no backend.

## Build it yourself

```bash
git clone https://github.com/TjasPugelj/t-Table.git
cd t-Table
npm install
```

Run in development — needs a [development build](https://docs.expo.dev/develop/development-builds/introduction/), since Expo Go dropped part of `expo-notifications` in SDK 53:

```bash
eas build --profile development --platform android   # once
npx expo start
```

Expo Go still works for everything except notifications: `npx expo start --go`.

Ship an APK:

```bash
eas build --profile preview --platform android
```

Bump `version` and `android.versionCode` in `app.json` first — Android refuses an update whose `versionCode` isn't higher than the installed one.

## Layout

```
App.tsx                       shell, modals
src/api/types.ts              WebUntis response shapes
src/api/untis.ts              client, auth interface, entry → Lesson
src/api/qrAuth.ts             QR pairing, TOTP login
src/api/passwordAuth.ts       username/password login
src/api/session.ts            JWT + tenant id for the view API
src/lib/totp.ts               RFC 6238, no native crypto
src/lib/examReminders.ts      keeps a reminder per exam
src/store/settings.tsx        settings + persistence
src/store/account.tsx         linked account (secure storage)
src/store/schoolData.tsx      session cache for the School screen
src/screens/                  Timetable, School, Settings, LinkAccount
```

## API notes

Base `https://<host>/WebUntis/…`. Anonymous access uses the header `Anonymous-School: <school>`; a signed-in session needs a JWT from `/api/token/new` plus a `tenant-id` header, both fetched after login.

| Endpoint | Purpose |
|---|---|
| `api/rest/view/v1/timetable/entries` | timetable — `timetableType=MY_TIMETABLE` for your own, `STANDARD` for a class |
| `api/rest/view/v1/app/data` | tenant id, student id, school year |
| `jsonrpc_intern.do?m=getUserData2017` | login with a TOTP code from the QR secret |
| `jsonrpc.do` → `authenticate` | login with username + password |
| `api/homeworks/lessons` | homework — **one month at a time**; a year-wide range returns nothing |
| `api/exams` | exams, whole school year at once |
| `api/classreg/absences/students` | absences |
| `api/rest/view/v1/messages` | inbox (JWT) |

Timetable entries: `position1` = teachers, `position2` = subjects, `position3` = rooms, `position4` = info. Each is `{current, removed}` — when `current` is null the resource was removed and not replaced, which is what Untis draws struck through. `layoutGroup` separates parallel groups.

Defaults are ŠC Celje, class M3C.
