import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createSmsSender, type FetchFn } from '../src/sms';
import { createRazorpayProvider } from '../src/payments';
import { createExpoPushSender, EXPO_PUSH_URL } from '../src/push';
import { createServer } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import { setup } from './helpers';

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch that records calls and answers from `respond`. Never touches the network. */
function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response> = () => Response.json({ ok: true })) {
  const calls: Call[] = [];
  const fetch: FetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, fetch };
}

describe('SMS providers', () => {
  it('msg91 posts to the Flow API with the authkey header and the template', async () => {
    const f = fakeFetch();
    await createSmsSender({ provider: 'msg91', authKey: 'AK', templateId: 'TPL' }, { fetch: f.fetch })('+919876543210', '123456');
    assert.equal(f.calls[0].url, 'https://control.msg91.com/api/v5/flow/');
    assert.equal((f.calls[0].init.headers as Record<string, string>).authkey, 'AK');
    assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), {
      template_id: 'TPL',
      short_url: '0',
      recipients: [{ mobiles: '919876543210', otp: '123456' }],
    });
  });

  it('twilio posts a form with basic auth', async () => {
    const f = fakeFetch();
    await createSmsSender({ provider: 'twilio', accountSid: 'AC1', authToken: 'tok', from: '+15550001' }, { fetch: f.fetch })('+919876543210', '123456');
    assert.equal(f.calls[0].url, 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    assert.equal((f.calls[0].init.headers as Record<string, string>).authorization, `Basic ${Buffer.from('AC1:tok').toString('base64')}`);
    const form = new URLSearchParams(String(f.calls[0].init.body));
    assert.equal(form.get('To'), '+919876543210');
    assert.match(form.get('Body') ?? '', /123456/);
  });

  it('turns provider errors and network failures into 502 sms_failed, keeping the OTP row', async () => {
    for (const respond of [() => new Response('nope', { status: 500 }), () => Promise.reject(new Error('ECONNRESET'))]) {
      const f = fakeFetch(respond);
      const sendOtp = createSmsSender({ provider: 'msg91', authKey: 'AK', templateId: 'TPL' }, { fetch: f.fetch });
      const { call, app } = setup(undefined, { sendOtp, exposeDevOtp: false });
      const res = await call('POST', '/auth/otp/request', undefined, { phone: '+919876543210' });
      assert.equal(res.status, 502);
      assert.deepEqual(res.body, { error: 'sms_failed', message: "We couldn't send the code. Try again in a minute." });
      assert.equal((app.db.prepare('SELECT COUNT(*) AS n FROM otp_codes').get() as { n: number }).n, 1);
    }
    // A custom sender throwing a plain error is reported the same way.
    const { call } = setup(undefined, { sendOtp: () => Promise.reject(new Error('boom')) });
    assert.equal((await call('POST', '/auth/otp/request', undefined, { phone: '+919876543210' })).body.error, 'sms_failed');
    // The log sender just logs.
    await createSmsSender({ provider: 'log' })('+919876543210', '123456');
  });
});

describe('Razorpay provider', () => {
  const opts = { keyId: 'rzp_test_1', keySecret: 'key-secret', webhookSecret: 'hook-secret' };

  it('creates orders with basic auth and amount in paise', async () => {
    const f = fakeFetch(() => Response.json({ id: 'order_ABC', amount: 149900 }));
    const rp = createRazorpayProvider({ ...opts, fetch: f.fetch });
    assert.deepEqual(await rp.createOrder({ amountPaise: 149900, currency: 'INR', receipt: 'pay-1' }), { orderId: 'order_ABC' });
    assert.equal(f.calls[0].url, 'https://api.razorpay.com/v1/orders');
    assert.equal((f.calls[0].init.headers as Record<string, string>).authorization, `Basic ${Buffer.from('rzp_test_1:key-secret').toString('base64')}`);
    assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), { amount: 149900, currency: 'INR', receipt: 'pay-1' });
    assert.equal(rp.keyId, 'rzp_test_1');
  });

  it('maps gateway failures to 502', async () => {
    for (const respond of [() => new Response('{}', { status: 401 }), () => Response.json({}), () => Promise.reject(new Error('down'))]) {
      const rp = createRazorpayProvider({ ...opts, fetch: fakeFetch(respond).fetch });
      await assert.rejects(rp.createOrder({ amountPaise: 100, currency: 'INR', receipt: 'r' }), (e: any) => e.status === 502);
    }
  });

  it('verifies checkout and webhook signatures (HMAC-SHA256, timing-safe)', () => {
    const rp = createRazorpayProvider(opts);
    const good = createHmac('sha256', 'key-secret').update('order_1|pay_1').digest('hex');
    assert.equal(rp.verifyPayment({ orderId: 'order_1', paymentId: 'pay_1', signature: good }), true);
    assert.equal(rp.verifyPayment({ orderId: 'order_1', paymentId: 'pay_2', signature: good }), false);
    assert.equal(rp.verifyPayment({ orderId: 'order_1', paymentId: 'pay_1', signature: 'short' }), false);
    const body = '{"event":"payment.captured"}';
    assert.equal(rp.verifyWebhook!(body, createHmac('sha256', 'hook-secret').update(body).digest('hex')), true);
    assert.equal(rp.verifyWebhook!(body, createHmac('sha256', 'wrong').update(body).digest('hex')), false);
  });
});

