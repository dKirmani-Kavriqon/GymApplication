import type { App } from '../http';
import { z } from 'zod';
import {
  ADMIN_ROLES,
  STAFF_ROLES,
  addDays,
  computeStreak,
  dayKey,
  daysBetween,
  hourOf,
  mondayOf,
  nudgeSchema,
  phoneSchema,
  roleUpdateSchema,
  type AttendanceReport,
  type Gym,
  type MemberRow,
  type MemberSummary,
  type Role,
  type WeeklyGoal,
} from '@gymverse/shared';
import { tx, type Db } from '../db';
import { HttpError, notFound } from '../errors';
import { upsertUserByPhone } from '../auth';
import type { Ctx } from '../context';
import * as store from '../store';
import { ensureMembershipExpiring, notify, unreadCount } from '../domain/notifications';
import { mapChallenge } from '../domain/challenges';
import { assignedRoutineRows, mapRoutine, presetRoutineRows } from '../domain/workouts';
import { crowdFor } from './checkins';

/** Member import accepts larger bodies (spreadsheets of thousands of rows). */
const IMPORT_BODY_LIMIT = 2 * 1024 * 1024;

const AT_RISK_DAYS = 14;

/** Monday-start week in the gym time zone; `days` are the member's check-in days. */
export function weeklyGoal(days: string[], today: string, goal: number): WeeklyGoal {
  const monday = mondayOf(today);
  const set = new Set(days);
  const week: number[] = Array.from({ length: 7 }, (_, i) => (set.has(addDays(monday, i)) ? 1 : 0));
  const visits = week.reduce((s, n) => s + n, 0);
  const lastWeek = Array.from({ length: 7 }, (_, i) => addDays(monday, i - 7)).filter((d) => set.has(d)).length;
  return {
    goal,
    visits,
    percent: Math.min(100, Math.round((visits / Math.max(1, goal)) * 100)),
    deltaVsLastWeek: visits - lastWeek,
    days: week,
  };
}

