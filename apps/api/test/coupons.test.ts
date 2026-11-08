import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { setup } from './helpers';

async function withPlans() {
  const ctx = setup();
  const { owner, member, gym } = await ctx.gymWithMember();
  const plan = (await ctx.call('POST', `/gyms/${gym.id}/plans`, owner.token, { name: 'Monthly', durationDays: 30, pricePaise: 150000 })).body;
  const other = (await ctx.call('POST', `/gyms/${gym.id}/plans`, owner.token, { name: 'Yearly', durationDays: 365, pricePaise: 1200000 })).body;
  const coupon = (body: Record<string, unknown>) => ctx.call('POST', `/gyms/${gym.id}/coupons`, owner.token, body);
  const quote = (code: string, planId = plan.id) => ctx.call('POST', `/gyms/${gym.id}/coupons/quote`, member.token, { code, planId });
  return { ...ctx, owner, member, gym, plan, other, coupon, quote };
}

describe('coupons', () => {
  it('admins create, list and deactivate coupons; codes are unique per gym', async () => {
    const { call, owner, member, gym, coupon, joinAs } = await withPlans();
    const c = await coupon({ code: 'diwali20', kind: 'percent', amount: 20 });
    assert.equal(c.status, 201);
    assert.deepEqual(
      { code: c.body.code, uses: c.body.uses, active: c.body.active, planIds: c.body.planIds, maxUses: c.body.maxUses },
      { code: 'DIWALI20', uses: 0, active: true, planIds: [], maxUses: null },
    );
    const dup = await coupon({ code: 'DIWALI20', kind: 'flat', amount: 100 });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, 'duplicate_code');
    assert.equal((await coupon({ code: 'BIG', kind: 'percent', amount: 150 })).status, 400);
    assert.equal((await coupon({ code: 'x!', kind: 'flat', amount: 100 })).status, 400);
    assert.equal((await coupon({ code: 'NOPLAN', kind: 'flat', amount: 100, planIds: ['missing'] })).status, 404);

    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Trainer', 'trainer');
    assert.equal((await call('GET', `/gyms/${gym.id}/coupons`, member.token)).status, 403);
    assert.equal((await call('GET', `/gyms/${gym.id}/coupons`, trainer.token)).status, 403);
    assert.equal((await call('POST', `/gyms/${gym.id}/coupons`, member.token, { code: 'MINE', kind: 'flat', amount: 1 })).status, 403);
    assert.deepEqual((await call('GET', `/gyms/${gym.id}/coupons`, owner.token)).body.coupons.map((x: any) => x.code), ['DIWALI20']);

    const off = await call('PATCH', `/gyms/${gym.id}/coupons/${c.body.id}`, owner.token, { active: false });
    assert.equal(off.body.active, false);
    assert.equal((await call('PATCH', `/gyms/${gym.id}/coupons/missing`, owner.token, { active: false })).status, 404);
    assert.equal((await call('PATCH', `/gyms/${gym.id}/coupons/${c.body.id}`, owner.token, {})).status, 400);
  });

  it('quotes codes with every rejection reason', async () => {
    const { plan, other, coupon, quote } = await withPlans();
    await coupon({ code: 'TWENTY', kind: 'percent', amount: 20 });
    const q = await quote('twenty');
    assert.equal(q.status, 200);
    assert.deepEqual({ ...q.body, plan: q.body.plan.id }, { code: 'TWENTY', plan: plan.id, originalPaise: 150000, discountPaise: 30000, finalPaise: 120000 });

    await coupon({ code: 'FLAT500', kind: 'flat', amount: 50000 });
    assert.equal((await quote('FLAT500')).body.finalPaise, 100000);
    await coupon({ code: 'HUGE', kind: 'flat', amount: 999999 });
    assert.equal((await quote('HUGE')).body.finalPaise, 0, 'never below zero');

    const unknown = await quote('NOPE');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.message, "That code isn't valid");
    await coupon({ code: 'PAUSED', kind: 'percent', amount: 10, active: false });
    assert.equal((await quote('PAUSED')).status, 404);

    await coupon({ code: 'OLD', kind: 'percent', amount: 10, expiresOn: '2026-11-07' });
    assert.equal((await quote('OLD')).body.error, 'coupon_expired');
    await coupon({ code: 'TODAY', kind: 'percent', amount: 10, expiresOn: '2026-11-08' });
    assert.equal((await quote('TODAY')).status, 200, 'valid through its last day');

    await coupon({ code: 'YEARONLY', kind: 'percent', amount: 10, planIds: [other.id] });
    assert.equal((await quote('YEARONLY')).body.error, 'coupon_not_for_plan');
    assert.equal((await quote('YEARONLY', other.id)).status, 200);

    assert.equal((await quote('TWENTY', 'missing-plan')).status, 404);
  });

  it('discounts the order; uses only count once paid; used-up codes are refused', async () => {
    const { call, member, gym, plan, coupon, quote, app } = await withPlans();
    const c = (await coupon({ code: 'ONCE', kind: 'percent', amount: 50, maxUses: 1 })).body;
    const order = await call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id, couponCode: 'once' });
    assert.equal(order.status, 201);
    assert.equal(order.body.amountPaise, 75000);
    assert.equal(order.body.status, 'created');
    assert.equal(order.body.discountPaise, 75000);
    // An unpaid order does not use the coupon up.
    assert.equal((await quote('ONCE')).status, 200);
    await call('POST', `/gyms/${gym.id}/payments/${order.body.paymentId}/verify`, member.token, {
      providerPaymentId: 'pay_1',
      signature: order.body.mockSignature,
    });
    const after = (app.db.prepare('SELECT uses FROM coupons WHERE id = ?').get(c.id) as { uses: number }).uses;
    assert.equal(after, 1);
    assert.equal((await quote('ONCE')).body.error, 'coupon_used_up');
    assert.equal((await call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id, couponCode: 'ONCE' })).status, 409);
    const history = (await call('GET', `/gyms/${gym.id}/payments`, member.token)).body.payments;
    assert.equal(history[0].amountPaise, 75000);
  });

  it('completes a free (100% off) order immediately without the gateway', async () => {
    const { call, member, gym, plan, coupon } = await withPlans();
    await coupon({ code: 'FREE', kind: 'percent', amount: 100 });
    const order = await call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id, couponCode: 'FREE' });
    assert.equal(order.status, 201);
    assert.deepEqual([order.body.status, order.body.amountPaise, order.body.provider, order.body.mockSignature], ['paid', 0, 'free', undefined]);
    const summary = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.equal(summary.membership.state, 'active');
    const payments = (await call('GET', `/gyms/${gym.id}/payments`, member.token)).body.payments;
    assert.equal(payments[0].status, 'paid');
    assert.match(payments[0].receiptNumber, new RegExp(`^${gym.joinCode}-00001$`));
  });

  it('is blocked when payments are switched off', async () => {
    const { call, owner, member, gym, plan, coupon, disableFeatures } = await withPlans();
    await coupon({ code: 'TEN', kind: 'percent', amount: 10 });
    await disableFeatures(gym, owner.token, ['payments']);
    assert.equal((await call('POST', `/gyms/${gym.id}/coupons/quote`, member.token, { code: 'TEN', planId: plan.id })).body.error, 'feature_disabled');
  });
});

