import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { fireTimes, KIND_ICON, Reminder } from './reminders';

let configured = false;

/** Show notifications even while the app is open. */
function configure() {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function ensurePermission(): Promise<boolean> {
  configure();
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Urnik',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export async function cancelScheduled(ids: string[]) {
  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // already fired or gone — nothing to do
    }
  }
}

/** Cancels whatever this reminder had scheduled and books the new times. */
export async function scheduleReminder(r: Reminder, dayHour: number): Promise<string[]> {
  configure();
  await cancelScheduled(r.scheduled);
  if (!r.notify) return [];
  if (!(await ensurePermission())) return [];

  const ids: string[] = [];
  for (const when of fireTimes(r, dayHour)) {
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: `${KIND_ICON[r.kind]} ${r.subject}`,
          body: r.note?.trim() || describeWhen(when, r),
          data: { reminderId: r.id },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
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
  configure();
  if (!(await ensurePermission())) return false;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🔔 Urnik',
        body: `Test · ${new Date().toLocaleTimeString()}`,
        data: { test: true },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
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
  try {
    return (await Notifications.getAllScheduledNotificationsAsync()).length;
  } catch {
    return 0;
  }
}
