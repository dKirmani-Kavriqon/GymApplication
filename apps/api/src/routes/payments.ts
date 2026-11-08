import type { App } from '../http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ADMIN_ROLES, createPlanSchema, type PaymentOrder, type PaymentRecord, type PaymentResult } from '@gymverse/shared';
import { tx } from '../db';
import { notFound } from '../errors';
import type { Ctx } from '../context';
import * as store from '../store';
import type { Row } from '../store';
import { completePayment, getActivePlan, quoteCoupon, verifyAndComplete } from '../domain/payments';
import { signCheckoutToken } from '../checkout';

export function registerPaymentRoutes(app: App, ctx: Ctx): void {
  const { db, now, payments } = ctx;

  // ---------- plans ----------

  app.get('/gyms/:gymId/plans', async (req) => {
    const { gym } = ctx.gymAccess(req);
    const rows = db.prepare('SELECT * FROM plans WHERE gym_id = ? AND active = 1 ORDER BY duration_days').all(gym.id) as Row[];
    return { plans: rows.map(store.mapPlan) };
  });

  app.post('/gyms/:gymId/plans', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    const p = createPlanSchema.parse(req.body);
    const id = randomUUID();
    db.prepare('INSERT INTO plans (id, gym_id, name, duration_days, price_paise, benefits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      gym.id,
      p.name,
      p.durationDays,
      p.pricePaise,
      JSON.stringify(p.benefits),
      now().toISOString(),
    );
    store.audit(db, gym.id, userId, 'plan.create', id, now());
    return reply.status(201).send(store.mapPlan(db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as Row));
  });

  app.delete('/gyms/:gymId/plans/:planId', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    const { planId } = req.params as { planId: string };
    const res = db.prepare('UPDATE plans SET active = 0 WHERE id = ? AND gym_id = ?').run(planId, gym.id);
    if (res.changes === 0) throw notFound('Plan not found');
    store.audit(db, gym.id, userId, 'plan.archive', planId, now());
    return reply.status(204).send();
  });

  // ---------- payments ----------

  app.post('/gyms/:gymId/payments/orders', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'payments');
    const { planId, couponCode } = z
      .object({ planId: z.string().min(1), couponCode: z.string().trim().max(20).nullish() })
      .parse(req.body);
    const plan = getActivePlan(db, gym.id, planId);
    const priced = couponCode ? quoteCoupon(db, gym, couponCode, plan, now()) : null;
    const amount = priced ? priced.quote.finalPaise : plan.pricePaise;
    const paymentId = randomUUID();
    const base = {
      paymentId,
      amountPaise: amount,
      currency: 'INR' as const,
      plan,
      discountPaise: plan.pricePaise - amount,
      couponCode: priced?.coupon.code ?? null,
    };
    const insert = (provider: string, orderId: string) =>
      db
        .prepare(
          `INSERT INTO payments (id, gym_id, user_id, plan_id, amount_paise, original_paise, discount_paise, coupon_id, provider,
                                 provider_order_id, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?)`,
        )
        .run(paymentId, gym.id, userId, plan.id, amount, plan.pricePaise, plan.pricePaise - amount, priced?.coupon.id ?? null, provider, orderId, now().toISOString());

    if (amount === 0) {
      // Fully discounted: nothing to collect, so no gateway order. Completed straight away.
      const orderId = `free_${paymentId}`;
      tx(db, () => {
        insert('free', orderId);
        completePayment(db, db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as Row, null, now());
      });
      const order: PaymentOrder = { ...base, providerOrderId: orderId, status: 'paid', provider: 'free' };
      return reply.status(201).send(order);
    }

    const { orderId } = await payments.createOrder({ amountPaise: amount, currency: 'INR', receipt: paymentId });
    insert(payments.name, orderId);
    const order: PaymentOrder = {
      ...base,
      providerOrderId: orderId,
      status: 'created',
      provider: payments.name,
      // Hosted checkout: the app opens this in the browser, no native SDK needed.
      checkoutUrl: `${ctx.publicUrl}/pay/${paymentId}?t=${signCheckoutToken(paymentId, userId, ctx.secret, now())}`,
      ...(payments.keyId ? { keyId: payments.keyId } : {}),
      ...(payments.mockSignatureFor ? { mockSignature: payments.mockSignatureFor(orderId) } : {}),
    };
    return reply.status(201).send(order);
  });

  app.post('/gyms/:gymId/payments/:paymentId/verify', async (req): Promise<PaymentResult> => {
    const { gym, userId } = ctx.gymAccess(req);
    const { paymentId } = req.params as { paymentId: string };
    const body = z.object({ providerPaymentId: z.string().min(1).max(100), signature: z.string().min(1).max(200) }).parse(req.body);
    const pay = db.prepare('SELECT * FROM payments WHERE id = ? AND gym_id = ? AND user_id = ?').get(paymentId, gym.id, userId) as Row | undefined;
    if (!pay) throw notFound('Payment not found');
    return verifyAndComplete(db, payments, pay, body.providerPaymentId, body.signature, now());
  });

  const PAYMENT_SELECT = `SELECT p.*, pl.name AS plan_name, s.ends_at AS membership_ends_at FROM payments p
     JOIN plans pl ON pl.id = p.plan_id LEFT JOIN subscriptions s ON s.payment_id = p.id AND s.gym_id = p.gym_id`;

  app.get('/gyms/:gymId/payments', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    const rows = db
      .prepare(`${PAYMENT_SELECT} WHERE p.gym_id = ? AND p.user_id = ? ORDER BY p.created_at DESC, p.rowid DESC`)
      .all(gym.id, userId) as Row[];
    return { payments: rows.map(mapPaymentRecord) };
  });

  /** One of my payments: lets the app confirm the result after returning from the hosted checkout. */
  app.get('/gyms/:gymId/payments/:paymentId', async (req): Promise<PaymentRecord & { membershipEndsAt: string | null }> => {
    const { gym, userId } = ctx.gymAccess(req);
    const { paymentId } = req.params as { paymentId: string };
    const r = db.prepare(`${PAYMENT_SELECT} WHERE p.id = ? AND p.gym_id = ? AND p.user_id = ?`).get(paymentId, gym.id, userId) as Row | undefined;
    if (!r) throw notFound('Payment not found');
    return { ...mapPaymentRecord(r), membershipEndsAt: (r.membership_ends_at as string) ?? null };
  });
}

function mapPaymentRecord(r: Row): PaymentRecord {
  return {
    id: r.id as string,
    planName: r.plan_name as string,
    amountPaise: r.amount_paise as number,
    status: r.status as PaymentRecord['status'],
    receiptNumber: (r.receipt_number as string) ?? null,
    createdAt: r.created_at as string,
    paidAt: (r.paid_at as string) ?? null,
  };
}
