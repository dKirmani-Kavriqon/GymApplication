import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../src/app';
import { SCHEMA_VERSION, initDb } from '../src/db';
import { nodeDb, openDb } from '../src/db-node';
import { MIGRATIONS } from '../src/migrations';
import { setup } from './helpers';

describe('v0.2 gym defaults and branding', () => {
  it('new gyms get Burgundy & Beige in light mode', async () => {
    const { call, login } = setup();
    const owner = await login('+919000000001');
    const gym = (await call('POST', '/gyms', owner.token, { name: 'Fresh Gym', city: 'Pune' })).body;
    assert.deepEqual(
      [gym.branding.primaryColor, gym.branding.accentColor, gym.branding.themePreference],
      ['#6B0F1A', '#B54B6A', 'light'],
    );
    for (const f of ['workouts', 'nutrition', 'community', 'resources', 'support']) assert.ok(gym.enabledFeatures.includes(f), f);
  });

  it('only reports contrast issues for the modes the gym uses', async () => {
    const { call, gymWithMember } = setup();
    const { owner, gym } = await gymWithMember();
    // Burgundy is fine on white but nearly invisible on the dark surface.
    const body = { gymName: 'Burgundy Gym', primaryColor: '#6B0F1A', accentColor: '#B54B6A' };
    const light = (await call('PATCH', `/gyms/${gym.id}/branding`, owner.token, { ...body, themePreference: 'light' })).body;
    assert.deepEqual(light.contrastIssues, []);
    const dark = (await call('PATCH', `/gyms/${gym.id}/branding`, owner.token, { ...body, themePreference: 'dark' })).body;
    assert.ok(dark.contrastIssues.length > 0);
    assert.ok(dark.contrastIssues.every((i: any) => i.against === 'dark'));
    const auto = (await call('PATCH', `/gyms/${gym.id}/branding`, owner.token, { ...body, primaryColor: '#FFE600', accentColor: '#6B0F1A', themePreference: 'auto' })).body;
    assert.deepEqual(new Set(auto.contrastIssues.map((i: any) => i.against)), new Set(['light', 'dark']));
  });
});

