import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, setup } from './helpers';

const kinds = (res: any) => res.body.notifications.map((n: any) => n.kind);

describe('notifications', () => {
  it('fans announcements out to active members except the author, respecting the opt-out', async () => {
    const { call, gymWithMember, joinAs } = setup();
    const { owner, member, gym } = await gymWithMember();
    const quiet = await joinAs(gym, owner.token, '+919800000007', 'Quiet Q');
    const gone = await joinAs(gym, owner.token, '+919800000008', 'Gone G');
    await call('PATCH', '/me/profile', quiet.token, { notifyAnnouncements: false });
    await call('DELETE', `/gyms/${gym.id}/members/${gone.userId}`, owner.token);

    await call('POST', `/gyms/${gym.id}/announcements`, owner.token, { title: 'Holiday timings', body: 'Closed Sunday' });
    const mine = await call('GET', `/gyms/${gym.id}/notifications`, member.token);
    assert.deepEqual(kinds(mine), ['announcement']);
    assert.equal(mine.body.notifications[0].title, 'Holiday timings');
    assert.equal(mine.body.notifications[0].link, 'announcements');
    assert.equal(mine.body.notifications[0].read, false);
    assert.equal(mine.body.unread, 1);
    assert.deepEqual(kinds(await call('GET', `/gyms/${gym.id}/notifications`, owner.token)), []);
    assert.deepEqual(kinds(await call('GET', `/gyms/${gym.id}/notifications`, quiet.token)), []);
    await call('POST', '/gyms/join', gone.token, { code: gym.joinCode });
    assert.deepEqual(kinds(await call('GET', `/gyms/${gym.id}/notifications`, gone.token)), [], 'inactive members are skipped');
  });

  it('notifies on booking, waitlist promotion and payment', async () => {
    const { call, gymWithMember, joinAs, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const second = await joinAs(gym, owner.token, '+919800000002', 'Second');
    const cls = (
      await call('POST', `/gyms/${gym.id}/classes`, owner.token, {
        title: 'HIIT',
        startsAt: new Date(clock.now.getTime() + DAY).toISOString(),
        durationMin: 30,
        capacity: 1,
      })
    ).body;
    await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, member.token);
    await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, member.token); // repeat: no second notification
    await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, second.token);
    const m = (await call('GET', `/gyms/${gym.id}/notifications`, member.token)).body.notifications;
    assert.deepEqual(m.map((n: any) => [n.kind, n.title]), [['booking', 'Class booked']]);
    assert.match(m[0].body, /HIIT/);
    assert.deepEqual(kinds(await call('GET', `/gyms/${gym.id}/notifications`, second.token)), ['booking']);

    await call('DELETE', `/gyms/${gym.id}/classes/${cls.id}/book`, member.token);
    const s = (await call('GET', `/gyms/${gym.id}/notifications`, second.token)).body.notifications;
    assert.deepEqual(s.map((n: any) => n.kind), ['waitlist_promoted', 'booking']);
    assert.equal(s[0].link, 'classes');

    const plan = (await call('POST', `/gyms/${gym.id}/plans`, owner.token, { name: 'Monthly', durationDays: 30, pricePaise: 100 })).body;
    const order = (await call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id })).body;
    const verify = { providerPaymentId: 'p', signature: order.mockSignature };
    await call('POST', `/gyms/${gym.id}/payments/${order.paymentId}/verify`, member.token, verify);
    await call('POST', `/gyms/${gym.id}/payments/${order.paymentId}/verify`, member.token, verify); // idempotent
    const after = (await call('GET', `/gyms/${gym.id}/notifications`, member.token)).body.notifications;
    assert.equal(after.filter((n: any) => n.kind === 'payment').length, 1);
    assert.equal(after[0].link, 'membership');
  });

  it('creates the membership-expiring notice lazily, once per end date', async () => {
    const { call, gymWithMember, clock, login } = setup();
    const { owner, member, gym } = await gymWithMember();
    const plan = (await call('POST', `/gyms/${gym.id}/plans`, owner.token, { name: 'Monthly', durationDays: 30, pricePaise: 100 })).body;
    const pay = async () => {
      const o = (await call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id })).body;
      await call('POST', `/gyms/${gym.id}/payments/${o.paymentId}/verify`, member.token, { providerPaymentId: 'p', signature: o.mockSignature });
    };
    await pay();
    const count = async () =>
      (await call('GET', `/gyms/${gym.id}/notifications`, member.token)).body.notifications.filter((n: any) => n.kind === 'membership_expiring')
        .length;
    assert.equal(await count(), 0);
    clock.advance(25 * DAY);
    const summary = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.equal(summary.membership.state, 'expiring');
    assert.equal(summary.unreadNotifications, 2, 'payment + expiring');
    await call('GET', `/gyms/${gym.id}/me/summary`, member.token);
    clock.advance(DAY);
    assert.equal(await count(), 1);
    // Renewing moves the end date; when that one gets close there is a new notice.
    await pay();
    clock.advance(30 * DAY);
    member.token = (await login('+919111111111')).token; // tokens last 30 days
    assert.equal(await count(), 2);
  });

  it('marks some or all as read', async () => {
    const { call, gymWithMember, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    for (let i = 0; i < 3; i++) {
      await call('POST', `/gyms/${gym.id}/announcements`, owner.token, { title: `News ${i}`, body: 'x' });
      clock.advance(60_000);
    }
    const list = (await call('GET', `/gyms/${gym.id}/notifications`, member.token)).body;
    assert.deepEqual(list.notifications.map((n: any) => n.title), ['News 2', 'News 1', 'News 0']);
    assert.equal(list.unread, 3);
    const one = await call('POST', `/gyms/${gym.id}/notifications/read`, member.token, { ids: [list.notifications[0].id, 'unknown-id'] });
    assert.deepEqual(one.body, { unread: 2 });
    // Someone else cannot mark my notifications.
    await call('POST', `/gyms/${gym.id}/notifications/read`, owner.token, { ids: [list.notifications[1].id] });
    assert.equal((await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body.unreadNotifications, 2);
    assert.deepEqual((await call('POST', `/gyms/${gym.id}/notifications/read`, member.token, {})).body, { unread: 0 });
    const after = (await call('GET', `/gyms/${gym.id}/notifications`, member.token)).body;
    assert.ok(after.notifications.every((n: any) => n.read));
    assert.equal((await call('POST', `/gyms/${gym.id}/notifications/read`, member.token, { ids: 'all' })).status, 400);
  });

  it('keeps notifications per gym', async () => {
    const { call, gymWithMember } = setup();
    const a = await gymWithMember('1');
    const b = await gymWithMember('2');
    await call('POST', '/gyms/join', a.member.token, { code: b.gym.joinCode });
    await call('POST', `/gyms/${b.gym.id}/announcements`, b.owner.token, { title: 'B news', body: 'x' });
    assert.equal((await call('GET', `/gyms/${a.gym.id}/notifications`, a.member.token)).body.notifications.length, 0);
    assert.equal((await call('GET', `/gyms/${b.gym.id}/notifications`, a.member.token)).body.notifications.length, 1);
  });
});
