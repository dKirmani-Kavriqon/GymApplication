import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { CHECKOUT_TTL_MS, signCheckoutToken, verifyCheckoutToken } from '../src/checkout';
import { createRazorpayProvider } from '../src/payments';
import { buildApp, safeUrl } from '../src/app';
import { makeClock, setup } from './helpers';

const SECRET = 'test-secret';
const RZP = { keyId: 'rzp_test_key', keySecret: 'rzp-key-secret', webhookSecret: 'rzp-hook-secret' };

describe('checkout tokens', () => {
  it('are bound to one payment and user, signed, and expire after 30 minutes', () => {
    const now = new Date('2026-11-08T04:30:00.000Z');
    const t = signCheckoutToken('pay-1', 'user-1', SECRET, now);
    assert.deepEqual(verifyCheckoutToken(t, 'pay-1', SECRET, now), { ok: true, userId: 'user-1' });
    assert.deepEqual(verifyCheckoutToken(t, 'pay-2', SECRET, now), { ok: false, reason: 'invalid' }, 'other payment');
    assert.deepEqual(verifyCheckoutToken(t, 'pay-1', 'other-secret', now), { ok: false, reason: 'invalid' });
    const later = new Date(now.getTime() + CHECKOUT_TTL_MS + 1000);
    assert.deepEqual(verifyCheckoutToken(t, 'pay-1', SECRET, later), { ok: false, reason: 'expired' });
    assert.ok(verifyCheckoutToken(t, 'pay-1', SECRET, new Date(now.getTime() + CHECKOUT_TTL_MS - 1000)).ok);

    // Tampering: swap the payload for one naming another user, keep the signature.
    const [, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ p: 'pay-1', u: 'attacker', exp: now.getTime() + 60_000 })).toString('base64url');
    assert.equal(verifyCheckoutToken(`${forged}.${sig}`, 'pay-1', SECRET, now).ok, false);
    assert.equal(verifyCheckoutToken(`${t.split('.')[0]}.${sig.slice(0, -2)}xx`, 'pay-1', SECRET, now).ok, false);
    for (const junk of [undefined, '', 'abc', 'a.b.c']) assert.equal(verifyCheckoutToken(junk, 'pay-1', SECRET, now).ok, false);
    // A correctly signed but malformed payload is still rejected.
    const bad = Buffer.from('not json').toString('base64url');
    const badSig = createHmac('sha256', SECRET).update(`checkout:${bad}`).digest('base64url');
    assert.deepEqual(verifyCheckoutToken(`${bad}.${badSig}`, 'pay-1', SECRET, now), { ok: false, reason: 'invalid' });
  });
});

async function orderFor(options: Parameters<typeof setup>[1] = {}, gymName = 'Flex <Fitness>') {
  const ctx = setup(makeClock(), { publicUrl: 'https://api.gymverse.test/', ...options });
  const { owner, member, gym } = await ctx.gymWithMember();
  await ctx.call('PATCH', `/gyms/${gym.id}/branding`, owner.token, {
    gymName,
    primaryColor: '#6B0F1A',
    accentColor: '#B54B6A',
    themePreference: 'light',
  });
  const plan = (await ctx.call('POST', `/gyms/${gym.id}/plans`, owner.token, { name: 'Monthly', durationDays: 30, pricePaise: 150000 })).body;
  const order = (await ctx.call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id })).body;
  const url = new URL(order.checkoutUrl);
  const token = url.searchParams.get('t')!;
  const open = (t: string | null = token, id = order.paymentId) =>
    ctx.app.inject({ method: 'GET', url: `/pay/${id}${t === null ? '' : `?t=${encodeURIComponent(t)}`}` });
  const complete = (body: Record<string, unknown>) =>
    ctx.app.inject({ method: 'POST', url: `/pay/${order.paymentId}/complete`, payload: { t: token, razorpay_order_id: order.providerOrderId, ...body } });
  return { ...ctx, owner, member, gym, plan, order, url, token, open, complete };
}

function razorpay() {
  const calls: string[] = [];
  return {
    calls,
    provider: createRazorpayProvider({
      ...RZP,
      fetch: async (url) => {
        calls.push(url);
        return Response.json({ id: `order_rzp_${calls.length}` });
      },
    }),
  };
}

const rzpSignature = (orderId: string, paymentId: string) => createHmac('sha256', RZP.keySecret).update(`${orderId}|${paymentId}`).digest('hex');

