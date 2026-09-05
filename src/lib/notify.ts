import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { fireTimes, kindIcon, Reminder } from './reminders';

/**
 * expo-notifications is loaded lazily, on purpose.
 *
 * Since SDK 53 the library's own module-level code registers a push-token
 * listener, and Expo Go (Android) throws on that — which means a plain
 * `import ... from 'expo-notifications'` crashes the whole app at startup
 * inside Expo Go, even though this app only ever uses *local* notifications.
 *
 * A try/catch around the require is not enough: part of that registration runs
 * inside an async function, so the failure surfaces as an unhandled rejection
 * rather than a throw we could catch. So we check for Expo Go first and never
 * load the module there at all. In a real build — a dev build or the EAS APK —
 * it loads and behaves normally.
 */
const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null | undefined;

function notifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (IN_EXPO_GO) {
    cached = null; // loading it here would crash the app, not just fail
    return cached;
  }
  try {
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    cached = null; // Expo Go on SDK 53+ — no local notifications available
  }
  return cached;
}

/** True when notifications can't work here (i.e. running inside Expo Go). */
export function notificationsUnavailable(): boolean {
  return notifications() === null;
}

let configured = false;

/** Show notifications even while the app is open. */
function configure() {
  const N = notifications();
  if (!N || configured) return;
  configured = true;
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function ensurePermission(): Promise<boolean> {
  const N = notifications();
  if (!N) return false;
  configure();
  try {
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('reminders', {
        name: 'Urnik',
        importance: N.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
    const current = await N.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await N.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export async function cancelScheduled(ids: string[]) {
  const N = notifications();
  if (!N) return;
  for (const id of ids) {
    try {
      await N.cancelScheduledNotificationAsync(id);
    } catch {
      // already fired or gone — nothing to do
    }
  }
}

/** Cancels whatever this reminder had scheduled and books the new times. */
export async function scheduleReminder(
  r: Reminder,
  dayHour: number,
  minimalIcons = false,
): Promise<string[]> {
  const N = notifications();
  if (!N) return [];
  configure();
  await cancelScheduled(r.scheduled);
  if (!r.notify) return [];
  if (!(await ensurePermission())) return [];

  const ids: string[] = [];
  for (const when of fireTimes(r, dayHour)) {
    try {
      const id = await N.scheduleNotificationAsync({
        content: {
          title: `${kindIcon(r.kind, minimalIcons)} ${r.subject}`,
          body: r.note?.trim() || describeWhen(when, r),
          data: { reminderId: r.id },
        },
        trigger: {
          type: N.SchedulableTriggerInputTypes.DATE,
          date: when,
          channelId: 'reminders',
        },
      });
      ids.push(id);
    } catch {
      // a single failed slot shouldn't lose the rest
    }
  }
  return ids;
}

function describeWhen(when: Date, r: Reminder): string {
  const [y, m, d] = r.date.split('-').map(Number);
  const lesson = new Date(y, m - 1, d, Math.floor(r.startMin / 60), r.startMin % 60);
  const diffDays = Math.round((lesson.getTime() - when.getTime()) / 86_400_000);
  const hh = `${String(Math.floor(r.startMin / 60)).padStart(2, '0')}:${String(
    r.startMin % 60,
  ).padStart(2, '0')}`;
  if (diffDays >= 1) return `${d}. ${m}. ${hh} · ${r.room || ''}`.trim();
  return `${hh} · ${r.room || ''}`.trim();
}

/** Developer helper: fires a notification a few seconds from now. */
export async function sendTestNotification(delaySeconds = 5): Promise<boolean> {
  const N = notifications();
  if (!N) return false;
  configure();
  if (!(await ensurePermission())) return false;
  try {
    await N.scheduleNotificationAsync({
      content: {
        title: '🔔 Urnik',
        body: `Test · ${new Date().toLocaleTimeString()}`,
        data: { test: true },
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, delaySeconds),
        channelId: 'reminders',
        repeats: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** How many notifications are currently booked with the OS. */
export async function scheduledCount(): Promise<number> {
  const N = notifications();
  if (!N) return 0;
  try {
    return (await N.getAllScheduledNotificationsAsync()).length;
  } catch {
    return 0;
  }
}
