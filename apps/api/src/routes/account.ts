import type { App } from '../http';
import {
  CURRENT_TERMS_VERSION,
  consentSchema,
  deleteAccountSchema,
  deviceSchema,
  isMinor,
  type AccountExport,
  type ConsentState,
} from '@gymverse/shared';
import { tx, type Db } from '../db';
import { HttpError } from '../errors';
import type { Ctx } from '../context';
import * as store from '../store';
import type { Row } from '../store';
import { listWorkouts } from '../domain/workouts';

export function consentState(db: Db, userId: string, now: Date): ConsentState {
  const c = db.prepare('SELECT * FROM consents WHERE user_id = ?').get(userId) as Row | undefined;
  const minor = isMinor(store.getProfile(db, userId).birthYear, now);
  const guardianConsent = c?.guardian_consent === 1;
  return {
    termsVersion: (c?.terms_version as string) ?? null,
    acceptedAt: (c?.accepted_at as string) ?? null,
    guardianConsent,
    guardianName: (c?.guardian_name as string) ?? null,
    needsConsent: !c || c.terms_version !== CURRENT_TERMS_VERSION,
    needsGuardian: minor && !guardianConsent,
  };
}

const DELETED_NAME = 'Deleted member';

/**
 * DPDP-style account erasure. The users row stays as an anonymous tombstone ("Deleted member",
 * phone released) so posts, comments and tickets other people replied to still make sense;
 * everything personal is removed. Payments stay for the gym's accounts with user_id cleared.
 */