describe('Razorpay webhook', () => {
  const sign = (body: string, secret = 'mock-webhook-secret') => createHmac('sha256', secret).update(body).digest('hex');

  async function withOrder() {
    const ctx = setup();
    const { owner, member, gym } = await ctx.gymWithMember();
    const plan = (await ctx.call('POST', `/gyms/${gym.id}/plans`, owner.token, { name: 'Monthly', durationDays: 30, pricePaise: 150000 })).body;
    const order = (await ctx.call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id })).body;
    const post = (payload: string, signature: string, eventId?: string) =>
      ctx.app.inject({
        method: 'POST',
        url: '/webhooks/razorpay',
        payload,
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature, ...(eventId ? { 'x-razorpay-event-id': eventId } : {}) },
      });
    return { ...ctx, member, gym, order, post };
  }

  it('verifies the raw-body signature and completes the payment once', async () => {
    const { call, member, gym, order, post } = await withOrder();
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_W1', order_id: order.providerOrderId } } } });

    const forged = await post(body, sign(body, 'wrong-secret'), 'evt_1');
    assert.equal(forged.statusCode, 400);
    assert.equal(forged.json().error, 'bad_signature');
    // Re-serialised JSON (different bytes) fails even with the same content.
    assert.equal((await post(JSON.stringify(JSON.parse(body), null, 2), sign(body), 'evt_1')).statusCode, 400);
    assert.equal((await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body.membership.state, 'none');

    const ok = await post(body, sign(body), 'evt_1');
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.json(), { ok: true });
    const s = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.equal(s.membership.state, 'active');

    const replay = await post(body, sign(body), 'evt_1');
    assert.deepEqual(replay.json(), { ok: true, duplicate: true });
    // Same payment via another event id (e.g. order.paid after payment.captured): still idempotent.
    const orderPaid = JSON.stringify({ event: 'order.paid', payload: { order: { entity: { id: order.providerOrderId } }, payment: { entity: { id: 'pay_W1' } } } });
    assert.equal((await post(orderPaid, sign(orderPaid), 'evt_2')).statusCode, 200);
    const payments = (await call('GET', `/gyms/${gym.id}/payments`, member.token)).body.payments;
    assert.deepEqual(payments.map((p: any) => p.status), ['paid']);
    assert.equal((await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body.membership.daysLeft, 30, 'not extended twice');
    // The app's /verify afterwards returns the same receipt.
    const verify = await call('POST', `/gyms/${gym.id}/payments/${order.paymentId}/verify`, member.token, { providerPaymentId: 'pay_W1', signature: 'anything' });
    assert.equal(verify.body.receiptNumber, `${gym.joinCode}-00001`);
  });

  it('acknowledges unknown events and orders, and rejects bad JSON', async () => {
    const { post } = await withOrder();
    const other = JSON.stringify({ event: 'refund.created', payload: {} });
    assert.deepEqual((await post(other, sign(other))).json(), { ok: true, ignored: 'refund.created' });
    const unknown = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_X', order_id: 'order_elsewhere' } } } });
    assert.deepEqual((await post(unknown, sign(unknown))).json(), { ok: true, ignored: 'unknown_order' });
    const noOrder = JSON.stringify({ event: 'payment.captured', payload: {} });
    assert.deepEqual((await post(noOrder, sign(noOrder))).json(), { ok: true, ignored: 'no_order' });
    assert.equal((await post('{bad', sign('{bad'))).statusCode, 400);
    assert.equal((await post(other, '')).statusCode, 400);
  });
});
