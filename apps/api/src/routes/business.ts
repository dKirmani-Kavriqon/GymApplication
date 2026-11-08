import type { App } from '../http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ADMIN_ROLES,
  MAX_FREEZE_DAYS,
  addDays,
  dayKey,
  daysBetween,
  freezeDecisionSchema,
  freezeRequestSchema,
  type FreezeRequest,
  type RevenueReport,
} from '@gymverse/shared';
import { tx, type Db } from '../db';
import { HttpError, notFound } from '../errors';
import type { Ctx } from '../context';
import * as store from '../store';
import type { Row } from '../store';
import { notify } from '../domain/notifications';

/** What the membership end date becomes after the pause; null without an active membership. */
function endAfterFreeze(db: Db, gymId: string, userId: string, days: number, now: Date): string | null {
  const ms = store.membershipFor(db, gymId, userId, now);
  if (!ms.endsAt || (ms.state !== 'active' && ms.state !== 'expiring')) return null;
  return new Date(new Date(ms.endsAt).getTime() + days * 86_400_000).toISOString();
}

function mapFreeze(db: Db, r: Row, now: Date): FreezeRequest {
  const status = r.status as FreezeRequest['status'];
  return {
    id: r.id as string,
    member: store.personRef(db, r.user_id as string),
    startsOn: r.starts_on as string,
    endsOn: r.ends_on as string,
    days: r.days as number,
    reason: r.reason as string,
    status,
    note: (r.note as string) ?? null,
    createdAt: r.created_at as string,
    decidedAt: (r.decided_at as string) ?? null,
    newEndsAt:
      status === 'pending'
        ? endAfterFreeze(db, r.gym_id as string, r.user_id as string, r.days as number, now)
        : status === 'approved'
          ? ((r.new_ends_at as string) ?? null)
          : null,
  };
}

