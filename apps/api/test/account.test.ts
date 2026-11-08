import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_TERMS_VERSION } from '@gymverse/shared';
import { DAY, fakePush, makeClock, setup } from './helpers';

const TOKEN_A = 'ExponentPushToken[aaaa1111]';
const TOKEN_B = 'ExpoPushToken[bbbb2222]';

describe('devices and push', () => {
  it('registers devices (a token moves to the latest user) and removes them', async () => {
    const { app, call, login } = setup();
    const a = await login('+919800000001');
    const b = await login('+919800000002');
    assert.equal((await call('POST', '/me/devices', a.token, { token: TOKEN_A, platform: 'android' })).status, 204);
    assert.equal((await call('POST', '/me/devices', a.token, { token: TOKEN_A, platform: 'android' })).status, 204, 'upsert');
    assert.equal((await call('POST', '/me/devices', a.token, { token: 'not-a-token', platform: 'ios' })).status, 400);
    assert.equal((await call('POST', '/me/devices', a.token, { token: TOKEN_B, platform: 'tv' })).status, 400);
    await call('POST', '/me/devices', b.token, { token: TOKEN_A, platform: 'ios' });
    const owner = app.db.prepare('SELECT user_id, platform FROM devices WHERE token = ?').get(TOKEN_A) as any;
    assert.deepEqual({ ...owner }, { user_id: b.userId, platform: 'ios' });
    // Someone else's token cannot be removed.
    assert.equal((await call('DELETE', `/me/devices/${encodeURIComponent(TOKEN_A)}`, a.token)).status, 204);
    assert.ok(app.db.prepare('SELECT 1 FROM devices WHERE token = ?').get(TOKEN_A));
    await call('DELETE', `/me/devices/${encodeURIComponent(TOKEN_A)}`, b.token);
    assert.equal(app.db.prepare('SELECT 1 FROM devices WHERE token = ?').get(TOKEN_A), undefined);
  });

  it('pushes every server notification to the member devices, respecting preferences', async () => {
    const { call, gymWithMember, pushes, app, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    await call('POST', '/me/devices', member.token, { token: TOKEN_A, platform: 'android' });
    await call('POST', '/me/devices', member.token, { token: TOKEN_B, platform: 'ios' });
    await call('POST', `/gyms/${gym.id}/announcements`, owner.token, { title: 'Holiday timings', body: 'Closed Sunday' });
    await app.flushPush();
    assert.deepEqual(pushes.map((p) => [p.to, p.title]), [
      [TOKEN_A, 'Holiday timings'],
      [TOKEN_B, 'Holiday timings'],
    ]);
    assert.equal(pushes[0].data?.link, 'announcements');
    assert.equal(pushes[0].data?.gymId, gym.id);

    // Class notifications follow notifyClassReminders (the in-app notification is still created).
    await call('PATCH', '/me/profile', member.token, { notifyClassReminders: false });
    const cls = (
      await call('POST', `/gyms/${gym.id}/classes`, owner.token, {
        title: 'Spin',
        startsAt: new Date(clock.now.getTime() + DAY).toISOString(),
        durationMin: 30,
        capacity: 5,
      })
    ).body;
    await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, member.token);
    await app.flushPush();
    assert.equal(pushes.length, 2);
    const notes = (await call('GET', `/gyms/${gym.id}/notifications`, member.token)).body.notifications;
    assert.equal(notes[0].kind, 'booking');
    // Kinds without a preference (support replies) always push.
    const t = (await call('POST', `/gyms/${gym.id}/support/tickets`, member.token, { subject: 'Locker', message: 'Broken' })).body;
    await call('POST', `/gyms/${gym.id}/support/tickets/${t.id}/messages`, owner.token, { body: 'Fixed' });
    await app.flushPush();
    assert.equal(pushes.length, 4);
    assert.equal(pushes[3].data?.kind, 'support_reply');
  });

  it('drops tokens that Expo reports as DeviceNotRegistered and survives sender failures', async () => {
    const push = fakePush((m) => (m.to === TOKEN_A ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }));
    const { call, gymWithMember, app } = setup(makeClock(), { push: push.sender });
    const { owner, member, gym } = await gymWithMember();
    await call('POST', '/me/devices', member.token, { token: TOKEN_A, platform: 'android' });
    await call('POST', '/me/devices', member.token, { token: TOKEN_B, platform: 'ios' });
    await call('POST', `/gyms/${gym.id}/announcements`, owner.token, { title: 'News', body: 'x' });
    await app.flushPush();
    assert.equal(push.sent.length, 2);
    const left = (app.db.prepare('SELECT token FROM devices').all() as Array<{ token: string }>).map((d) => d.token);
    assert.deepEqual(left, [TOKEN_B]);

    const failing = setup(makeClock(), { push: () => Promise.reject(new Error('expo down')) });
    const g = await failing.gymWithMember();
    await failing.call('POST', '/me/devices', g.member.token, { token: TOKEN_A, platform: 'android' });
    const res = await failing.call('POST', `/gyms/${g.gym.id}/announcements`, g.owner.token, { title: 'News', body: 'x' });
    assert.equal(res.status, 201, 'push failures never fail the request');
    await failing.app.flushPush();
  });

  it('does not push notifications whose transaction rolled back', async () => {
    const { app, gymWithMember, pushes } = setup();
    const { member, gym } = await gymWithMember();
    app.db.prepare("INSERT INTO devices (token, user_id, platform, created_at, updated_at) VALUES (?, ?, 'ios', 'x', 'x')").run(TOKEN_A, member.userId);
    const { notify } = await import('../src/domain/notifications');
    const { tx } = await import('../src/db');
    assert.throws(() =>
      tx(app.db, () => {
        notify(app.db, gym.id, member.userId, { kind: 'system', title: 'Ghost', body: 'never committed' }, new Date());
        throw new Error('rollback');
      }),
    );
    await app.flushPush();
    assert.equal(pushes.length, 0);
  });
});

