import type { App, Req } from '../http';
import { z } from 'zod';
import { addDays, adminGymUpdateSchema, dayKey, type AdminGymRow, type AdminStats } from '@gymverse/shared';
import type { Db } from '../db';
import { notFound } from '../errors';
import type { Ctx } from '../context';
import * as store from '../store';
import type { Row } from '../store';

const DAY_MS = 86_400_000;

function adminGymRow(db: Db, r: Row, now: Date): AdminGymRow {
  const gymId = r.id as string;
  const today = dayKey(now, r.timezone as string);
  const from30 = addDays(today, -29);
  const one = (sql: string, ...p: string[]) => (db.prepare(sql).get(...p) as { n: number | null }).n ?? 0;
  const owners = db
    .prepare(
      `SELECT u.id, u.name FROM gym_members m JOIN users u ON u.id = m.user_id
       WHERE m.gym_id = ? AND m.role = 'owner' AND m.status = 'active' ORDER BY m.joined_at`,
    )
    .all(gymId) as Array<{ id: string; name: string | null }>;
  return {
    id: gymId,
    name: r.name as string,
    city: r.city as string,
    joinCode: r.join_code as string,
    planTier: r.plan_tier as AdminGymRow['planTier'],
    suspended: r.suspended === 1,
    createdAt: r.created_at as string,
    owners: owners.map((o) => ({ id: o.id, name: o.name })),
    members: one("SELECT COUNT(*) AS n FROM gym_members WHERE gym_id = ? AND status = 'active'", gymId),
    activeMembers30d: one('SELECT COUNT(DISTINCT user_id) AS n FROM checkins WHERE gym_id = ? AND day >= ?', gymId, from30),
    checkIns30d: one('SELECT COUNT(*) AS n FROM checkins WHERE gym_id = ? AND day >= ?', gymId, from30),
    revenue30dPaise: one(
      "SELECT SUM(amount_paise) AS n FROM payments WHERE gym_id = ? AND status = 'paid' AND paid_at >= ?",
      gymId,
      new Date(now.getTime() - 30 * DAY_MS).toISOString(),
    ),
  };
}

/** The platform console for GymVerse staff. Everyone else (signed in or not) gets a plain 404. */
export function registerAdminRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  function requireAdmin(req: Req): string {
    let userId: string;
    try {
      userId = ctx.userIdOf(req);
    } catch {
      throw notFound('Not found');
    }
    if (!ctx.isPlatformAdmin(userId)) throw notFound('Not found');
    return userId;
  }

  app.get('/admin/stats', async (req): Promise<AdminStats> => {
    requireAdmin(req);
    const at = now();
    const gyms = db.prepare('SELECT id, timezone, suspended FROM gyms').all() as Array<{ id: string; timezone: string; suspended: number }>;
    const one = (sql: string, ...p: string[]) => (db.prepare(sql).get(...p) as { n: number | null }).n ?? 0;
    let checkInsToday = 0;
    let checkIns30d = 0;
    let weeklyActive = 0;
    for (const g of gyms) {
      const today = dayKey(at, g.timezone);
      checkInsToday += one('SELECT COUNT(*) AS n FROM checkins WHERE gym_id = ? AND day = ?', g.id, today);
      checkIns30d += one('SELECT COUNT(*) AS n FROM checkins WHERE gym_id = ? AND day >= ?', g.id, addDays(today, -29));
      weeklyActive += one(
        `SELECT COUNT(DISTINCT c.user_id) AS n FROM checkins c JOIN gym_members m ON m.gym_id = c.gym_id AND m.user_id = c.user_id
         WHERE c.gym_id = ? AND c.day >= ? AND m.role = 'member' AND m.status = 'active'`,
        g.id,
        addDays(today, -6),
      );
    }
    const members = one("SELECT COUNT(*) AS n FROM gym_members WHERE status = 'active' AND role = 'member'");
    return {
      gyms: gyms.length,
      suspendedGyms: gyms.filter((g) => g.suspended === 1).length,
      users: one('SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL'),
      members,
      checkInsToday,
      checkIns30d,
      revenue30dPaise: one("SELECT SUM(amount_paise) AS n FROM payments WHERE status = 'paid' AND paid_at >= ?", new Date(at.getTime() - 30 * DAY_MS).toISOString()),
      weeklyActiveRate: members ? Math.round((weeklyActive / members) * 1000) / 1000 : 0,
    };
  });

  app.get('/admin/gyms', async (req) => {
    requireAdmin(req);
    const { q } = z.object({ q: z.string().trim().max(60).optional() }).parse(req.query);
    const rows = (db.prepare('SELECT * FROM gyms ORDER BY created_at DESC, rowid DESC').all() as Row[]).filter(
      (r) => !q || store.matches(r.name as string, q) || store.matches(r.city as string, q) || store.matches(r.join_code as string, q),
    );
    return { gyms: rows.map((r) => adminGymRow(db, r, now())) };
  });

  app.patch('/admin/gyms/:id', async (req) => {
    const adminId = requireAdmin(req);
    const { id } = req.params as { id: string };
    const u = adminGymUpdateSchema.parse(req.body);
    const r = db.prepare('SELECT * FROM gyms WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw notFound('Gym not found');
    if (u.planTier !== undefined) db.prepare('UPDATE gyms SET plan_tier = ? WHERE id = ?').run(u.planTier, id);
    if (u.suspended !== undefined) db.prepare('UPDATE gyms SET suspended = ? WHERE id = ?').run(u.suspended ? 1 : 0, id);
    store.audit(db, id, adminId, 'admin.gym.update', JSON.stringify(u), now());
    return adminGymRow(db, db.prepare('SELECT * FROM gyms WHERE id = ?').get(id) as Row, now());
  });
}