export function deleteAccount(db: Db, userId: string, now: Date): void {
  const owned = db
    .prepare(
      `SELECT g.id, g.name,
              (SELECT COUNT(*) FROM gym_members o WHERE o.gym_id = g.id AND o.role = 'owner' AND o.status = 'active') AS owners,
              (SELECT COUNT(*) FROM gym_members o WHERE o.gym_id = g.id AND o.status = 'active' AND o.user_id != ?) AS others
       FROM gyms g JOIN gym_members m ON m.gym_id = g.id
       WHERE m.user_id = ? AND m.role = 'owner' AND m.status = 'active'`,
    )
    .all(userId, userId) as Array<{ id: string; name: string; owners: number; others: number }>;
  const blocking = owned.filter((g) => g.owners === 1 && g.others > 0);
  if (blocking.length) {
    throw new HttpError(
      409,
      'sole_owner',
      `You are the only owner of ${blocking.map((g) => g.name).join(', ')}. Make someone else an owner before deleting your account.`,
    );
  }
  const phone = (db.prepare('SELECT phone FROM users WHERE id = ?').get(userId) as { phone: string }).phone;
  tx(db, () => {
    // A gym nobody else belongs to goes with its only owner.
    for (const g of owned.filter((x) => x.owners === 1 && x.others === 0)) db.prepare('DELETE FROM gyms WHERE id = ?').run(g.id);
    db.prepare('UPDATE payments SET user_id = NULL WHERE user_id = ?').run(userId);
    for (const table of [
      'checkins',
      'bookings',
      'subscriptions',
      'workout_logs',
      'measurements',
      'notifications',
      'favourites',
      'post_likes',
      'challenge_participants',
      'routine_assignments',
      'user_badges',
      'freeze_requests',
      'devices',
      'consents',
      'gym_members',
      'profiles',
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
    // Their private routines are personal data; presets they published for a gym stay.
    db.prepare("DELETE FROM routines WHERE created_by = ? AND kind = 'custom'").run(userId);
    db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(phone);
    db.prepare('UPDATE users SET phone = ?, name = ?, avatar_url = NULL, deleted_at = ? WHERE id = ?').run(
      `deleted:${userId}`,
      DELETED_NAME,
      now.toISOString(),
      userId,
    );
  });
}

export function registerAccountRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  app.post('/me/devices', async (req, reply) => {
    const userId = ctx.userIdOf(req);
    const d = deviceSchema.parse(req.body);
    const ts = now().toISOString();
    // A token belongs to one phone; if someone else logs in on it, it moves to them.
    db.prepare(
      `INSERT INTO devices (token, user_id, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at`,
    ).run(d.token, userId, d.platform, ts, ts);
    return reply.status(204).send();
  });

  app.delete('/me/devices/:token', async (req, reply) => {
    const userId = ctx.userIdOf(req);
    const { token } = req.params as { token: string };
    db.prepare('DELETE FROM devices WHERE token = ? AND user_id = ?').run(token, userId);
    return reply.status(204).send();
  });

  app.post('/me/consent', async (req) => {
    const userId = ctx.userIdOf(req);
    const c = consentSchema.parse(req.body);
    if (isMinor(store.getProfile(db, userId).birthYear, now()) && c.guardianConsent !== true) {
      throw new HttpError(400, 'guardian_required', 'Members under 18 need a parent or guardian to agree as well.');
    }
    db.prepare(
      `INSERT INTO consents (user_id, terms_version, accepted_at, guardian_consent, guardian_name) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET terms_version = excluded.terms_version, accepted_at = excluded.accepted_at,
         guardian_consent = excluded.guardian_consent, guardian_name = excluded.guardian_name`,
    ).run(userId, c.termsVersion, now().toISOString(), c.guardianConsent ? 1 : 0, c.guardianName ?? null);
    return consentState(db, userId, now());
  });

  app.get('/me/export', async (req): Promise<AccountExport> => {
    const userId = ctx.userIdOf(req);
    const all = (sql: string, ...params: string[]) => db.prepare(sql).all(...params) as Row[];
    const memberships = all(
      `SELECT g.id AS gymId, g.name AS gymName, m.role, m.status, m.joined_at AS joinedAt
       FROM gym_members m JOIN gyms g ON g.id = m.gym_id WHERE m.user_id = ? ORDER BY m.joined_at`,
      userId,
    );
    const tickets = all('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at', userId).map((t) => ({
      ...t,
      messages: all('SELECT from_role, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, rowid', t.id as string),
    }));
    const gymIds = memberships.map((m) => m.gymId as string);
    return {
      exportedAt: now().toISOString(),
      user: store.getUser(db, userId),
      profile: { ...store.getProfile(db, userId), consent: consentState(db, userId, now()) },
      memberships,
      checkIns: all('SELECT gym_id, day, checked_in_at, method FROM checkins WHERE user_id = ? ORDER BY checked_in_at', userId),
      bookings: all(
        `SELECT b.gym_id, c.title, c.starts_at, b.status, b.attended, b.created_at FROM bookings b
         JOIN class_sessions c ON c.id = b.session_id WHERE b.user_id = ? ORDER BY c.starts_at`,
        userId,
      ),
      payments: all(
        `SELECT p.gym_id, pl.name AS plan_name, p.amount_paise, p.discount_paise, p.status, p.receipt_number, p.created_at, p.paid_at
         FROM payments p JOIN plans pl ON pl.id = p.plan_id WHERE p.user_id = ? ORDER BY p.created_at`,
        userId,
      ),
      workouts: gymIds.flatMap((g) => listWorkouts(db, g, userId, 10_000).map((w) => ({ gymId: g, ...w }))),
      measurements: all('SELECT measured_on, weight_kg, body_fat_pct, waist_cm FROM measurements WHERE user_id = ? ORDER BY measured_on', userId),
      posts: all('SELECT id, gym_id, body, hidden, created_at FROM posts WHERE author_id = ? ORDER BY created_at', userId),
      comments: all('SELECT id, gym_id, post_id, body, created_at FROM comments WHERE author_id = ? ORDER BY created_at', userId),
      tickets,
      notifications: all('SELECT gym_id, kind, title, body, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at', userId),
    };
  });

  app.delete('/me', async (req, reply) => {
    const userId = ctx.userIdOf(req);
    deleteAccountSchema.parse(req.body ?? {});
    deleteAccount(db, userId, now());
    req.log.info({ action: 'account.delete' }, 'account deleted');
    return reply.status(204).send();
  });
}
