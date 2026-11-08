/**
 * End-to-end smoke test against a running API over HTTP: the local Worker (`npm run dev:worker`),
 * the staging Worker after a deploy, or the Node server. Needs the FLEX42 demo data and login codes
 * in responses (staging settings), so never point it at production.
 *
 *   node --import tsx scripts/smoke.ts http://127.0.0.1:4200
 *
 * Exits non-zero on the first failure.
 */
import assert from 'node:assert/strict';

const base = (process.argv[2] ?? process.env.SMOKE_URL ?? 'http://127.0.0.1:4200').replace(/\/+$/, '');
const unique = Date.now().toString().slice(-7);
/** A fresh Indian mobile number per run and slot. */
const phone = (slot: string) => `+917${slot}${unique}${Math.floor(Math.random() * 10)}`;
let step = 0;

async function call<T = any>(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (res.status === 429 && path.startsWith('/auth/')) {
    // The API allows 10 login requests a minute per IP; wait and retry rather than fail.
    const wait = Number(res.headers.get('retry-after') ?? '60');
    console.log(`  (login rate limit reached, waiting ${wait}s)`);
    await new Promise((r) => setTimeout(r, wait * 1000 + 250));
    return call<T>(method, path, token, body, headers);
  }
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // HTML or plain text
  }
  return { status: res.status, body: parsed as T, headers: res.headers, text };
}

async function check(name: string, fn: () => Promise<void>) {
  step++;
  const started = Date.now();
  try {
    await fn();
    console.log(`ok ${step} - ${name} (${Date.now() - started} ms)`);
  } catch (err) {
    console.error(`not ok ${step} - ${name}\n  ${(err as Error).message}`);
    process.exit(1);
  }
}

async function login(phone: string): Promise<{ token: string; userId: string }> {
  const otp = await call('POST', '/auth/otp/request', undefined, { phone });
  assert.equal(otp.status, 200, JSON.stringify(otp.body));
  assert.ok(otp.body.devCode, 'staging returns the login code');
  const ver = await call('POST', '/auth/otp/verify', undefined, { phone, code: otp.body.devCode });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  return { token: ver.body.token, userId: ver.body.user.id };
}

const state: Record<string, any> = {};

await check('health and readiness', async () => {
  assert.deepEqual((await call('GET', '/health/live')).body, { ok: true });
  assert.deepEqual((await call('GET', '/health/ready')).body, { ok: true });
});

await check('security headers, request ids, unknown routes', async () => {
  const r = await call('GET', '/health', undefined, undefined, { 'x-request-id': 'smoke-1' });
  assert.equal(r.headers.get('x-request-id'), 'smoke-1');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.deepEqual((await call('GET', '/definitely-not-here')).body, { error: 'not_found', message: 'Not found' });
});

await check('CORS preflight from the dashboard', async () => {
  const r = await fetch(`${base}/me`, {
    method: 'OPTIONS',
    headers: { origin: 'https://app.example.com', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
  });
  assert.equal(r.status, 204);
  assert.ok(r.headers.get('access-control-allow-origin'));
  assert.match(r.headers.get('access-control-allow-methods') ?? '', /PATCH/);
});

await check('demo gym preview', async () => {
  const r = await call('GET', '/gyms/preview/FLEX42');
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Flex Fitness');
});

await check('a new member joins FLEX42 and sees their home summary', async () => {
  // A fresh number each run: login codes are capped per phone.
  state.ravi = await login(phone('0'));
  assert.equal((await call('POST', '/gyms/join', state.ravi.token, { code: 'FLEX42' })).status, 200);
  const me = await call('GET', '/me', state.ravi.token);
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('cache-control'), 'no-store');
  state.gym = me.body.memberships.find((m: any) => m.gym.joinCode === 'FLEX42').gym;
  const summary = await call('GET', `/gyms/${state.gym.id}/me/summary`, state.ravi.token);
  assert.equal(summary.status, 200, JSON.stringify(summary.body));
});