describe('hosted checkout page', () => {
  it('returns a checkout link on every gateway order', async () => {
    const { order, url, member, owner, call, gym, plan } = await orderFor();
    assert.equal(url.origin + url.pathname, `https://api.gymverse.test/pay/${order.paymentId}`, 'trailing slash on PUBLIC_API_URL is trimmed');
    assert.ok(verifyCheckoutToken(url.searchParams.get('t')!, order.paymentId, SECRET, makeClock().now).ok);
    // Free orders are already paid: nothing to check out.
    await call('POST', `/gyms/${gym.id}/coupons`, owner.token, { code: 'FREE', kind: 'percent', amount: 100 });
    const free = (await call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id, couponCode: 'FREE' })).body;
    assert.deepEqual([free.status, free.checkoutUrl], ['paid', undefined]);
  });

  it('serves the mock "Pay (test)" page with a strict CSP and nonce', async () => {
    const { open, order } = await orderFor();
    const res = await open();
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /^text\/html/);
    assert.equal(res.headers['cache-control'], 'no-store');
    const csp = String(res.headers['content-security-policy']);
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    assert.ok(nonce, csp);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'nonce-[^']+' https:\/\/checkout\.razorpay\.com/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.ok(!csp.includes('unsafe-inline'));
    const html = res.body;
    const scriptTags = html.match(/<script[^>]*>/g) ?? [];
    assert.ok(scriptTags.length >= 2);
    assert.ok(scriptTags.every((s) => s.includes(`nonce="${nonce}"`)), 'every script carries the nonce');
    assert.ok(!html.includes('onclick='), 'no inline handlers');
    assert.ok(html.includes('Pay (test)'));
    assert.ok(html.includes('Flex &lt;Fitness&gt;'), 'gym name is escaped');
    assert.ok(!html.includes('Flex <Fitness>'));
    assert.ok(html.includes('₹1,500'));
    assert.ok(html.includes('Monthly membership'));
    assert.ok(html.includes(`gymverse://payment/${order.paymentId}?status=cancelled`));
    assert.ok(!html.includes('checkout.razorpay.com/v1/checkout.js'), 'mock mode does not load Razorpay');
    const cfg = JSON.parse(/<script[^>]*id="cfg"[^>]*>([^<]*)<\/script>/.exec(html)![1]);
    assert.equal(cfg.mode, 'mock');
    assert.equal(cfg.orderId, order.providerOrderId);
    assert.equal(cfg.mockSignature, order.mockSignature);
    const raw = /<script[^>]*id="cfg"[^>]*>(.*?)<\/script>/s.exec(html)![1];
    assert.ok(!raw.includes('<'), 'script JSON cannot close the script tag');
    assert.equal(cfg.gymName, 'Flex <Fitness>');
    // Each response gets a fresh nonce.
    const again = String((await open()).headers['content-security-policy']);
    assert.notEqual(/'nonce-([^']+)'/.exec(again)?.[1], nonce);
  });

  it('opens Razorpay Checkout with key, order, amount, gym name and prefill', async () => {
    const rp = razorpay();
    const { open, order } = await orderFor({ payments: rp.provider }, 'Flex Fitness');
    assert.equal(order.keyId, RZP.keyId);
    assert.equal(order.mockSignature, undefined);
    const html = (await open()).body;
    assert.match(html, /<script nonce="[^"]+" src="https:\/\/checkout\.razorpay\.com\/v1\/checkout\.js"><\/script>/);
    assert.ok(html.includes('Pay with Razorpay'));
    const cfg = JSON.parse(/<script[^>]*id="cfg"[^>]*>([^<]*)<\/script>/.exec(html)![1]);
    assert.deepEqual(
      { mode: cfg.mode, keyId: cfg.keyId, orderId: cfg.orderId, amount: cfg.amount, gymName: cfg.gymName, phone: cfg.phone, mock: cfg.mockSignature },
      { mode: 'razorpay', keyId: RZP.keyId, orderId: 'order_rzp_1', amount: 150000, gymName: 'Flex Fitness', phone: '+919111111111', mock: undefined },
    );
    assert.ok(html.includes("new Razorpay("));
    assert.ok(html.includes('ondismiss'));
  });

  it('answers bad, missing, foreign and expired links with friendly pages', async () => {
    const { open, order, token, clock, member, call, gym, app } = await orderFor();
    const bad = await open('nonsense');
    assert.equal(bad.statusCode, 403);
    assert.match(bad.body, /This payment link isn&#39;t valid|This payment link isn't valid/);
    assert.match(bad.body, /Return to the app/);
    assert.equal(bad.headers['cache-control'], 'no-store');
    assert.equal((await open(null)).statusCode, 403);
    assert.equal((await open(token, 'another-payment')).statusCode, 403);
    // A token for someone else cannot open this member's payment.
    const stranger = signCheckoutToken(order.paymentId, 'someone-else', SECRET, clock.now);
    assert.equal((await open(stranger)).statusCode, 403);
    clock.advance(CHECKOUT_TTL_MS + 1000);
    const expired = await open();
    assert.equal(expired.statusCode, 410);
    assert.match(expired.body, /expired/);
    // Suspended gym.
    clock.set('2026-11-08T04:30:00.000Z');
    app.db.prepare('UPDATE gyms SET suspended = 1 WHERE id = ?').run(gym.id);
    assert.match((await open()).body, /Payments are paused/);
    app.db.prepare('UPDATE gyms SET suspended = 0 WHERE id = ?').run(gym.id);
    // Already paid.
    await call('POST', `/gyms/${gym.id}/payments/${order.paymentId}/verify`, member.token, { providerPaymentId: 'p', signature: order.mockSignature });
    const paid = await open();
    assert.equal(paid.statusCode, 200);
    assert.match(paid.body, /Already paid/);
    assert.ok(paid.body.includes(`gymverse://payment/${order.paymentId}?status=paid`));
  });

  it('keeps checkout tokens out of the logs', async () => {
    assert.equal(safeUrl('/pay/abc?t=secret.token&x=1'), '/pay/abc?t=[redacted]&x=1');
    const lines: string[] = [];
    const app = buildApp({ logger: { stream: { write: (l: string) => void lines.push(l) } }, rateLimit: false });
    await app.inject({ method: 'GET', url: '/pay/abc?t=super-secret-token' });
    assert.ok(lines.length > 0);
    assert.ok(!lines.join('\n').includes('super-secret-token'));
  });
});

