# Urnik — customizable WebUntis app

React Native (Expo, TypeScript). Anonymous class timetables today, designed so
username/password login can be dropped in later without touching the UI.

## Run it

```bash
cd D:\Untis-App
npm install
npx expo start
```

Then open **Expo Go** on your phone → *Scan QR code* (the button inside Expo Go,
not your camera app), or *Enter URL manually* with the `exp://192.168.x.x:8081`
line the terminal prints. Phone and PC must be on the same WiFi; otherwise use
`npx expo start --tunnel`.

`npx expo start --web` works for layout, but the browser blocks the Untis
request with CORS — test data loading on the phone.

## What's in it

- **Day view** — periods from your bell schedule, free periods shown as gaps,
  cancelled lessons struck through, substitution notes inline, current period
  highlighted.
- **Week view** — five columns, compact cards, horizontal scroll.
- **Settings** — server + school key, class picker (loads all 131 classes from
  the school and searches them), 4 themes, 7 accent colours, display toggles,
  and a fully editable period/bell schedule.
- Everything persists via AsyncStorage.

## Project layout

```
App.tsx                     shell + settings modal
src/api/types.ts            WebUntis response types (captured from live JSON)
src/api/untis.ts            client, auth interface, entry -> Lesson normaliser
src/store/settings.tsx      settings context + persistence
src/theme.ts                themes and accents
src/lib/date.ts             date helpers (Slovenian day names)
src/screens/                TimetableScreen, SettingsScreen
src/components/LessonCard.tsx
Timetable.py                the original script, kept as reference
```

## API notes

Base: `https://<host>/WebUntis/api/rest/view/v1/…`, with header
`Anonymous-School: <school>` for public access. No cookies or login needed.

| Endpoint | Purpose |
|---|---|
| `timetable/entries?start&end&format=5&resourceType=CLASS&resources=<id>&periodTypes=&timetableType=STANDARD&layout=START_TIME` | the timetable |
| `timetable/filter?resourceType=CLASS&timetableType=STANDARD` | classes, departments, rooms, subjects, teachers |
| `timegrid` | 403 anonymously — that's why periods are configured in the app |

Entry shape: `position1` = teachers, `position2` = subjects, `position3` = rooms,
`position4` = info/substitution chips. Each position item is
`{current, removed}` so substitutions can show old and new. `status` is
`REGULAR` / `CANCELLED` / `CHANGED`, `type` is `NORMAL_TEACHING_PERIOD` /
`EVENT` / `EXAM`. `layoutGroup` separates parallel groups when a class splits
(e.g. language groups) — the app renders those side by side in the same slot.

Defaults are ŠC Celje, class **M3C** (id 2960, dept SMM).

## Adding login later

`UntisAuth` in `src/api/untis.ts` is the seam:

```ts
class SessionAuth implements UntisAuth {
  kind = 'session';
  async prepare() { /* POST /WebUntis/j_spring_security_check, keep JSESSIONID */ }
  headers() { return { Authorization: `Bearer ${this.token}` }; }
}
```

Swap the instance in `TimetableScreen` / `SettingsScreen` and personal
timetable, homework, exams and absences endpoints become reachable with the
same client.