describe('consent', () => {
  it('records terms acceptance and shows it on /me', async () => {
    const { call, login } = setup();
    const me = await login('+919800000001');
    const before = (await call('GET', '/me', me.token)).body;
    assert.deepEqual(before.consent, {
      termsVersion: null,
      acceptedAt: null,
      guardianConsent: false,
      guardianName: null,
      needsConsent: true,
      needsGuardian: false,
    });
    assert.equal(before.isPlatformAdmin, false);
    const c = await call('POST', '/me/consent', me.token, { termsVersion: CURRENT_TERMS_VERSION });
    assert.equal(c.status, 200);
    assert.equal(c.body.needsConsent, false);
    assert.equal(c.body.acceptedAt, '2026-11-08T04:30:00.000Z');
    const old = await call('POST', '/me/consent', me.token, { termsVersion: '2025-01' });
    assert.equal(old.body.needsConsent, true, 'an older version must be re-accepted');
    assert.equal((await call('POST', '/me/consent', me.token, {})).status, 400);
  });

  it('requires a guardian for members under 18', async () => {
    const { call, login } = setup();
    const teen = await login('+919800000001');
    await call('PATCH', '/me/profile', teen.token, { birthYear: 2010 });
    assert.equal((await call('GET', '/me', teen.token)).body.consent.needsGuardian, true);
    const refused = await call('POST', '/me/consent', teen.token, { termsVersion: CURRENT_TERMS_VERSION });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, 'guardian_required');
    assert.equal((await call('POST', '/me/consent', teen.token, { termsVersion: CURRENT_TERMS_VERSION, guardianConsent: false })).status, 400);
    const ok = await call('POST', '/me/consent', teen.token, { termsVersion: CURRENT_TERMS_VERSION, guardianConsent: true, guardianName: 'Sunita Rao' });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.body.guardianConsent, ok.body.guardianName, ok.body.needsGuardian], [true, 'Sunita Rao', false]);
    const adult = await login('+919800000002');
    await call('PATCH', '/me/profile', adult.token, { birthYear: 1990 });
    assert.equal((await call('POST', '/me/consent', adult.token, { termsVersion: CURRENT_TERMS_VERSION })).status, 200);
  });
});

