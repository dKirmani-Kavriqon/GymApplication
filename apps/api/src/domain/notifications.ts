import { randomUUID } from 'node:crypto';
import type { AppNotification, Gym, NotificationKind } from '@gymverse/shared';
import type { Db } from '../db';
import * as store from '../store';

// In-app notifications. Push delivery (FCM/APNs) is a TODO: it would hook in at `notify`.

export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string | null;
  /** Notifications with the same key are only ever created once per user and gym. */
  dedupeKey?: string;
}

type Row = Record<string, unknown>;

export interface CreatedNotification {
  id: string;
  gymId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
}

/** One listener per database (the app's push dispatcher). */
const listeners = new WeakMap<Db, (n: CreatedNotification) => void>();

export function onNotification(db: Db, listener: ((n: CreatedNotification) => void) | null): void {
  if (listener) listeners.set(db, listener);
  else listeners.delete(db);
}

/** Creates an in-app notification (once per dedupe key) and hands it to the push listener. Returns whether it was new. */
export function notify(db: Db, gymId: string, userId: string, n: NotificationInput, now: Date): boolean {
  const id = randomUUID();
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO notifications (id, gym_id, user_id, kind, title, body, link, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, gymId, userId, n.kind, n.title, n.body, n.link ?? null, n.dedupeKey ?? null, now.toISOString());
  if (res.changes === 0) return false;
  listeners.get(db)?.({ id, gymId, userId, kind: n.kind, title: n.title, body: n.body, link: n.link ?? null });
  return true;
}

/**
 * Fan-out to every active member of the gym (any role) except `exceptUserId`.
 * `pref` names a profile column (e.g. notify_announcements) people can switch off.
 */
export function notifyGym(
  db: Db,
  gymId: string,
  n: NotificationInput,
  now: Date,
  options: { exceptUserId?: string; pref?: 'notify_announcements' | 'notify_class_reminders' | 'notify_workout_reminders' } = {},
): number {
  const prefFilter = options.pref ? `AND COALESCE(p.${options.pref}, 1) = 1` : '';
  const rows = db
    .prepare(
      `SELECT m.user_id FROM gym_members m LEFT JOIN profiles p ON p.user_id = m.user_id
       WHERE m.gym_id = ? AND m.status = 'active' AND m.user_id != ? ${prefFilter}`,
    )
    .all(gymId, options.exceptUserId ?? '') as Array<{ user_id: string }>;
  for (const r of rows) notify(db, gymId, r.user_id, n, now);
  return rows.length;
}

/** Lazily creates the "membership ending soon" notification, once per subscription end date. */
export function ensureMembershipExpiring(db: Db, gym: Gym, userId: string, now: Date): void {
  const m = store.membershipFor(db, gym.id, userId, now);
  if (m.state !== 'expiring' || !m.endsAt) return;
  notify(
    db,
    gym.id,
    userId,
    {
      kind: 'membership_expiring',
      title: 'Your membership is ending soon',
      body: `Your ${m.planName ?? 'membership'} ends in ${m.daysLeft} day${m.daysLeft === 1 ? '' : 's'}. Renew to keep your streak going.`,
      link: 'membership',
      dedupeKey: `membership_expiring:${m.endsAt}`,
    },
    now,
  );
}

/** "Mon, 9 Nov, 7:00 am" in the gym's time zone, for notification text. */
export function formatWhen(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function unreadCount(db: Db, gymId: string, userId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE gym_id = ? AND user_id = ? AND read_at IS NULL').get(gymId, userId) as {
      n: number;
    }
  ).n;
}

export function mapNotification(r: Row): AppNotification {
  return {
    id: r.id as string,
    kind: r.kind as NotificationKind,
    title: r.title as string,
    body: r.body as string,
    createdAt: r.created_at as string,
    read: r.read_at !== null && r.read_at !== undefined,
    link: (r.link as string) ?? null,
  };
}