export function registerBusinessRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  // ---------- revenue ----------

  app.get('/gyms/:gymId/reports/revenue', async (req): Promise<RevenueReport> => {
    const { gym } = ctx.gymAccess(req, ADMIN_ROLES);
    const at = now();
    const today = dayKey(at, gym.timezone);
    const thisMonth = today.slice(0, 7);
    const lastMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7);
    const from30 = addDays(today, -29);
    // Paid payments from the start of last month (or 30 days ago, whichever is earlier), bucketed by gym-local day.
    const since = [from30, `${lastMonth}-01`].sort()[0];
    const paid = (
      db
        .prepare(
          `SELECT p.plan_id, pl.name AS plan_name, p.amount_paise, p.discount_paise, p.paid_at FROM payments p
           JOIN plans pl ON pl.id = p.plan_id WHERE p.gym_id = ? AND p.status = 'paid' AND p.paid_at >= ?`,
        )
        .all(gym.id, new Date(`${addDays(since, -1)}T00:00:00.000Z`).toISOString()) as Array<{
        plan_id: string;
        plan_name: string;
        amount_paise: number;
        discount_paise: number;
        paid_at: string;
      }>
    ).map((p) => ({ ...p, day: dayKey(new Date(p.paid_at), gym.timezone) }));
    const sum = (list: typeof paid, f: (p: (typeof paid)[number]) => number) => list.reduce((s, p) => s + f(p), 0);
    const inMonth = (m: string) => paid.filter((p) => p.day.startsWith(m));
    const last30 = paid.filter((p) => p.day >= from30 && p.day <= today);

    const byPlan = new Map<string, RevenueReport['byPlan'][number]>();
    for (const p of last30) {
      const e = byPlan.get(p.plan_id) ?? { planId: p.plan_id, planName: p.plan_name, count: 0, paise: 0 };
      e.count++;
      e.paise += p.amount_paise;
      byPlan.set(p.plan_id, e);
    }

    const members = db
      .prepare(
        `SELECT u.id, u.name, u.phone FROM gym_members m JOIN users u ON u.id = m.user_id
         WHERE m.gym_id = ? AND m.status = 'active' AND m.role = 'member'`,
      )
      .all(gym.id) as Array<{ id: string; name: string | null; phone: string }>;
    const renewalsDue: RevenueReport['renewalsDue'] = [];
    let unpaid = 0;
    for (const m of members) {
      const ms = store.membershipFor(db, gym.id, m.id, at);
      if (ms.state === 'none' || ms.state === 'expired') unpaid++;
      else if (ms.state === 'expiring' && ms.endsAt) {
        renewalsDue.push({ userId: m.id, name: m.name, phone: m.phone, endsAt: ms.endsAt, planName: ms.planName ?? '' });
      }
    }
    renewalsDue.sort((a, b) => a.endsAt.localeCompare(b.endsAt));

    return {
      collectedThisMonthPaise: sum(inMonth(thisMonth), (p) => p.amount_paise),
      collectedLastMonthPaise: sum(inMonth(lastMonth), (p) => p.amount_paise),
      daily: Array.from({ length: 30 }, (_, i) => {
        const day = addDays(from30, i);
        return { day, paise: sum(paid.filter((p) => p.day === day), (p) => p.amount_paise) };
      }),
      byPlan: [...byPlan.values()].sort((a, b) => b.paise - a.paise),
      renewalsDue,
      unpaidMembers: unpaid,
      couponDiscountsThisMonthPaise: sum(inMonth(thisMonth), (p) => p.discount_paise),
    };
  });

  // ---------- membership freeze ----------

  app.get('/gyms/:gymId/freeze-requests', async (req) => {
    const { gym, userId, role } = ctx.gymAccess(req);
    const { status } = z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }).parse(req.query);
    const admin = store.isAdmin(role);
    const params: string[] = [gym.id];
    if (!admin) params.push(userId);
    if (status) params.push(status);
    const rows = db
      .prepare(
        `SELECT * FROM freeze_requests WHERE gym_id = ? ${admin ? '' : 'AND user_id = ?'} ${status ? 'AND status = ?' : ''}
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(...params) as Row[];
    return { requests: rows.map((r) => mapFreeze(db, r, now())) };
  });

  app.post('/gyms/:gymId/freeze-requests', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req);
    const f = freezeRequestSchema.parse(req.body);
    const days = daysBetween(f.startsOn, f.endsOn) + 1;
    if (days > MAX_FREEZE_DAYS) throw new HttpError(400, 'freeze_too_long', `A freeze can be at most ${MAX_FREEZE_DAYS} days.`);
    const ms = store.membershipFor(db, gym.id, userId, now());
    if (ms.state !== 'active' && ms.state !== 'expiring') {
      throw new HttpError(409, 'no_active_membership', 'You need an active membership to freeze it.');
    }
    const id = randomUUID();
    tx(db, () => {
      if (db.prepare("SELECT 1 FROM freeze_requests WHERE gym_id = ? AND user_id = ? AND status = 'pending'").get(gym.id, userId)) {
        throw new HttpError(409, 'freeze_pending', 'You already have a freeze request waiting for the gym.');
      }
      db.prepare(
        `INSERT INTO freeze_requests (id, gym_id, user_id, starts_on, ends_on, days, reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(id, gym.id, userId, f.startsOn, f.endsOn, days, f.reason, now().toISOString());
    });
    return reply.status(201).send(mapFreeze(db, db.prepare('SELECT * FROM freeze_requests WHERE id = ?').get(id) as Row, now()));
  });

  app.patch('/gyms/:gymId/freeze-requests/:requestId', async (req) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    const { requestId } = req.params as { requestId: string };
    const d = freezeDecisionSchema.parse(req.body);
    return tx(db, () => {
      const r = db.prepare('SELECT * FROM freeze_requests WHERE id = ? AND gym_id = ?').get(requestId, gym.id) as Row | undefined;
      if (!r) throw notFound('Freeze request not found');
      if (r.status !== 'pending') throw new HttpError(409, 'already_decided', 'This request has already been decided.');
      db.prepare('UPDATE freeze_requests SET status = ?, note = ?, decided_by = ?, decided_at = ? WHERE id = ?').run(
        d.status,
        d.note ?? null,
        userId,
        now().toISOString(),
        requestId,
      );
      const member = r.user_id as string;
      if (d.status === 'approved') {
        const sub = db
          .prepare('SELECT id, ends_at FROM subscriptions WHERE gym_id = ? AND user_id = ? ORDER BY ends_at DESC LIMIT 1')
          .get(gym.id, member) as { id: string; ends_at: string } | undefined;
        if (sub) {
          const end = new Date(new Date(sub.ends_at).getTime() + (r.days as number) * 86_400_000).toISOString();
          db.prepare('UPDATE subscriptions SET ends_at = ? WHERE id = ?').run(end, sub.id);
          db.prepare('UPDATE freeze_requests SET new_ends_at = ? WHERE id = ?').run(end, requestId);
        }
      }
      notify(
        db,
        gym.id,
        member,
        d.status === 'approved'
          ? {
              kind: 'freeze_decision',
              title: 'Membership freeze approved',
              body: `Your membership is frozen from ${r.starts_on} to ${r.ends_on}; your end date moved by ${r.days} days.`,
              link: 'membership',
            }
          : {
              kind: 'freeze_decision',
              title: 'Membership freeze not approved',
              body: d.note ? `The gym replied: ${d.note}` : 'Please talk to the front desk about your request.',
              link: 'membership',
            },
        now(),
      );
      store.audit(db, gym.id, userId, `freeze.${d.status}`, requestId, now());
      return mapFreeze(db, db.prepare('SELECT * FROM freeze_requests WHERE id = ?').get(requestId) as Row, now());
    });
  });
}