function activeChallengeFor(db: Db, gym: Gym, userId: string, now: Date) {
  if (!gym.enabledFeatures.includes('community')) return null;
  const today = dayKey(now, gym.timezone);
  const joined = db
    .prepare(
      `SELECT c.* FROM challenges c JOIN challenge_participants p ON p.challenge_id = c.id AND p.gym_id = c.gym_id
       WHERE c.gym_id = ? AND p.user_id = ? AND c.starts_on <= ? AND c.ends_on >= ? ORDER BY c.ends_on, c.created_at DESC LIMIT 1`,
    )
    .get(gym.id, userId, today, today) as store.Row | undefined;
  const row =
    joined ??
    (db
      .prepare('SELECT * FROM challenges WHERE gym_id = ? AND starts_on <= ? AND ends_on >= ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(gym.id, today, today) as store.Row | undefined);
  return row ? mapChallenge(db, gym, row, userId, now) : null;
}

function recommendedRoutineFor(db: Db, gym: Gym, userId: string) {
  if (!gym.enabledFeatures.includes('workouts')) return null;
  const row = assignedRoutineRows(db, gym.id, userId)[0] ?? presetRoutineRows(db, gym.id)[0];
  return row ? mapRoutine(db, row, userId) : null;
}

export function registerMemberRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;


  app.get('/gyms/:gymId/me/summary', async (req): Promise<MemberSummary> => {
    const { gym, userId } = ctx.gymAccess(req);
    const at = now();
    const today = dayKey(at, gym.timezone);
    const days = store.checkInDays(db, gym.id, userId);
    const next = db
      .prepare(
        `SELECT c.* FROM class_sessions c JOIN bookings b ON b.session_id = c.id AND b.gym_id = c.gym_id
         WHERE c.gym_id = ? AND b.user_id = ? AND c.starts_at > ? ORDER BY c.starts_at LIMIT 1`,
      )
      .get(gym.id, userId, at.toISOString()) as Record<string, unknown> | undefined;
    const ann = db
      .prepare('SELECT * FROM announcements WHERE gym_id = ? ORDER BY pinned DESC, created_at DESC LIMIT 1')
      .get(gym.id) as Record<string, unknown> | undefined;
    const since = addDays(today, -27);
    ensureMembershipExpiring(db, gym, userId, at);
    return {
      checkedInToday: days.includes(today),
      streak: computeStreak(days, today),
      totalCheckIns: days.length,
      badges: store.memberBadges(db, gym.id, userId),
      nextClass: next ? store.mapSession(db, next, userId) : null,
      announcement: ann ? store.mapAnnouncement(ann) : null,
      membership: store.membershipFor(db, gym.id, userId, at),
      recentDays: days.filter((d) => d >= since),
      weekly: weeklyGoal(days, today, store.getProfile(db, userId).weeklyGoal),
      unreadNotifications: unreadCount(db, gym.id, userId),
      activeChallenge: activeChallengeFor(db, gym, userId, at),
      recommendedRoutine: recommendedRoutineFor(db, gym, userId),
      crowd: crowdFor(db, gym, at),
    };
  });

  // ---------- staff: members & reports ----------

  app.get('/gyms/:gymId/members', async (req) => {
    const { gym } = ctx.gymAccess(req, STAFF_ROLES);
    const at = now();
    const today = dayKey(at, gym.timezone);
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.phone, m.role, m.joined_at,
                (SELECT MAX(day) FROM checkins c WHERE c.gym_id = m.gym_id AND c.user_id = u.id) AS last_visit,
                (SELECT COUNT(*) FROM checkins c WHERE c.gym_id = m.gym_id AND c.user_id = u.id) AS total
         FROM gym_members m JOIN users u ON u.id = m.user_id
         WHERE m.gym_id = ? AND m.status = 'active' ORDER BY u.name COLLATE NOCASE, u.phone`,
      )
      .all(gym.id) as Array<{ id: string; name: string | null; phone: string; role: Role; joined_at: string; last_visit: string | null; total: number }>;
    const members: MemberRow[] = rows.map((r) => {
      const reference = r.last_visit ?? dayKey(new Date(r.joined_at), gym.timezone);
      const membership = store.membershipFor(db, gym.id, r.id, at);
      return {
        userId: r.id,
        name: r.name,
        phone: r.phone,
        role: r.role,
        joinedAt: r.joined_at,
        lastVisit: r.last_visit,
        totalCheckIns: r.total,
        membership: { state: membership.state, daysLeft: membership.daysLeft, endsAt: membership.endsAt },
        atRisk: r.role === 'member' && daysBetween(reference, today) >= AT_RISK_DAYS,
      };
    });
    return { members };
  });

  app.post('/gyms/:gymId/members/import', { bodyLimit: IMPORT_BODY_LIMIT }, async (req) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    const { rows } = z
      .object({ rows: z.array(z.object({ phone: phoneSchema, name: z.string().trim().max(60).optional() })).min(1).max(5000) })
      .parse(req.body);
    const result = tx(db, () => {
      let created = 0;
      let added = 0;
      for (const r of rows) {
        const u = upsertUserByPhone(db, r.phone, now());
        if (u.isNew) created++;
        if (r.name) db.prepare('UPDATE users SET name = COALESCE(name, ?) WHERE id = ?').run(r.name, u.id);
        if (!store.getRole(db, gym.id, u.id)) {
          store.addMember(db, gym.id, u.id, 'member', now());
          added++;
        }
      }
      return { created, added, skipped: rows.length - added };
    });
    store.audit(db, gym.id, userId, 'members.import', String(rows.length), now());
    return result;
  });

  app.patch('/gyms/:gymId/members/:memberId', async (req) => {
    const { gym, userId } = ctx.gymAccess(req, ['owner']);
    const { memberId } = req.params as { memberId: string };
    const { role } = roleUpdateSchema.parse(req.body);
    const current = store.getRole(db, gym.id, memberId);
    if (!current) throw notFound('Member not found');
    if (current === 'owner' && role !== 'owner') {
      const { n } = db.prepare("SELECT COUNT(*) AS n FROM gym_members WHERE gym_id = ? AND role = 'owner' AND status = 'active'").get(gym.id) as {
        n: number;
      };
      if (n <= 1) throw new HttpError(409, 'last_owner', 'A gym needs at least one owner.');
    }
    db.prepare('UPDATE gym_members SET role = ? WHERE gym_id = ? AND user_id = ?').run(role, gym.id, memberId);
    store.audit(db, gym.id, userId, `member.role.${role}`, memberId, now());
    return { userId: memberId, role };
  });

  app.delete('/gyms/:gymId/members/:memberId', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    const { memberId } = req.params as { memberId: string };
    const role = store.getRole(db, gym.id, memberId);
    if (!role) throw notFound('Member not found');
    if (role === 'owner') throw new HttpError(409, 'cannot_remove_owner', 'Owners cannot be removed.');
    db.prepare("UPDATE gym_members SET status = 'inactive' WHERE gym_id = ? AND user_id = ?").run(gym.id, memberId);
    store.audit(db, gym.id, userId, 'member.deactivate', memberId, now());
    return reply.status(204).send();
  });

  app.post('/gyms/:gymId/members/:memberId/nudge', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    const { memberId } = req.params as { memberId: string };
    if (!store.getRole(db, gym.id, memberId)) throw notFound('Member not found');
    const { kind, message } = nudgeSchema.parse(req.body);
    const today = dayKey(now(), gym.timezone);
    const created = notify(
      db,
      gym.id,
      memberId,
      kind === 'renewal'
        ? {
            kind: 'membership_expiring',
            title: `Time to renew at ${gym.name}`,
            body: message || 'Your membership is ending soon. Renew in the app to keep your streak going.',
            link: 'membership',
            dedupeKey: `nudge:renewal:${today}`,
          }
        : {
            kind: 'system',
            title: `We miss you at ${gym.name}`,
            body: message || "It's been a while! Drop in this week; your streak is waiting.",
            link: null,
            dedupeKey: `nudge:inactive:${today}`,
          },
      now(),
    );
    if (!created) throw new HttpError(409, 'already_nudged', 'This member already got that reminder today.');
    store.audit(db, gym.id, userId, `member.nudge.${kind}`, memberId, now());
    return reply.status(204).send();
  });

  app.get('/gyms/:gymId/reports/attendance', async (req): Promise<AttendanceReport> => {
    const { gym } = ctx.gymAccess(req, STAFF_ROLES);
    const at = now();
    const today = dayKey(at, gym.timezone);
    const from14 = addDays(today, -13);
    const from30 = addDays(today, -29);
    const counts = new Map(
      (db.prepare('SELECT day, COUNT(*) AS n FROM checkins WHERE gym_id = ? AND day >= ? GROUP BY day').all(gym.id, from14) as Array<{
        day: string;
        n: number;
      }>).map((r) => [r.day, r.n]),
    );
    const days = Array.from({ length: 14 }, (_, i) => {
      const day = addDays(from14, i);
      return { day, count: counts.get(day) ?? 0 };
    });
    const hours = new Array(24).fill(0) as number[];
    for (const r of db.prepare('SELECT checked_in_at FROM checkins WHERE gym_id = ? AND day >= ?').all(gym.id, from30) as Array<{
      checked_in_at: string;
    }>) {
      hours[hourOf(new Date(r.checked_in_at), gym.timezone)]++;
    }
    const active = db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM checkins WHERE gym_id = ? AND day >= ?').get(gym.id, from30) as {
      n: number;
    };
    const total = db
      .prepare("SELECT COUNT(*) AS n FROM gym_members WHERE gym_id = ? AND role = 'member' AND status = 'active'")
      .get(gym.id) as { n: number };
    return {
      days,
      peakHours: hours.map((count, hour) => ({ hour, count })),
      today: counts.get(today) ?? 0,
      activeMembers: active.n,
      totalMembers: total.n,
    };
  });
}
