import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, makeClock, setup } from './helpers';

const ADMIN_PHONE = '+919800000777';

async function platform() {
  const ctx = setup(makeClock(), { platformAdminPhones: [ADMIN_PHONE] });
  const admin = await ctx.login(ADMIN_PHONE, 'Platform Pat');
  const a = await ctx.gymWithMember('1');
  const b = await ctx.gymWithMember('2');
  return { ...ctx, admin, a, b };
}

describe('platform admin console', () => {
  it('is invisible (404) to everyone but platform admins', async () => {
    const { call, a } = await platform();
    for (const [method, url, body] of [
      ['GET', '/admin/stats'],
      ['GET', '/admin/gyms'],
      ['PATCH', `/admin/gyms/${a.gym.id}`, { suspended: true }],
    ] as Array<[string, string, unknown?]>) {
      assert.equal((await call(method, url, a.owner.token, body)).status, 404, `${method} ${url} as gym owner`);
      assert.equal((await call(method, url, a.member.token, body)).status, 404, `${method} ${url} as member`);
      assert.equal((await call(method, url, undefined, body)).status, 404, `${method} ${url} signed out`);
    }
  });

  it('reports platform stats and gym rows', async () => {
    const { call, admin, a, b, clock } = await platform();
    await call('POST', `/gyms/${a.gym.id}/checkins`, a.member.token, {});
    await call('POST', `/gyms/${a.gym.id}/checkins`, a.owner.token, {});
    const plan = (await call('POST', `/gyms/${a.gym.id}/plans`, a.owner.token, { name: 'Monthly', durationDays: 30, pricePaise: 100000 })).body;
    const o = (await call('POST', `/gyms/${a.gym.id}/payments/orders`, a.member.token, { planId: plan.id })).body;
    await call('POST', `/gyms/${a.gym.id}/payments/${o.paymentId}/verify`, a.member.token, { providerPaymentId: 'p', signature: o.mockSignature });

    const stats = (await call('GET', '/admin/stats', admin.token)).body;
    assert.deepEqual(
      { ...stats },
      { gyms: 2, suspendedGyms: 0, users: 5, members: 2, checkInsToday: 2, checkIns30d: 2, revenue30dPaise: 100000, weeklyActiveRate: 0.5 },
    );
    assert.ok(stats.weeklyActiveRate >= 0 && stats.weeklyActiveRate <= 1, 'a fraction, not a percentage');

    const rows = (await call('GET', '/admin/gyms', admin.token)).body.gyms;
    assert.equal(rows.length, 2);
    const rowA = rows.find((r: any) => r.id === a.gym.id);
    assert.deepEqual(
      { members: rowA.members, active: rowA.activeMembers30d, checkIns: rowA.checkIns30d, revenue: rowA.revenue30dPaise, owners: rowA.owners.map((x: any) => x.name) },
      { members: 2, active: 2, checkIns: 2, revenue: 100000, owners: ['Owner 1'] },
    );
    assert.deepEqual((await call('GET', '/admin/gyms?q=gym 2', admin.token)).body.gyms.map((g: any) => g.id), [b.gym.id]);
    assert.deepEqual((await call('GET', `/admin/gyms?q=${a.gym.joinCode.toLowerCase()}`, admin.token)).body.gyms.map((g: any) => g.id), [a.gym.id]);
    clock.advance(31 * DAY);
    assert.equal((await call('GET', '/admin/stats', admin.token)).status, 404, 'an expired session is just another stranger');
  });

  it('changes plan tier and suspends gyms (audit-logged); suspended gyms lock their members out', async () => {
    const { app, call, admin, a, b, login } = await platform();
    const tier = await call('PATCH', `/admin/gyms/${a.gym.id}`, admin.token, { planTier: 'pro' });
    assert.equal(tier.body.planTier, 'pro');
    assert.equal((await call('PATCH', `/admin/gyms/${a.gym.id}`, admin.token, { planTier: 'gold' })).status, 400);
    assert.equal((await call('PATCH', '/admin/gyms/missing', admin.token, { suspended: true })).status, 404);

    const suspended = await call('PATCH', `/admin/gyms/${a.gym.id}`, admin.token, { suspended: true });
    assert.equal(suspended.body.suspended, true);
    const audit = app.db.prepare("SELECT actor_id FROM audit_log WHERE gym_id = ? AND action = 'admin.gym.update'").all(a.gym.id) as any[];
    assert.equal(audit.length, 2);
    assert.equal(audit[0].actor_id, admin.userId);
    assert.equal((await call('GET', '/admin/stats', admin.token)).body.suspendedGyms, 1);

    // Members: every gym-scoped route is 403 gym_suspended.
    for (const [method, url, body] of [
      ['GET', `/gyms/${a.gym.id}`],
      ['GET', `/gyms/${a.gym.id}/me/summary`],
      ['POST', `/gyms/${a.gym.id}/checkins`, {}],
      ['GET', `/gyms/${a.gym.id}/classes`],
      ['GET', `/gyms/${a.gym.id}/posts`],
      ['GET', `/gyms/${a.gym.id}/notifications`],
    ] as Array<[string, string, unknown?]>) {
      const res = await call(method, url, a.member.token, body);
      assert.equal(res.status, 403, `${method} ${url}`);
      assert.deepEqual(res.body, { error: 'gym_suspended', message: "This gym's account is paused. Please contact the gym." });
    }
    // The owner can still read the gym itself, but nothing else.
    const ownerView = await call('GET', `/gyms/${a.gym.id}`, a.owner.token);
    assert.equal(ownerView.status, 200);
    assert.equal(ownerView.body.gym.suspended, true);
    assert.equal((await call('GET', `/gyms/${a.gym.id}/members`, a.owner.token)).body.error, 'gym_suspended');
    assert.equal((await call('PATCH', `/gyms/${a.gym.id}/branding`, a.owner.token, { gymName: 'x x', primaryColor: '#000000', accentColor: '#000000', themePreference: 'light' })).status, 403);
    // /me still lists it, flagged.
    const me = (await call('GET', '/me', a.member.token)).body;
    assert.equal(me.memberships[0].gym.suspended, true);
    // Preview and join by code are 404.
    assert.equal((await call('GET', `/gyms/preview/${a.gym.joinCode}`)).status, 404);
    const newcomer = await login('+919800000555');
    assert.equal((await call('POST', '/gyms/join', newcomer.token, { code: a.gym.joinCode })).status, 404);
    // Other gyms are unaffected.
    assert.equal((await call('GET', `/gyms/${b.gym.id}/me/summary`, b.member.token)).status, 200);

    await call('PATCH', `/admin/gyms/${a.gym.id}`, admin.token, { suspended: false });
    assert.equal((await call('GET', `/gyms/${a.gym.id}/me/summary`, a.member.token)).status, 200);
  });
});
