import type { App } from '../http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ADMIN_ROLES, couponSchema, type CouponQuote } from '@gymverse/shared';
import { HttpError, notFound } from '../errors';
import type { Ctx } from '../context';
import * as store from '../store';
import type { Row } from '../store';
import { getActivePlan, mapCoupon, quoteCoupon } from '../domain/payments';

export function registerCouponRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;
  const getRow = (gymId: string, id: string) => {
    const r = db.prepare('SELECT * FROM coupons WHERE id = ? AND gym_id = ?').get(id, gymId) as Row | undefined;
    if (!r) throw notFound('Coupon not found');
    return r;
  };

  app.get('/gyms/:gymId/coupons', async (req) => {
    const { gym } = ctx.gymAccess(req, ADMIN_ROLES);
    const rows = db.prepare('SELECT * FROM coupons WHERE gym_id = ? ORDER BY created_at DESC, rowid DESC').all(gym.id) as Row[];
    return { coupons: rows.map(mapCoupon) };
  });

  app.post('/gyms/:gymId/coupons', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    const c = couponSchema.parse(req.body);
    if (db.prepare('SELECT 1 FROM coupons WHERE gym_id = ? AND code = ?').get(gym.id, c.code)) {
      throw new HttpError(409, 'duplicate_code', 'You already have a coupon with that code.');
    }
    for (const planId of c.planIds) {
      if (!db.prepare('SELECT 1 FROM plans WHERE id = ? AND gym_id = ?').get(planId, gym.id)) throw notFound('Plan not found');
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO coupons (id, gym_id, code, kind, amount, plan_ids, expires_on, max_uses, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, gym.id, c.code, c.kind, c.amount, JSON.stringify(c.planIds), c.expiresOn ?? null, c.maxUses ?? null, c.active ? 1 : 0, now().toISOString());
    store.audit(db, gym.id, userId, 'coupon.create', id, now());
    return reply.status(201).send(mapCoupon(getRow(gym.id, id)));
  });

  app.patch('/gyms/:gymId/coupons/:couponId', async (req) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    const { couponId } = req.params as { couponId: string };
    getRow(gym.id, couponId);
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    db.prepare('UPDATE coupons SET active = ? WHERE id = ? AND gym_id = ?').run(active ? 1 : 0, couponId, gym.id);
    store.audit(db, gym.id, userId, active ? 'coupon.activate' : 'coupon.deactivate', couponId, now());
    return mapCoupon(getRow(gym.id, couponId));
  });

  app.post('/gyms/:gymId/coupons/quote', async (req): Promise<CouponQuote> => {
    const { gym } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'payments');
    const { code, planId } = z.object({ code: z.string().trim().min(1).max(20), planId: z.string().min(1) }).parse(req.body);
    return quoteCoupon(db, gym, code, getActivePlan(db, gym.id, planId), now()).quote;
  });
}
