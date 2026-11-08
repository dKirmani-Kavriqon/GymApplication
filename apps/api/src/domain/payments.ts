import { randomUUID } from 'node:crypto';
import {
  applyCoupon,
  dayKey,
  type Coupon,
  type CouponQuote,
  type Gym,
  type PaymentResult,
  type Plan,
} from '@gymverse/shared';
import { tx, type Db } from '../db';
import { HttpError, notFound } from '../errors';
import * as store from '../store';
import type { Row } from '../store';
import { notify } from './notifications';
import type { PaymentProvider } from '../payments';

// ---------- coupons ----------

export function mapCoupon(r: Row): Coupon {
  return {
    id: r.id as string,
    code: r.code as string,
    kind: r.kind as Coupon['kind'],
    amount: r.amount as number,
    planIds: store.parseJson<string[]>(r.plan_ids, []),
    expiresOn: (r.expires_on as string) ?? null,
    maxUses: (r.max_uses as number) ?? null,
    uses: r.uses as number,
    active: r.active === 1,
    createdAt: r.created_at as string,
  };
}

export function getActivePlan(db: Db, gymId: string, planId: string): Plan {
  const r = db.prepare('SELECT * FROM plans WHERE id = ? AND gym_id = ? AND active = 1').get(planId, gymId) as Row | undefined;
  if (!r) throw notFound('Plan not found');
  return store.mapPlan(r);
}

/** Checks a code for a plan and prices it. 404 unknown/inactive; 409 expired, used up or wrong plan. */
export function quoteCoupon(db: Db, gym: Gym, rawCode: string, plan: Plan, now: Date): { quote: CouponQuote; coupon: Coupon } {
  const code = rawCode.trim().toUpperCase();
  const r = db.prepare('SELECT * FROM coupons WHERE gym_id = ? AND code = ? AND active = 1').get(gym.id, code) as Row | undefined;
  if (!r) throw notFound("That code isn't valid");
  const coupon = mapCoupon(r);
  if (coupon.expiresOn && coupon.expiresOn < dayKey(now, gym.timezone)) {
    throw new HttpError(409, 'coupon_expired', 'That code has expired.');
  }
  if (coupon.maxUses !== null && coupon.uses >= coupon.maxUses) {
    throw new HttpError(409, 'coupon_used_up', 'That code has been used up.');
  }
  if (coupon.planIds.length && !coupon.planIds.includes(plan.id)) {
    throw new HttpError(409, 'coupon_not_for_plan', "That code can't be used with this plan.");
  }
  const finalPaise = applyCoupon(plan.pricePaise, coupon);
  return {
    coupon,
    quote: { code: coupon.code, plan, originalPaise: plan.pricePaise, discountPaise: plan.pricePaise - finalPaise, finalPaise },
  };
}

// ---------- completing a payment ----------

/**
 * Checks the gateway signature (unless the payment is already paid, e.g. by the webhook) and
 * completes it in its own transaction (do not call inside one). A bad signature marks the payment
 * failed (committed) and throws 402. Shared by `/payments/:id/verify` and `/pay/:id/complete`.
 */
export function verifyAndComplete(
  db: Db,
  provider: Pick<PaymentProvider, 'verifyPayment'>,
  pay: Row,
  providerPaymentId: string,
  signature: string,
  now: Date,
): PaymentResult {
  if (pay.status !== 'paid') {
    const valid = provider.verifyPayment({ orderId: pay.provider_order_id as string, paymentId: providerPaymentId, signature });
    if (!valid) {
      db.prepare("UPDATE payments SET status = 'failed' WHERE id = ? AND status != 'paid'").run(pay.id as string);
      throw new HttpError(402, 'payment_failed', 'Payment could not be verified. You have not been charged twice; please try again.');
    }
  }
  // Re-read inside the transaction: the webhook may have completed it a moment ago.
  return tx(db, () => completePayment(db, db.prepare('SELECT * FROM payments WHERE id = ?').get(pay.id as string) as Row, providerPaymentId, now));
}

/**
 * Marks a payment paid and extends the membership (from the current end date when renewing early).
 * Idempotent: a payment that is already paid returns its existing result. Call inside a transaction.
 * Shared by `/verify`, the Razorpay webhook and ₹0 coupon orders.
 */
export function completePayment(db: Db, pay: Row, providerPaymentId: string | null, now: Date): PaymentResult {
  const paymentId = pay.id as string;
  if (pay.status === 'paid') {
    const sub = db.prepare('SELECT ends_at FROM subscriptions WHERE payment_id = ?').get(paymentId) as { ends_at: string };
    return { paymentId, status: 'paid', membershipEndsAt: sub.ends_at, receiptNumber: pay.receipt_number as string };
  }
  const gym = store.getGym(db, pay.gym_id as string);
  const userId = pay.user_id as string;
  const current = store.currentSubscription(db, gym.id, userId);
  const start = current && current.endsAt > now.toISOString() ? new Date(current.endsAt) : now;
  const plan = store.mapPlan(db.prepare('SELECT * FROM plans WHERE id = ?').get(pay.plan_id as string) as Row);
  const end = new Date(start.getTime() + plan.durationDays * 86_400_000);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM payments WHERE gym_id = ? AND status = 'paid'").get(gym.id) as { n: number }).n;
  const receipt = `${gym.joinCode}-${String(count + 1).padStart(5, '0')}`;
  db.prepare("UPDATE payments SET status = 'paid', provider_payment_id = ?, receipt_number = ?, paid_at = ? WHERE id = ?").run(
    providerPaymentId,
    receipt,
    now.toISOString(),
    paymentId,
  );
  if (pay.coupon_id) db.prepare('UPDATE coupons SET uses = uses + 1 WHERE id = ? AND gym_id = ?').run(pay.coupon_id as string, gym.id);
  db.prepare(
    'INSERT INTO subscriptions (id, gym_id, user_id, plan_id, payment_id, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(randomUUID(), gym.id, userId, plan.id, paymentId, start.toISOString(), end.toISOString(), now.toISOString());
  notify(
    db,
    gym.id,
    userId,
    {
      kind: 'payment',
      title: 'Payment received',
      body: `Thanks! Your ${plan.name} membership is active until ${dayKey(end, gym.timezone)}. Receipt ${receipt}.`,
      link: 'membership',
    },
    now,
  );
  return { paymentId, status: 'paid', membershipEndsAt: end.toISOString(), receiptNumber: receipt };
}
