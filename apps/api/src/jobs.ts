import { dayKey, hourOf, type Gym } from '@gymverse/shared';
import type { Ctx } from './context';
import * as store from './store';
import type { Row } from './store';
import { formatWhen, notify } from './domain/notifications';

/**
 * Background jobs. `server.ts` calls `start()`; tests call the job functions directly with their
 * own clock. Every job is idempotent (notification dedupe keys), so a restart or an overlapping
 * tick never sends twice.
 */
export interface Jobs {
  /** Booked members of classes starting in 55–65 minutes (respects notifyClassReminders). */
  classReminders(now?: Date): number;
  /** At 09:00 gym time: members whose membership ends within 3 days, once per day. */
  expiryReminders(now?: Date): number;
  /** Deletes OTP rows older than 7 days. */
  pruneOtps(now?: Date): number;
  /** One scheduler tick: class reminders always, expiry reminders in the 09:00 hour, OTP pruning daily. */
  tick(now?: Date): void;
  start(intervalMs?: number): void;
  stop(): void;
}

export const JOB_INTERVAL_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

export function createJobs(ctx: Ctx): Jobs {
  const { db } = ctx;
  let timer: NodeJS.Timeout | null = null;
  let lastPrune = 0;

  const activeGyms = (): Gym[] =>
    (db.prepare('SELECT * FROM gyms WHERE suspended = 0').all() as Row[]).map(store.mapGym);

  function classReminders(now = ctx.now()): number {
    const from = new Date(now.getTime() + 55 * 60_000).toISOString();
    const to = new Date(now.getTime() + 65 * 60_000).toISOString();
    const rows = db
      .prepare(
        `SELECT c.id, c.gym_id, c.title, c.starts_at, b.user_id, g.timezone FROM class_sessions c
         JOIN gyms g ON g.id = c.gym_id
         JOIN bookings b ON b.session_id = c.id AND b.gym_id = c.gym_id AND b.status = 'booked'
         JOIN gym_members m ON m.gym_id = c.gym_id AND m.user_id = b.user_id AND m.status = 'active'
         LEFT JOIN profiles p ON p.user_id = b.user_id
         WHERE g.suspended = 0 AND c.starts_at >= ? AND c.starts_at <= ? AND COALESCE(p.notify_class_reminders, 1) = 1`,
      )
      .all(from, to) as Array<{ id: string; gym_id: string; title: string; starts_at: string; user_id: string; timezone: string }>;
    let sent = 0;
    for (const r of rows) {
      const created = notify(
        db,
        r.gym_id,
        r.user_id,
        {
          kind: 'class_reminder',
          title: `${r.title} starts in an hour`,
          body: `Your class starts at ${formatWhen(r.starts_at, r.timezone)}. See you there!`,
          link: 'classes',
          dedupeKey: `class_reminder:${r.id}`,
        },
        now,
      );
      if (created) sent++;
    }
    return sent;
  }

  function expiryReminders(now = ctx.now()): number {
    let sent = 0;
    for (const gym of activeGyms()) {
      const today = dayKey(now, gym.timezone);
      const members = db
        .prepare("SELECT user_id FROM gym_members WHERE gym_id = ? AND status = 'active'")
        .all(gym.id) as Array<{ user_id: string }>;
      for (const { user_id } of members) {
        const m = store.membershipFor(db, gym.id, user_id, now);
        if (m.state !== 'expiring' || !m.endsAt || m.daysLeft > 3) continue;
        const created = notify(
          db,
          gym.id,
          user_id,
          {
            kind: 'membership_expiring',
            title: m.daysLeft === 1 ? 'Your membership ends tomorrow' : `Your membership ends in ${m.daysLeft} days`,
            body: `Renew your ${m.planName ?? 'membership'} in the app to keep training without a break.`,
            link: 'membership',
            dedupeKey: `membership_reminder:${m.endsAt}:${today}`,
          },
          now,
        );
        if (created) sent++;
      }
    }
    return sent;
  }

  function pruneOtps(now = ctx.now()): number {
    return Number(db.prepare('DELETE FROM otp_codes WHERE created_at < ?').run(new Date(now.getTime() - 7 * DAY_MS).toISOString()).changes);
  }

  function tick(now = ctx.now()): void {
    const run = (name: string, fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        ctx.log().error({ job: name, err: (err as Error).message }, 'job failed');
      }
    };
    run('classReminders', () => classReminders(now));
    // Expiry reminders go out in each gym's 09:00 hour; dedupe keys keep it to one per day.
    run('expiryReminders', () => {
      const due = activeGyms().some((g) => hourOf(now, g.timezone) === 9);
      if (due) expiryReminders(now);
    });
    if (now.getTime() - lastPrune >= DAY_MS) {
      lastPrune = now.getTime();
      run('pruneOtps', () => pruneOtps(now));
    }
  }

  return {
    classReminders,
    expiryReminders,
    pruneOtps,
    tick,
    start(intervalMs = JOB_INTERVAL_MS) {
      if (timer) return;
      timer = setInterval(() => tick(), intervalMs);
      timer.unref();
      tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