describe('completing a hosted checkout', () => {
  it('verifies the token and the mock signature, completes once, and the app can confirm', async () => {
    const { complete, order, call, gym, member, app } = await orderFor();
    const bad = await complete({ razorpay_payment_id: 'pay_1', razorpay_signature: 'forged' });
    assert.equal(bad.statusCode, 402);
    assert.equal(bad.json().error, 'payment_failed');
    const failed = await call('GET', `/gyms/${gym.id}/payments/${order.paymentId}`, member.token);
    assert.deepEqual([failed.body.status, failed.body.membershipEndsAt], ['failed', null]);

    const ok = await complete({ razorpay_payment_id: 'pay_1', razorpay_signature: order.mockSignature });
    assert.equal(ok.statusCode, 200);
    const result = ok.json();
    assert.equal(result.status, 'paid');
    assert.match(result.receiptNumber, new RegExp(`^${gym.joinCode}-00001$`));
    const again = await complete({ razorpay_payment_id: 'pay_1', razorpay_signature: 'anything' });
    assert.deepEqual(again.json(), result, 'idempotent');

    const record = await call('GET', `/gyms/${gym.id}/payments/${order.paymentId}`, member.token);
    assert.equal(record.status, 200);
    assert.deepEqual(
      [record.body.status, record.body.planName, record.body.amountPaise, record.body.receiptNumber, record.body.membershipEndsAt],
      ['paid', 'Monthly', 150000, result.receiptNumber, result.membershipEndsAt],
    );
    assert.equal((app.db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE payment_id = ?").get(order.paymentId) as { n: number }).n, 1);
  });

  it('rejects bad tokens, other orders and malformed bodies', async () => {
    const { complete, order, clock, app } = await orderFor();
    assert.equal((await complete({ t: 'junk', razorpay_payment_id: 'p', razorpay_signature: order.mockSignature })).json().error, 'bad_checkout_token');
    const stranger = signCheckoutToken(order.paymentId, 'someone-else', SECRET, clock.now);
    assert.equal((await complete({ t: stranger, razorpay_payment_id: 'p', razorpay_signature: order.mockSignature })).statusCode, 403);
    assert.equal((await complete({ razorpay_order_id: 'order_other', razorpay_payment_id: 'p', razorpay_signature: order.mockSignature })).json().error, 'order_mismatch');
    assert.equal((await complete({ razorpay_payment_id: '' })).statusCode, 400);
    clock.advance(CHECKOUT_TTL_MS + 1000);
    const expired = await complete({ razorpay_payment_id: 'p', razorpay_signature: order.mockSignature });
    assert.equal(expired.statusCode, 410);
    assert.equal(expired.json().error, 'checkout_expired');
    clock.set('2026-11-08T04:30:00.000Z');
    const gymId = (app.db.prepare('SELECT gym_id FROM payments WHERE id = ?').get(order.paymentId) as { gym_id: string }).gym_id;
    app.db.prepare('UPDATE gyms SET suspended = 1 WHERE id = ?').run(gymId);
    assert.equal((await complete({ razorpay_payment_id: 'p', razorpay_signature: order.mockSignature })).json().error, 'gym_suspended');
  });

  it('is idempotent with the Razorpay webhook, in either order', async () => {
    for (const webhookFirst of [true, false]) {
      const rp = razorpay();
      const { complete, order, call, gym, member, app } = await orderFor({ payments: rp.provider });
      const sig = rzpSignature(order.providerOrderId, 'pay_live_1');
      const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_live_1', order_id: order.providerOrderId } } } });
      const webhook = () =>
        app.inject({
          method: 'POST',
          url: '/webhooks/razorpay',
          payload: body,
          headers: { 'content-type': 'application/json', 'x-razorpay-signature': createHmac('sha256', RZP.webhookSecret).update(body).digest('hex') },
        });
      if (webhookFirst) assert.equal((await webhook()).statusCode, 200);
      const done = await complete({ razorpay_payment_id: 'pay_live_1', razorpay_signature: sig });
      assert.equal(done.statusCode, 200, done.body);
      if (!webhookFirst) assert.equal((await webhook()).statusCode, 200);
      assert.equal((await complete({ razorpay_payment_id: 'pay_live_1', razorpay_signature: 'x' })).json().receiptNumber, done.json().receiptNumber);
      const s = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
      assert.equal(s.membership.daysLeft, 30, 'membership extended exactly once');
      const n = (app.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'payment'").get() as { n: number }).n;
      assert.equal(n, 1);
    }
    // A wrong Razorpay signature is refused.
    const rp = razorpay();
    const { complete } = await orderFor({ payments: rp.provider });
    assert.equal((await complete({ razorpay_payment_id: 'pay_x', razorpay_signature: rzpSignature('order_other', 'pay_x') })).statusCode, 402);
  });
});

describe('GET /gyms/:gymId/payments/:paymentId', () => {
  it('returns only my own payments', async () => {
    const { call, gym, order, owner, member, joinAs } = await orderFor();
    const other = await joinAs(gym, owner.token, '+919800000071', 'Other');
    assert.equal((await call('GET', `/gyms/${gym.id}/payments/${order.paymentId}`, member.token)).body.status, 'created');
    assert.equal((await call('GET', `/gyms/${gym.id}/payments/${order.paymentId}`, other.token)).status, 404);
    assert.equal((await call('GET', `/gyms/${gym.id}/payments/${order.paymentId}`, owner.token)).status, 404, 'even staff: it is a personal view');
    assert.equal((await call('GET', `/gyms/${gym.id}/payments/missing`, member.token)).status, 404);
  });
});

describe('checkout page amounts', () => {
  it('shows paise amounts with two decimals', async () => {
    const ctx = setup();
    const { owner, member, gym } = await ctx.gymWithMember();
    const plan = (await ctx.call('POST', `/gyms/${gym.id}/plans`, owner.token, { name: 'Monthly', durationDays: 30, pricePaise: 149900 })).body;
    await ctx.call('POST', `/gyms/${gym.id}/coupons`, owner.token, { code: 'DIWALI20', kind: 'percent', amount: 20 });
    const order = (await ctx.call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id, couponCode: 'DIWALI20' })).body;
    assert.equal(order.amountPaise, 119920);
    const url = new URL(order.checkoutUrl);
    const html = (await ctx.app.inject({ method: 'GET', url: url.pathname + url.search })).body;
    assert.ok(html.includes('₹1,199.20'), html.match(/class="amount">[^<]*/)?.[0]);
  });
});