describe('account export and deletion', () => {
  async function activeMember() {
    const ctx = setup();
    const { owner, member, gym } = await ctx.gymWithMember();
    const { call, clock } = ctx;
    await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    const plan = (await call('POST', `/gyms/${gym.id}/plans`, owner.token, { name: 'Monthly', durationDays: 30, pricePaise: 100000 })).body;
    const order = (await call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id })).body;
    await call('POST', `/gyms/${gym.id}/payments/${order.paymentId}/verify`, member.token, { providerPaymentId: 'p', signature: order.mockSignature });
    const post = (await call('POST', `/gyms/${gym.id}/posts`, member.token, { body: 'My first post' })).body;
    await call('POST', `/gyms/${gym.id}/posts/${post.id}/comments`, member.token, { body: 'My comment' });
    const ticket = (await call('POST', `/gyms/${gym.id}/support/tickets`, member.token, { subject: 'Help', message: 'Question' })).body;
    await call('POST', '/me/measurements', member.token, { measuredOn: '2026-11-01', weightKg: 80 });
    await call('POST', `/gyms/${gym.id}/workouts`, member.token, {
      startedAt: new Date(clock.now.getTime() - 3600_000).toISOString(),
      completedAt: clock.now.toISOString(),
      sets: [{ exerciseId: 'ex_push_up', reps: 10 }],
    });
    await call('POST', '/me/devices', member.token, { token: TOKEN_A, platform: 'android' });
    return { ...ctx, owner, member, gym, post, ticket };
  }

  it('exports everything about the caller', async () => {
    const { call, member } = await activeMember();
    const res = await call('GET', '/me/export', member.token);
    assert.equal(res.status, 200);
    const e = res.body;
    assert.equal(e.user.id, member.userId);
    assert.deepEqual(
      [e.memberships.length, e.checkIns.length, e.payments.length, e.workouts.length, e.measurements.length, e.posts.length, e.comments.length, e.tickets.length],
      [1, 1, 1, 1, 1, 1, 1, 1],
    );
    assert.equal(e.tickets[0].messages.length, 1);
    assert.ok(e.notifications.length >= 1);
    assert.equal(e.profile.consent.needsConsent, true);
  });

  it('deletes the account: content anonymised, payments kept for the gym, login revoked', async () => {
    const { app, call, login, owner, member, gym, post, ticket } = await activeMember();
    assert.equal((await call('DELETE', '/me', member.token, { confirm: 'yes' })).status, 400);
    assert.equal((await call('DELETE', '/me', member.token, { confirm: 'DELETE' })).status, 204);
    assert.equal((await call('GET', '/me', member.token)).status, 401);

    const comments = (await call('GET', `/gyms/${gym.id}/posts/${post.id}/comments`, owner.token)).body.comments;
    assert.equal(comments[0].author.name, 'Deleted member');
    assert.equal(comments[0].body, 'My comment');
    const feed = (await call('GET', `/gyms/${gym.id}/posts`, owner.token)).body.posts;
    assert.equal(feed[0].author.name, 'Deleted member');
    const t = (await call('GET', `/gyms/${gym.id}/support/tickets/${ticket.id}`, owner.token)).body;
    assert.equal(t.member.name, 'Deleted member');

    const pays = app.db.prepare('SELECT user_id, status, amount_paise FROM payments WHERE gym_id = ?').all(gym.id) as any[];
    assert.deepEqual(pays.map((p) => ({ ...p })), [{ user_id: null, status: 'paid', amount_paise: 100000 }]);
    const members = (await call('GET', `/gyms/${gym.id}/members`, owner.token)).body.members;
    assert.ok(members.every((m: any) => m.userId !== member.userId));
    for (const table of ['checkins', 'measurements', 'devices', 'workout_logs', 'notifications', 'profiles']) {
      const n = (app.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(member.userId) as { n: number }).n;
      assert.equal(n, 0, table);
    }
    const tomb = app.db.prepare('SELECT phone, name, deleted_at FROM users WHERE id = ?').get(member.userId) as any;
    assert.equal(tomb.name, 'Deleted member');
    assert.ok(!tomb.phone.includes('9111111111'));

    // The phone number can sign up again as a brand-new account.
    const again = await login('+919111111111');
    assert.notEqual(again.userId, member.userId);
    assert.equal((await call('GET', '/me', again.token)).body.memberships.length, 0);
    // Revenue still counts the old payment.
    const revenue = (await call('GET', `/gyms/${gym.id}/reports/revenue`, owner.token)).body;
    assert.equal(revenue.collectedThisMonthPaise, 100000);
  });

  it('refuses to delete the only owner of a gym that has members (409 sole_owner)', async () => {
    const { call, gymWithMember, login } = setup();
    const { owner, member, gym } = await gymWithMember();
    const res = await call('DELETE', '/me', owner.token, { confirm: 'DELETE' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'sole_owner');
    assert.match(res.body.message, /Gym 1/);
    // With a second owner it works.
    await call('PATCH', `/gyms/${gym.id}/members/${member.userId}`, owner.token, { role: 'owner' });
    assert.equal((await call('DELETE', '/me', owner.token, { confirm: 'DELETE' })).status, 204);
    assert.equal((await call('GET', `/gyms/${gym.id}`, member.token)).status, 200);
    // An owner alone in their gym takes the empty gym with them.
    const solo = await login('+919800000099');
    const lonely = (await call('POST', '/gyms', solo.token, { name: 'Empty Gym', city: 'Pune' })).body;
    assert.equal((await call('DELETE', '/me', solo.token, { confirm: 'DELETE' })).status, 204);
    assert.equal((await call('GET', `/gyms/preview/${lonely.joinCode}`)).status, 404);
  });

  it('shows platform admins on /me', async () => {
    const { call, login } = setup(makeClock(), { platformAdminPhones: ['+919800000001'] });
    const admin = await login('+919800000001');
    const other = await login('+919800000002');
    assert.equal((await call('GET', '/me', admin.token)).body.isPlatformAdmin, true);
    assert.equal((await call('GET', '/me', other.token)).body.isPlatformAdmin, false);
  });
});
