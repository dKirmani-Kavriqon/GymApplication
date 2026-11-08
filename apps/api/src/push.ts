import type { Logger } from './log';
import type { NotificationKind } from '@gymverse/shared';
import type { Db } from './db';
import type { FetchFn } from './sms';
import type { CreatedNotification } from './domain/notifications';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
}

/** Expo push ticket: one per message, in order. */
export interface PushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Sends messages, returning one ticket per message. Injectable so tests never hit the network. */
export type PushSender = (messages: PushMessage[]) => Promise<PushTicket[]>;

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100;

export function createExpoPushSender(opts: { accessToken?: string; fetch?: FetchFn } = {}): PushSender {
  const fetchFn = opts.fetch ?? (globalThis.fetch as FetchFn);
  return async (messages) => {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH);
      const res = await fetchFn(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(opts.accessToken ? { authorization: `Bearer ${opts.accessToken}` } : {}),
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) throw new Error(`Expo push failed with HTTP ${res.status}`);
      const body = (await res.json()) as { data?: PushTicket[] };
      const data = body.data ?? [];
      for (let j = 0; j < batch.length; j++) tickets.push(data[j] ?? { status: 'error', message: 'missing ticket' });
    }
    return tickets;
  };
}

/** Which profile switch silences pushes of a kind (in-app notifications are still created). */
const PREF_FOR: Partial<Record<NotificationKind, string>> = {
  announcement: 'notify_announcements',
  booking: 'notify_class_reminders',
  class_reminder: 'notify_class_reminders',
  waitlist_promoted: 'notify_class_reminders',
  workout_reminder: 'notify_workout_reminders',
};

export interface PushDispatcher {
  enqueue(n: CreatedNotification): void;
  /** Sends everything queued so far. Tests await this; production lets it run in the background. */
  flush(): Promise<void>;
}

/**
 * Queues notifications as they are created (inside DB transactions) and pushes them once the
 * current synchronous work is done. A notification whose transaction rolled back no longer
 * exists by then and is skipped.
 */
export function createPushDispatcher(db: Db, sender: PushSender, log: () => Logger): PushDispatcher {
  let queue: CreatedNotification[] = [];
  let running: Promise<void> = Promise.resolve();
  let scheduled = false;

  async function send(batch: CreatedNotification[]): Promise<void> {
    const exists = db.prepare('SELECT 1 FROM notifications WHERE id = ?');
    const devices = db.prepare('SELECT token FROM devices WHERE user_id = ?');
    const messages: PushMessage[] = [];
    for (const n of batch) {
      if (!exists.get(n.id)) continue;
      const pref = PREF_FOR[n.kind];
      if (pref) {
        const p = db.prepare(`SELECT ${pref} AS on_ FROM profiles WHERE user_id = ?`).get(n.userId) as { on_: number } | undefined;
        if (p && p.on_ === 0) continue;
      }
      for (const d of devices.all(n.userId) as Array<{ token: string }>) {
        messages.push({
          to: d.token,
          title: n.title,
          body: n.body,
          sound: 'default',
          data: { notificationId: n.id, gymId: n.gymId, kind: n.kind, link: n.link },
        });
      }
    }
    if (!messages.length) return;
    try {
      const tickets = await sender(messages);
      const remove = db.prepare('DELETE FROM devices WHERE token = ?');
      tickets.forEach((t, i) => {
        if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' && messages[i]) remove.run(messages[i].to);
      });
    } catch (err) {
      log().warn({ err: (err as Error).message, count: messages.length }, 'push delivery failed');
    }
  }

  function flush(): Promise<void> {
    scheduled = false;
    const batch = queue;
    queue = [];
    running = running.then(() =>
      batch.length ? send(batch).catch((err) => log().warn({ err: (err as Error).message }, 'push dispatch failed')) : undefined,
    );
    return running;
  }

  return {
    enqueue(n) {
      queue.push(n);
      if (!scheduled) {
        scheduled = true;
        setTimeout(() => void flush(), 0);
      }
    },
    flush,
  };
}
