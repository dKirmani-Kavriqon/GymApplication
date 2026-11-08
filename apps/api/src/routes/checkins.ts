import type { App } from '../http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  ADMIN_ROLES,
  computeStreak,
  crowdLevel,
  dayKey,
  qrCheckInSchema,
  type CheckInResult,
  type Crowd,
  type DoorCode,
  type Gym,
} from '@gymverse/shared';
import { tx, type Db } from '../db';
import { HttpError } from '../errors';
import type { Ctx } from '../context';
import * as store from '../store';

/** Offline check-ins are accepted up to this old. */
export const MAX_OFFLINE_AGE_MS = 12 * 3600_000;
/** Allowance for phone clocks running slightly fast. */
const CLOCK_SKEW_MS = 2 * 60_000;
const CROWD_WINDOW_MS = 90 * 60_000;

export function crowdFor(db: Db, gym: Gym, now: Date): Crowd {
  const since = new Date(now.getTime() - CROWD_WINDOW_MS).toISOString();
  const recent = (
    db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE gym_id = ? AND checked_in_at >= ? AND checked_in_at <= ?').get(gym.id, since, now.toISOString()) as {
      n: number;
    }
  ).n;
  const members = (db.prepare("SELECT COUNT(*) AS n FROM gym_members WHERE gym_id = ? AND status = 'active'").get(gym.id) as { n: number }).n;
  return { level: crowdLevel(recent, members), recentCheckIns: recent };
}

function mapDoorCode(r: { token: string; rotated_at: string }): DoorCode {
  return { token: r.token, url: `gymverse://checkin/${r.token}`, rotatedAt: r.rotated_at };
}

function newDoorToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Records a check-in for `day` if there is none yet; returns whether it was new. */
export function recordCheckIn(db: Db, gym: Gym, userId: string, day: string, at: Date, method: string): boolean {
  const branch = db.prepare('SELECT id FROM branches WHERE gym_id = ? ORDER BY created_at LIMIT 1').get(gym.id) as { id: string } | undefined;
  const res = db
    .prepare('INSERT OR IGNORE INTO checkins (id, gym_id, user_id, branch_id, day, checked_in_at, method) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), gym.id, userId, branch?.id ?? null, day, at.toISOString(), method);
  return res.changes > 0;
}

export function registerCheckinRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  app.post('/gyms/:gymId/checkins', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'checkin');
    ctx.rateLimit('checkin', userId);
    const body = qrCheckInSchema.parse(req.body ?? {});
    const at = now();

    if (body.method === 'qr') {
      const door = db.prepare('SELECT token FROM door_codes WHERE gym_id = ?').get(gym.id) as { token: string } | undefined;
      const given = Buffer.from(body.doorToken ?? '');
      const ok = door && given.length === Buffer.byteLength(door.token) && timingSafeEqual(given, Buffer.from(door.token));
      if (!ok) throw new HttpError(403, 'bad_door_code', 'That QR code is not valid for this gym. Scan the code at the front desk.');
    }

    let when = at;
    if (body.occurredAt) {
      when = new Date(body.occurredAt);
      const age = at.getTime() - when.getTime();
      if (age < -CLOCK_SKEW_MS || age > MAX_OFFLINE_AGE_MS) {
        throw new HttpError(400, 'bad_occurred_at', 'That check-in is too old to record. Check in again at the gym.');
      }
      if (when > at) when = at;
    }

    const today = dayKey(at, gym.timezone);
    const day = dayKey(when, gym.timezone);
    const result = tx(db, (): CheckInResult => {
      const existing = db
        .prepare('SELECT checked_in_at FROM checkins WHERE gym_id = ? AND user_id = ? AND day = ?')
        .get(gym.id, userId, day) as { checked_in_at: string } | undefined;
      if (!existing) recordCheckIn(db, gym, userId, day, when, body.method);
      const days = store.checkInDays(db, gym.id, userId);
      return {
        alreadyCheckedIn: Boolean(existing),
        checkedInAt: existing?.checked_in_at ?? when.toISOString(),
        streak: computeStreak(days, today),
        newBadges: existing ? [] : store.syncBadges(db, gym, userId, at),
        totalCheckIns: days.length,
      };
    });
    return reply.status(result.alreadyCheckedIn ? 200 : 201).send(result);
  });

  app.get('/gyms/:gymId/door-code', async (req) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    let r = db.prepare('SELECT token, rotated_at FROM door_codes WHERE gym_id = ?').get(gym.id) as { token: string; rotated_at: string } | undefined;
    if (!r) {
      r = { token: newDoorToken(), rotated_at: now().toISOString() };
      db.prepare('INSERT INTO door_codes (gym_id, token, rotated_at) VALUES (?, ?, ?)').run(gym.id, r.token, r.rotated_at);
      store.audit(db, gym.id, userId, 'door_code.create', null, now());
    }
    return mapDoorCode(r);
  });

  app.post('/gyms/:gymId/door-code/rotate', async (req) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    const r = { token: newDoorToken(), rotated_at: now().toISOString() };
    db.prepare(
      'INSERT INTO door_codes (gym_id, token, rotated_at) VALUES (?, ?, ?) ON CONFLICT (gym_id) DO UPDATE SET token = excluded.token, rotated_at = excluded.rotated_at',
    ).run(gym.id, r.token, r.rotated_at);
    store.audit(db, gym.id, userId, 'door_code.rotate', null, now());
    return mapDoorCode(r);
  });
}
