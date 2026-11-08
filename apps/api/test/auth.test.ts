import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, setup } from './helpers';

describe('phone OTP auth', () => {
  it('logs in with a valid code and creates the user once', async () => {
    const { call } = setup();
    const r1 = await call('POST', '/auth/otp/request', undefined, { phone: '+91 98765 43210' });
    assert.equal(r1.status, 200);
    assert.match(r1.body.devCode, /^\d{6}$/);
    const v1 = await call('POST', '/auth/otp/verify', undefined, { phone: '+919876543210', code: r1.body.devCode });
    assert.equal(v1.status, 200);
    assert.equal(v1.body.isNewUser, true);
    assert.equal(v1.body.user.phone, '+919876543210');

    const r2 = await call('POST', '/auth/otp/request', undefined, { phone: '+919876543210' });
    const v2 = await call('POST', '/auth/otp/verify', undefined, { phone: '+919876543210', code: r2.body.devCode });
    assert.equal(v2.body.isNewUser, false);
    assert.equal(v2.body.user.id, v1.body.user.id);
  });

  it('rejects wrong, reused and expired codes', async () => {
    const { call, clock } = setup();
    const phone = '+919876543210';
    const r = await call('POST', '/auth/otp/request', undefined, { phone });
    const wrong = r.body.devCode === '000000' ? '111111' : '000000';
    const bad = await call('POST', '/auth/otp/verify', undefined, { phone, code: wrong });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'invalid_code');

    const ok = await call('POST', '/auth/otp/verify', undefined, { phone, code: r.body.devCode });
    assert.equal(ok.status, 200);
    const reused = await call('POST', '/auth/otp/verify', undefined, { phone, code: r.body.devCode });
    assert.equal(reused.status, 400);

    const r2 = await call('POST', '/auth/otp/request', undefined, { phone });
    clock.advance(6 * 60_000);
    const expired = await call('POST', '/auth/otp/verify', undefined, { phone, code: r2.body.devCode });
    assert.equal(expired.body.error, 'code_expired');
  });

  it('locks a code after too many wrong attempts', async () => {
    const { call } = setup();
    const phone = '+919876543210';
    const r = await call('POST', '/auth/otp/request', undefined, { phone });
    const wrong = r.body.devCode === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await call('POST', '/auth/otp/verify', undefined, { phone, code: wrong });
    const locked = await call('POST', '/auth/otp/verify', undefined, { phone, code: r.body.devCode });
    assert.equal(locked.status, 429);
  });

  it('rate-limits OTP requests per phone', async () => {
    const { call } = setup();
    for (let i = 0; i < 5; i++) {
      assert.equal((await call('POST', '/auth/otp/request', undefined, { phone: '+919876543210' })).status, 200);
    }
    const limited = await call('POST', '/auth/otp/request', undefined, { phone: '+919876543210' });
    assert.equal(limited.status, 429);
  });

  it('validates the phone number', async () => {
    const { call } = setup();
    const r = await call('POST', '/auth/otp/request', undefined, { phone: '12' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'validation');
  });

  it('requires a valid, unexpired token', async () => {
    const { call, login, clock } = setup();
    assert.equal((await call('GET', '/me')).status, 401);
    assert.equal((await call('GET', '/me', 'garbage.token')).status, 401);
    const { token } = await login('+919876543210');
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    assert.equal((await call('GET', '/me', tampered)).status, 401);
    assert.equal((await call('GET', '/me', token)).status, 200);
    clock.advance(31 * DAY);
    assert.equal((await call('GET', '/me', token)).status, 401);
  });
});

describe('profile', () => {
  it('updates and returns the personal profile', async () => {
    const { call, login } = setup();
    const { token } = await login('+919876543210');
    const res = await call('PATCH', '/me/profile', token, {
      name: 'Ravi',
      goal: 'stay_active',
      heightCm: 172,
      weightKg: 80.5,
      themeColor: '#0ea5e9',
      bio: 'Morning person',
      showStats: false,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, 'Ravi');
    assert.deepEqual(res.body.profile, {
      goal: 'stay_active',
      gender: null,
      activityLevel: null,
      heightCm: 172,
      weightKg: 80.5,
      birthYear: null,
      bio: 'Morning person',
      themeColor: '#0EA5E9',
      themeMode: 'gym',
      showStats: false,
      weeklyGoal: 3,
      notifyClassReminders: true,
      notifyAnnouncements: true,
      notifyWorkoutReminders: true,
      language: 'en',
      setupComplete: false,
    });
    const partial = await call('PATCH', '/me/profile', token, { weightKg: 79 });
    assert.equal(partial.body.user.name, 'Ravi');
    assert.equal(partial.body.profile.goal, 'stay_active');
    assert.equal(partial.body.profile.weightKg, 79);
  });

  it('rejects invalid profile values', async () => {
    const { call, login } = setup();
    const { token } = await login('+919876543210');
    const res = await call('PATCH', '/me/profile', token, { goal: 'fly', heightCm: 5 });
    assert.equal(res.status, 400);
  });
});