await check('check-in (transaction, streak)', async () => {
  const r = await call('POST', `/gyms/${state.gym.id}/checkins`, state.ravi.token, {});
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
});

await check('logs a workout', async () => {
  const at = new Date();
  const r = await call('POST', `/gyms/${state.gym.id}/workouts`, state.ravi.token, {
    startedAt: new Date(at.getTime() - 40 * 60_000).toISOString(),
    completedAt: at.toISOString(),
    sets: [
      { exerciseId: 'ex_back_squat', reps: 8, weightKg: 50 },
      { exerciseId: 'ex_push_up', reps: 15 },
    ],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

await check('validation errors are 400 with the first issue', async () => {
  const r = await call('POST', `/gyms/${state.gym.id}/workouts`, state.ravi.token, { sets: 'nope' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'validation');
});

await check('bad JSON, oversized bodies', async () => {
  assert.equal((await call('POST', '/auth/otp/request', undefined, '{nope')).status, 400);
  const huge = await call('PATCH', '/me/profile', state.ravi.token, { bio: 'x'.repeat(300 * 1024) });
  assert.equal(huge.status, 413);
});

await check('renews with a coupon through the mock payment flow', async () => {
  const plans = await call('GET', `/gyms/${state.gym.id}/plans`, state.ravi.token);
  assert.equal(plans.status, 200);
  const plan = plans.body.plans[0];
  const quote = await call('POST', `/gyms/${state.gym.id}/coupons/quote`, state.ravi.token, { code: 'DIWALI20', planId: plan.id });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  const order = await call('POST', `/gyms/${state.gym.id}/payments/orders`, state.ravi.token, { planId: plan.id, couponCode: 'DIWALI20' });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const page = await call('GET', new URL(order.body.checkoutUrl).pathname + new URL(order.body.checkoutUrl).search);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', /nonce-/);
  const paid = await call('POST', `/gyms/${state.gym.id}/payments/${order.body.paymentId}/verify`, state.ravi.token, {
    providerPaymentId: `smoke_${unique}`,
    signature: order.body.mockSignature,
  });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
});

await check('webhooks refuse a forged signature', async () => {
  const r = await call('POST', '/webhooks/razorpay', undefined, { event: 'payment.captured' }, { 'x-razorpay-signature': 'forged' });
  assert.ok([400, 404].includes(r.status), String(r.status));
});

await check('owner sees revenue and members; tenant guard hides other gyms', async () => {
  state.priya = await login('+919999900001');
  assert.equal((await call('GET', `/gyms/${state.gym.id}/reports/revenue`, state.priya.token)).status, 200);
  assert.equal((await call('GET', `/gyms/${state.gym.id}/members`, state.priya.token)).status, 200);
  const stranger = await login(phone('1'));
  assert.equal((await call('GET', `/gyms/${state.gym.id}/members`, stranger.token)).status, 404);
  assert.equal((await call('GET', `/gyms/${state.gym.id}/members`, state.ravi.token)).status, 403, 'members cannot list members');
});

await check('new gym, join by code, community post', async () => {
  const owner = await login(phone('2'));
  const gym = await call('POST', '/gyms', owner.token, { name: `Smoke Gym ${unique}`, city: 'Pune' });
  assert.equal(gym.status, 201, JSON.stringify(gym.body));
  const member = await login(phone('3'));
  assert.equal((await call('POST', '/gyms/join', member.token, { code: gym.body.joinCode })).status, 200);
  const post = await call('POST', `/gyms/${gym.body.id}/posts`, member.token, { body: 'First session done!' });
  assert.equal(post.status, 201, JSON.stringify(post.body));
});

await check('platform admin console (staging admin)', async () => {
  const r = await call('GET', '/admin/stats', state.priya.token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

await check('ops endpoints are off without a token', async () => {
  const r = await call('GET', '/__ops/bookmark');
  assert.ok([401, 404].includes(r.status));
});

console.log(`\nAll ${step} smoke checks passed against ${base}`);