describe('v0.2 profile', () => {
  it('accepts the new settings and returns defaults for unset ones', async () => {
    const { call, login } = setup();
    const { token } = await login('+919876543210');
    const before = (await call('GET', '/me', token)).body.profile;
    assert.deepEqual(
      [before.themeMode, before.weeklyGoal, before.language, before.setupComplete, before.notifyAnnouncements, before.themeColor],
      ['gym', 3, 'en', false, true, null],
    );
    const res = await call('PATCH', '/me/profile', token, {
      gender: 'female',
      activityLevel: 'moderate',
      themeColor: '#0b4f6c',
      themeMode: 'dark',
      weeklyGoal: 5,
      notifyClassReminders: false,
      notifyAnnouncements: false,
      notifyWorkoutReminders: false,
      language: 'hi',
      setupComplete: true,
    });
    assert.equal(res.status, 200);
    const p = res.body.profile;
    assert.deepEqual(
      [p.gender, p.activityLevel, p.themeColor, p.themeMode, p.weeklyGoal, p.notifyClassReminders, p.notifyAnnouncements, p.notifyWorkoutReminders, p.language, p.setupComplete],
      ['female', 'moderate', '#0B4F6C', 'dark', 5, false, false, false, 'hi', true],
    );
    const cleared = (await call('PATCH', '/me/profile', token, { themeColor: null, gender: null })).body.profile;
    assert.equal(cleared.themeColor, null);
    assert.equal(cleared.gender, null);
    assert.equal(cleared.weeklyGoal, 5, 'untouched fields stay');

    for (const bad of [{ weeklyGoal: 8 }, { themeMode: 'neon' }, { language: 'fr' }, { activityLevel: 'couch' }, { themeColor: 'blue' }]) {
      assert.equal((await call('PATCH', '/me/profile', token, bad)).status, 400, JSON.stringify(bad));
    }
  });

  it('home summary reports the Monday-start weekly goal in the gym time zone', async () => {
    const { call, gymWithMember, clock } = setup();
    const { member, gym } = await gymWithMember();
    await call('PATCH', '/me/profile', member.token, { weeklyGoal: 3 });
    // Last week (Mon 26 Oct - Sun 1 Nov): one visit, on Sunday 1 Nov at 23:00 IST.
    clock.set('2026-11-01T17:30:00.000Z');
    await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    // This week: Monday 2 Nov 00:30 IST (still Sunday in UTC) and Wednesday 4 Nov.
    clock.set('2026-11-01T19:00:00.000Z');
    await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    clock.set('2026-11-04T04:30:00.000Z');
    await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    clock.set('2026-11-08T04:30:00.000Z');
    const s = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.deepEqual(s.weekly, { goal: 3, visits: 2, percent: 67, deltaVsLastWeek: 1, days: [1, 0, 1, 0, 0, 0, 0] });
    assert.equal(s.unreadNotifications, 0);
    assert.equal(s.activeChallenge, null);
    assert.equal(s.recommendedRoutine, null);

    await call('PATCH', '/me/profile', member.token, { weeklyGoal: 1 });
    assert.equal((await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body.weekly.percent, 100, 'capped at 100');
  });
});

// Rows in a database created by the v0.1 API (schema: migration 1, user_version never set).
const V01_DATA = `
INSERT INTO users VALUES ('u1', '+919876500000', 'Old Timer', NULL, '2026-01-01T00:00:00.000Z');
INSERT INTO profiles (user_id, goal, weight_kg, accent_color, show_stats) VALUES ('u1', 'build_muscle', 77, '#0EA5E9', 0);
INSERT INTO gyms (id, name, city, timezone, join_code, primary_color, accent_color, enabled_features, created_at)
  VALUES ('g1', 'Old Gym', 'Pune', 'Asia/Kolkata', 'OLDGYM', '#E11D48', '#D97706',
          '["checkin","classes","payments","progress","announcements","badges"]', '2026-01-01T00:00:00.000Z');
INSERT INTO branches VALUES ('b1', 'g1', 'Main', NULL, '2026-01-01T00:00:00.000Z');
INSERT INTO gym_members VALUES ('g1', 'u1', 'owner', 'active', '2026-01-01T00:00:00.000Z');
INSERT INTO plans (id, gym_id, name, duration_days, price_paise, benefits, created_at)
  VALUES ('p1', 'g1', 'Monthly', 30, 149900, '[]', '2026-01-01T00:00:00.000Z');
INSERT INTO payments (id, gym_id, user_id, plan_id, amount_paise, provider, provider_order_id, status, receipt_number, created_at, paid_at)
  VALUES ('pay1', 'g1', 'u1', 'p1', 149900, 'mock', 'order_1', 'paid', 'OLDGYM-00001', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
`;

describe('migrating a v0.1 database', () => {
  it('renames accent_color, adds the new profile columns and switches on the new features', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gymverse-migrate-'));
    const path = join(dir, 'v01.db');
    try {
      const old = new DatabaseSync(path);
      MIGRATIONS[0](nodeDb(old)); // the v0.1 schema, without setting user_version (v0.1 never did)
      old.exec(V01_DATA);
      old.close();

      const db = openDb(path);
      assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, SCHEMA_VERSION);
      const cols = (db.prepare('PRAGMA table_info(profiles)').all() as any[]).map((c) => c.name);
      assert.ok(cols.includes('theme_color') && !cols.includes('accent_color'));
      for (const c of ['gender', 'activity_level', 'theme_mode', 'weekly_goal', 'notify_class_reminders', 'notify_announcements', 'notify_workout_reminders', 'language', 'setup_complete']) {
        assert.ok(cols.includes(c), c);
      }
      // v0.3 rebuilt payments (nullable user_id, coupon columns) without losing rows.
      const pay = db.prepare('SELECT user_id, amount_paise, original_paise, discount_paise, receipt_number FROM payments').get() as any;
      assert.deepEqual({ ...pay }, { user_id: 'u1', amount_paise: 149900, original_paise: 149900, discount_paise: 0, receipt_number: 'OLDGYM-00001' });
      const payCols = db.prepare('PRAGMA table_info(payments)').all() as any[];
      assert.equal(payCols.find((c) => c.name === 'user_id').notnull, 0);
      assert.equal((db.prepare('PRAGMA journal_mode').get() as any).journal_mode, 'wal');
      initDb(db); // running again is a no-op
      db.close();

      // Re-open the file through the app and use it.
      const app = buildApp({ dbPath: path, exposeDevOtp: true, tokenSecret: 't', now: () => new Date('2026-11-08T04:30:00.000Z') });
      const inject = async (method: string, url: string, token?: string, payload?: object) => {
        const res = await app.inject({ method: method as 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload });
        return { status: res.statusCode, body: res.json() };
      };
      const otp = await inject('POST', '/auth/otp/request', undefined, { phone: '+919876500000' });
      const login = await inject('POST', '/auth/otp/verify', undefined, { phone: '+919876500000', code: otp.body.devCode });
      assert.equal(login.body.isNewUser, false);
      const me = (await inject('GET', '/me', login.body.token)).body;
      assert.deepEqual(
        [me.profile.themeColor, me.profile.goal, me.profile.weightKg, me.profile.showStats, me.profile.themeMode, me.profile.weeklyGoal, me.profile.setupComplete],
        ['#0EA5E9', 'build_muscle', 77, false, 'gym', 3, false],
      );
      const gym = me.memberships[0].gym;
      assert.equal(gym.branding.themePreference, 'auto', 'existing gyms keep their settings');
      assert.equal(gym.branding.primaryColor, '#E11D48');
      assert.ok(gym.enabledFeatures.includes('checkin') && gym.enabledFeatures.includes('workouts') && gym.enabledFeatures.includes('support'));
      assert.equal((await inject('GET', `/gyms/g1/routines`, login.body.token)).status, 200);
      assert.equal((await inject('POST', `/gyms/g1/checkins`, login.body.token, {})).status, 201);
      const patched = await inject('PATCH', '/me/profile', login.body.token, { themeColor: '#1F5135', weeklyGoal: 4 });
      assert.deepEqual([patched.body.profile.themeColor, patched.body.profile.weeklyGoal], ['#1F5135', 4]);
      await app.close();
      app.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('upgrades a database handed to buildApp directly', async () => {
    const db = new DatabaseSync(':memory:');
    MIGRATIONS[0](nodeDb(db));
    db.exec(V01_DATA);
    const app = buildApp({ db });
    const row = app.db.prepare('SELECT theme_color, weekly_goal FROM profiles WHERE user_id = ?').get('u1') as any;
    assert.deepEqual({ ...row }, { theme_color: '#0EA5E9', weekly_goal: 3 });
    const exercises = (app.db.prepare('SELECT COUNT(*) AS n FROM exercises WHERE gym_id IS NULL').get() as any).n;
    assert.ok(exercises >= 20);
    await app.close();
  });
});