describe('Expo push sender', () => {
  it('sends batches of 100 with the access token and returns tickets in order', async () => {
    const f = fakeFetch((_url, init) => {
      const batch = JSON.parse(String(init.body)) as unknown[];
      return Response.json({ data: batch.map((_, i) => (i === 0 ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: `t${i}` })) });
    });
    const send = createExpoPushSender({ accessToken: 'expo-token', fetch: f.fetch });
    const messages = Array.from({ length: 150 }, (_, i) => ({ to: `ExponentPushToken[${i}]`, title: 't', body: 'b' }));
    const tickets = await send(messages);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].url, EXPO_PUSH_URL);
    assert.equal(JSON.parse(String(f.calls[0].init.body)).length, 100);
    assert.equal(JSON.parse(String(f.calls[1].init.body)).length, 50);
    assert.equal((f.calls[0].init.headers as Record<string, string>).authorization, 'Bearer expo-token');
    assert.equal(tickets.length, 150);
    assert.equal(tickets[100].details?.error, 'DeviceNotRegistered');

    const noToken = fakeFetch(() => Response.json({}));
    const short = await createExpoPushSender({ fetch: noToken.fetch })([{ to: 'ExponentPushToken[x]', title: 't', body: 'b' }]);
    assert.equal((noToken.calls[0].init.headers as Record<string, string>).authorization, undefined);
    assert.equal(short[0].status, 'error');
    await assert.rejects(createExpoPushSender({ fetch: fakeFetch(() => new Response('', { status: 500 })).fetch })(messages.slice(0, 1)));
  });
});

describe('server wiring', () => {
  it('builds the app from config with real provider adapters on an injected fetch, and shuts down cleanly', async () => {
    const f = fakeFetch((url) => (url.includes('razorpay') ? Response.json({ id: 'order_rzp_1' }) : Response.json({ data: [] })));
    const config = loadConfig({
      NODE_ENV: 'test',
      DB_PATH: ':memory:',
      SMS_PROVIDER: 'msg91',
      MSG91_AUTH_KEY: 'AK',
      MSG91_TEMPLATE_ID: 'TPL',
      PAYMENTS_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_test_1',
      RAZORPAY_KEY_SECRET: 'secret',
      RAZORPAY_WEBHOOK_SECRET: 'hook',
      EXPO_ACCESS_TOKEN: 'expo',
    });
    const { app, jobs, shutdown } = createServer(config, { fetch: f.fetch, logger: false });
    const otp = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '+919876543210' } });
    assert.equal(otp.statusCode, 200);
    assert.ok(f.calls.some((c) => c.url.includes('msg91')));
    const code = otp.json().devCode;
    const login = (await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone: '+919876543210', code } })).json();
    const auth = { authorization: `Bearer ${login.token}` };
    const gym = (await app.inject({ method: 'POST', url: '/gyms', headers: auth, payload: { name: 'Wired Gym', city: 'Pune' } })).json();
    await app.inject({ method: 'POST', url: '/me/devices', headers: auth, payload: { token: 'ExponentPushToken[abc]', platform: 'android' } });
    const plan = (await app.inject({ method: 'POST', url: `/gyms/${gym.id}/plans`, headers: auth, payload: { name: 'Monthly', durationDays: 30, pricePaise: 100000 } })).json();
    const order = (await app.inject({ method: 'POST', url: `/gyms/${gym.id}/payments/orders`, headers: auth, payload: { planId: plan.id } })).json();
    assert.deepEqual([order.provider, order.providerOrderId, order.keyId, order.mockSignature], ['razorpay', 'order_rzp_1', 'rzp_test_1', undefined]);
    jobs.tick();
    await shutdown('SIGTERM');
    await shutdown('SIGTERM'); // idempotent
    assert.throws(() => app.db.prepare('SELECT 1').get(), 'the database is closed');
  });
});
