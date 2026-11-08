import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ConfigError, describeConfig, loadConfig } from '../src/config';
import { buildApp } from '../src/app';
import { RateLimiter } from '../src/rate-limit';
import { maskPhone } from '../src/sms';
import { makeClock, setup } from './helpers';

const PROD_OK = {
  NODE_ENV: 'production',
  TOKEN_SECRET: 'x'.repeat(40),
  CORS_ORIGINS: 'https://app.example.com',
  SMS_PROVIDER: 'msg91',
  MSG91_AUTH_KEY: 'auth-key',
  MSG91_TEMPLATE_ID: 'tmpl',
  PAYMENTS_PROVIDER: 'razorpay',
  RAZORPAY_KEY_ID: 'rzp_live_key',
  RAZORPAY_KEY_SECRET: 'rzp-secret-value',
  RAZORPAY_WEBHOOK_SECRET: 'whsec-value',
  PUBLIC_API_URL: 'https://api.example.com/',
};

const problemsOf = (env: Record<string, string>) => {
  try {
    loadConfig(env);
    return [];
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    return err.problems;
  }
};

describe('config', () => {
  it('has safe development defaults', () => {
    const c = loadConfig({});
    assert.equal(c.env, 'development');
    assert.equal(c.port, 4000);
    assert.equal(c.sms.provider, 'log');
    assert.equal(c.payments.provider, 'mock');
    assert.equal(c.exposeDevOtp, true);
    assert.equal(c.corsOrigins, true);
    assert.equal(c.jobsEnabled, true);
    assert.equal(loadConfig({ EXPOSE_DEV_OTP: 'false' }).exposeDevOtp, false);
  });

  it('accepts a complete production configuration and never exposes OTPs there', () => {
    const c = loadConfig({ ...PROD_OK, EXPOSE_DEV_OTP: 'true', TRUST_PROXY: 'true', PLATFORM_ADMIN_PHONES: '+919999900001, +919999900009' });
    assert.equal(c.exposeDevOtp, false);
    assert.deepEqual(c.corsOrigins, ['https://app.example.com']);
    assert.equal(c.trustProxy, true);
    assert.deepEqual(c.platformAdminPhones, ['+919999900001', '+919999900009']);
    assert.equal(c.payments.provider, 'razorpay');
    assert.equal(c.publicUrl, 'https://api.example.com', 'trailing slash trimmed');
    assert.equal(loadConfig({ PORT: '4200' }).publicUrl, 'http://localhost:4200');
    const summary = JSON.stringify(describeConfig(c));
    for (const secret of [PROD_OK.TOKEN_SECRET, PROD_OK.RAZORPAY_KEY_SECRET, PROD_OK.MSG91_AUTH_KEY, PROD_OK.RAZORPAY_WEBHOOK_SECRET]) {
      assert.ok(!summary.includes(secret), 'the config summary must not contain secrets');
    }
  });

  it('refuses unsafe production settings, listing every problem', () => {
    const all = problemsOf({ NODE_ENV: 'production' });
    assert.ok(all.some((p) => p.includes('TOKEN_SECRET is required')));
    assert.ok(all.some((p) => p.includes('CORS_ORIGINS')));
    assert.ok(all.some((p) => p.includes('SMS_PROVIDER=log')));
    assert.ok(all.some((p) => p.includes('PAYMENTS_PROVIDER=mock')));
    assert.ok(problemsOf({ ...PROD_OK, TOKEN_SECRET: 'short' }).some((p) => p.includes('at least 32')));
    assert.ok(problemsOf({ ...PROD_OK, CORS_ORIGINS: '*' }).some((p) => p.includes('CORS_ORIGINS')));
    assert.ok(problemsOf({ ...PROD_OK, MSG91_AUTH_KEY: '' }).some((p) => p.includes('MSG91_AUTH_KEY')));
    assert.ok(problemsOf({ ...PROD_OK, RAZORPAY_WEBHOOK_SECRET: '' }).some((p) => p.includes('RAZORPAY_WEBHOOK_SECRET')));
    assert.ok(problemsOf({ ...PROD_OK, PUBLIC_API_URL: '' }).some((p) => p.includes('PUBLIC_API_URL is required')));
    assert.ok(problemsOf({ ...PROD_OK, PUBLIC_API_URL: 'http://api.example.com' }).some((p) => p.includes('https')));
    assert.ok(problemsOf({ PUBLIC_API_URL: 'api.example.com' }).some((p) => p.includes('http(s) URL')));
    assert.ok(problemsOf({ ...PROD_OK, SMS_PROVIDER: 'twilio' }).some((p) => p.includes('TWILIO_ACCOUNT_SID')));
    assert.ok(problemsOf({ PORT: 'eighty' }).some((p) => p.startsWith('PORT')));
    // Only the CI smoke test may run production with the fake providers.
    assert.deepEqual(problemsOf({ ...PROD_OK, SMS_PROVIDER: 'log', PAYMENTS_PROVIDER: 'mock', ALLOW_INSECURE_PROVIDERS: 'true' }), []);
    const twilio = loadConfig({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+15550001' });
    assert.equal(twilio.sms.provider, 'twilio');
  });

  it('allows demo data and ops endpoints only where they are safe', () => {
    assert.equal(loadConfig({ DEMO_SEED: 'true' }).demoSeed, true, 'staging/demo');
    assert.ok(problemsOf({ ...PROD_OK, DEMO_SEED: 'true' }).some((p) => p.includes('DEMO_SEED')));
    assert.ok(problemsOf({ OPS_TOKEN: 'too-short' }).some((p) => p.includes('OPS_TOKEN')));
    const ops = loadConfig({ ...PROD_OK, OPS_TOKEN: 'o'.repeat(40) });
    assert.equal(ops.opsToken, 'o'.repeat(40));
    assert.equal(describeConfig(ops).ops, true);
    assert.ok(!JSON.stringify(describeConfig(ops)).includes('o'.repeat(40)), 'the summary never contains the ops token');
  });

  it('server.ts exits with a clear message when production secrets are missing', () => {
    const res = spawnSync(process.execPath, ['--import', 'tsx', join(import.meta.dirname, '..', 'src', 'server.ts')], {
      cwd: join(import.meta.dirname, '..'),
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', DB_PATH: ':memory:' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /GymVerse API not started/);
    assert.match(res.stderr, /TOKEN_SECRET is required in production/);
  });
});

describe('HTTP hardening', () => {
  it('serves liveness and readiness probes', async () => {
    const { app, call } = setup();
    assert.deepEqual((await call('GET', '/health/live')).body, { ok: true });
    assert.deepEqual((await call('GET', '/health/ready')).body, { ok: true });
    assert.deepEqual((await call('GET', '/health')).body, { ok: true });
    app.db.close();
    const down = await call('GET', '/health/ready');
    assert.equal(down.status, 503);
    assert.equal(down.body.ok, false);
  });

  it('sets security headers, echoes request ids and never caches authenticated responses', async () => {
    const { call, login } = setup();
    const anon = await call('GET', '/health/live', undefined, undefined, { 'x-request-id': 'req-abc.123' });
    assert.equal(anon.headers['x-content-type-options'], 'nosniff');
    assert.equal(anon.headers['x-frame-options'], 'DENY');
    assert.equal(anon.headers['referrer-policy'], 'no-referrer');
    assert.equal(anon.headers['cross-origin-resource-policy'], 'same-site');
    assert.equal(anon.headers['x-powered-by'], undefined);
    assert.equal(anon.headers['x-request-id'], 'req-abc.123');
    assert.equal(anon.headers['cache-control'], undefined);
    const bad = await call('GET', '/health/live', undefined, undefined, { 'x-request-id': 'bad id with spaces' });
    assert.match(String(bad.headers['x-request-id']), /^[0-9a-f-]{36}$/, 'unsafe ids are replaced');
    const me = await login('+919800000001');
    const authed = await call('GET', '/me', me.token);
    assert.equal(authed.headers['cache-control'], 'no-store');
  });

  it('answers unknown routes, oversized bodies and crashes without leaking internals', async () => {
    const { app, call, login } = setup();
    app.get('/boom', async () => {
      throw new Error('SQLITE_ERROR: no such table: secret_stuff at /srv/app/src/x.ts:12');
    });
    assert.deepEqual((await call('GET', '/nope')).body, { error: 'not_found', message: 'Not found' });
    const crash = await call('GET', '/boom', undefined, undefined, { 'x-request-id': 'crash-1' });
    assert.equal(crash.status, 500);
    assert.deepEqual(crash.body, { error: 'internal', message: 'Something went wrong. Please try again.', requestId: 'crash-1' });
    const me = await login('+919800000001');
    const huge = await call('PATCH', '/me/profile', me.token, { bio: 'x'.repeat(300 * 1024) });
    assert.equal(huge.status, 413);
    assert.equal(huge.body.error, 'payload_too_large');
    const notJson = await app.inject({ method: 'POST', url: '/auth/otp/request', headers: { 'content-type': 'application/json' }, payload: '{nope' });
    assert.equal(notJson.statusCode, 400);
  });

  it('accepts member imports up to 2 MB', async () => {
    const { call, gymWithMember } = setup();
    const { owner, gym } = await gymWithMember();
    const rows = Array.from({ length: 5000 }, (_, i) => ({ phone: `+9170${String(i).padStart(8, '0')}`, name: `Imported person ${i} from the old paper register` }));
    assert.ok(JSON.stringify({ rows }).length > 256 * 1024);
    const res = await call('POST', `/gyms/${gym.id}/members/import`, owner.token, { rows });
    assert.equal(res.status, 200);
    assert.equal(res.body.added, 5000);
  });

  it('redacts secrets and masks phone numbers in logs', async () => {
    const lines: string[] = [];
    const app = buildApp({ logger: { level: 'info', stream: { write: (l: string) => void lines.push(l) } }, rateLimit: false, exposeDevOtp: true });
    app.log.info({ token: 'tok-123', phone: '+919876543210', body: { code: '123456', devCode: '654321', signature: 'sig' }, authorization: 'Bearer x' }, 'probe');
    const res = await app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone: '+919876543210' }, headers: { authorization: 'Bearer abc' } });
    assert.equal(res.statusCode, 200);
    const text = lines.join('\n');
    for (const secret of ['tok-123', '123456', '654321', '"sig"', 'Bearer x', 'Bearer abc', '9876543210']) {
      assert.ok(!text.includes(secret), `log contains ${secret}`);
    }
    assert.ok(text.includes('+********3210'));
    assert.ok(lines.some((l) => JSON.parse(l).reqId), 'request logs carry the request id');
    assert.equal(maskPhone('12'), '****');
  });
});

describe('rate limiting', () => {
  it('limits /auth per IP with 429 and Retry-After, then recovers', async () => {
    const clock = makeClock();
    const { call } = setup(clock, { rateLimit: { globalPerMin: 1000, authPerMin: 2, checkinPerMin: 100 } });
    const ask = () => call('POST', '/auth/otp/request', undefined, { phone: '+919800000001' });
    assert.equal((await ask()).status, 200);
    assert.equal((await ask()).status, 200);
    const limited = await ask();
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, 'rate_limited');
    assert.equal(limited.body.retryAfterSec, 60);
    assert.equal(limited.headers['retry-after'], '60');
    clock.advance(30_000);
    assert.equal((await ask()).body.retryAfterSec, 30);
    clock.advance(31_000);
    assert.equal((await ask()).status, 200);
  });

  it('applies the global limit per client IP (X-Forwarded-For behind the proxy) but never to health checks', async () => {
    const { call } = setup(makeClock(), { rateLimit: { globalPerMin: 3, authPerMin: 100, checkinPerMin: 100 }, trustProxy: true });
    const from = (ip: string) => call('GET', '/gyms/preview/ZZZZZZ', undefined, undefined, { 'x-forwarded-for': ip });
    for (let i = 0; i < 3; i++) assert.equal((await from('203.0.113.7')).status, 404);
    assert.equal((await from('203.0.113.7')).status, 429);
    assert.equal((await from('198.51.100.2')).status, 404, 'another client is unaffected');
    for (let i = 0; i < 5; i++) assert.equal((await call('GET', '/health/ready', undefined, undefined, { 'x-forwarded-for': '203.0.113.7' })).status, 200);
  });

  it('limits check-ins per user', async () => {
    const { call, gymWithMember } = setup(makeClock(), { rateLimit: { globalPerMin: 1000, authPerMin: 100, checkinPerMin: 2 } });
    const { member, owner, gym } = await gymWithMember();
    assert.equal((await call('POST', `/gyms/${gym.id}/checkins`, member.token, {})).status, 201);
    assert.equal((await call('POST', `/gyms/${gym.id}/checkins`, member.token, {})).status, 200);
    assert.equal((await call('POST', `/gyms/${gym.id}/checkins`, member.token, {})).status, 429);
    assert.equal((await call('POST', `/gyms/${gym.id}/checkins`, owner.token, {})).status, 201, 'per user, not per gym');
  });

  it('can be switched off, and forgets expired windows', async () => {
    const off = setup(makeClock(), { rateLimit: false });
    for (let i = 0; i < 15; i++) assert.equal((await off.call('POST', '/auth/otp/request', undefined, { phone: `+91980000${String(i).padStart(4, '0')}` })).status, 200);
    const clock = makeClock();
    const limiter = new RateLimiter(() => clock.now);
    limiter.hit('a', 5);
    limiter.hit('b', 5);
    assert.equal(limiter.size, 2);
    clock.advance(61_000);
    limiter.hit('c', 5);
    assert.equal(limiter.size, 1);
  });
});
