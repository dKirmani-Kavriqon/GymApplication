import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, setup } from './helpers';

const HOUR = 3600_000;

describe('class attendance', () => {
  it('staff mark booked people; attending records a staff check-in once', async () => {
    const { call, gymWithMember, joinAs, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Coach Asha', 'trainer');
    const waiter = await joinAs(gym, owner.token, '+919800000004', 'Waiting Wendy');
    const cls = (
      await call('POST', `/gyms/${gym.id}/classes`, owner.token, {
        title: 'Spin',
        trainerName: 'Coach Asha',
        startsAt: new Date(clock.now.getTime() + HOUR).toISOString(),
        durationMin: 45,
        capacity: 1,
      })
    ).body;
    await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, member.token);
    await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, waiter.token);
    const list = (await call('GET', `/gyms/${gym.id}/classes/${cls.id}/attendees`, trainer.token)).body.attendees;
    assert.deepEqual(list.map((a: any) => [a.name, a.status, a.attended]), [
      ['Member 1', 'booked', null],
      ['Waiting Wendy', 'waitlisted', null],
    ]);
    const url = (u: string) => `/gyms/${gym.id}/classes/${cls.id}/attendees/${u}`;
    assert.equal((await call('PUT', url(waiter.userId), trainer.token, { attended: true })).status, 404, 'waitlisted');
    assert.equal((await call('PUT', url(owner.userId), trainer.token, { attended: true })).status, 404, 'not booked');
    assert.equal((await call('PUT', url(member.userId), member.token, { attended: true })).status, 403);
    assert.equal((await call('PUT', url(member.userId), trainer.token, { attended: 'yes' })).status, 400);

    clock.advance(2 * HOUR);
    const marked = await call('PUT', url(member.userId), trainer.token, { attended: true });
    assert.equal(marked.status, 200);
    assert.deepEqual([marked.body.userId, marked.body.attended], [member.userId, true]);
    const s = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.equal(s.checkedInToday, true);
    assert.ok(s.badges.includes('first_checkin'));
    await call('PUT', url(member.userId), trainer.token, { attended: true });
    assert.equal((await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body.totalCheckIns, 1, 'no duplicate check-in');
    const absent = await call('PUT', url(member.userId), owner.token, { attended: false });
    assert.equal(absent.body.attended, false);
  });

  it("lists today's classes for staff, the caller's own first", async () => {
    const { call, gymWithMember, joinAs, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Coach Asha', 'trainer');
    const mk = (title: string, trainerName: string, at: number) =>
      call('POST', `/gyms/${gym.id}/classes`, owner.token, {
        title,
        trainerName,
        startsAt: new Date(at).toISOString(),
        durationMin: 45,
        capacity: 10,
      });
    // Clock: 10:00 IST on 8 Nov.
    await mk('Zumba', 'Anjali', clock.now.getTime() + HOUR);
    await mk('Spin', 'coach asha', clock.now.getTime() + 3 * HOUR);
    await mk('Tomorrow yoga', 'Coach Asha', clock.now.getTime() + DAY);
    const today = (await call('GET', `/gyms/${gym.id}/trainer/today`, trainer.token)).body.classes;
    assert.deepEqual(today.map((c: any) => c.title), ['Spin', 'Zumba']);
    assert.deepEqual(today[0].attendees, []);
    assert.equal((await call('GET', `/gyms/${gym.id}/trainer/today`, member.token)).status, 403);
    const forOwner = (await call('GET', `/gyms/${gym.id}/trainer/today`, owner.token)).body.classes;
    assert.deepEqual(forOwner.map((c: any) => c.title), ['Zumba', 'Spin']);
  });
});

describe('door QR check-in, offline check-ins and crowd', () => {
  it('admins get and rotate the door code; QR check-ins need the current token', async () => {
    const { call, gymWithMember, joinAs } = setup();
    const { owner, member, gym } = await gymWithMember();
    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Trainer', 'trainer');
    assert.equal((await call('GET', `/gyms/${gym.id}/door-code`, trainer.token)).status, 403);
    const code = (await call('GET', `/gyms/${gym.id}/door-code`, owner.token)).body;
    assert.match(code.token, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(code.url, `gymverse://checkin/${code.token}`);
    assert.equal((await call('GET', `/gyms/${gym.id}/door-code`, owner.token)).body.token, code.token, 'stable until rotated');

    const qr = (doorToken?: string) => call('POST', `/gyms/${gym.id}/checkins`, member.token, { method: 'qr', ...(doorToken ? { doorToken } : {}) });
    const missing = await qr();
    assert.equal(missing.status, 403);
    assert.equal(missing.body.error, 'bad_door_code');
    assert.equal((await qr('wrong-token-123')).status, 403);
    assert.equal((await qr(code.token)).status, 201);

    const rotated = (await call('POST', `/gyms/${gym.id}/door-code/rotate`, owner.token)).body;
    assert.notEqual(rotated.token, code.token);
    const other = await joinAs(gym, owner.token, '+919800000005', 'Other');
    assert.equal((await call('POST', `/gyms/${gym.id}/checkins`, other.token, { method: 'qr', doorToken: code.token })).status, 403, 'old token stops working');
    assert.equal((await call('POST', `/gyms/${gym.id}/checkins`, other.token, { method: 'qr', doorToken: rotated.token })).status, 201);
    assert.equal((await call('POST', `/gyms/${gym.id}/door-code/rotate`, member.token)).status, 403);
  });

  it('accepts offline check-ins up to 12 hours old, for the day they happened', async () => {
    const { call, gymWithMember, clock } = setup();
    const { member, gym } = await gymWithMember();
    // Clock 10:00 IST on 8 Nov. 22:00 IST on 7 Nov is 12 h ago.
    clock.set('2026-11-08T04:30:00.000Z');
    const late = await call('POST', `/gyms/${gym.id}/checkins`, member.token, { occurredAt: '2026-11-07T16:45:00.000Z' });
    assert.equal(late.status, 201);
    assert.equal(late.body.checkedInAt, '2026-11-07T16:45:00.000Z');
    const today = await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    assert.equal(today.status, 201, 'yesterday and today are different days');
    assert.deepEqual(today.body.streak, { current: 2, longest: 2 });
    const tooOld = await call('POST', `/gyms/${gym.id}/checkins`, member.token, { occurredAt: '2026-11-07T16:00:00.000Z' });
    assert.equal(tooOld.status, 400);
    assert.equal(tooOld.body.error, 'bad_occurred_at');
    assert.equal((await call('POST', `/gyms/${gym.id}/checkins`, member.token, { occurredAt: '2026-11-08T06:00:00.000Z' })).status, 400, 'future');
    assert.equal((await call('POST', `/gyms/${gym.id}/checkins`, member.token, { occurredAt: '2026-11-08T04:31:00.000Z' })).status, 200, 'small clock skew is fine');
    assert.equal((await call('POST', `/gyms/${gym.id}/checkins`, member.token, { occurredAt: 'yesterday' })).status, 400);
  });

  it('reports how busy the gym is on the home summary', async () => {
    const { call, gymWithMember, joinAs, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const quiet = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body.crowd;
    assert.deepEqual(quiet, { level: 'quiet', recentCheckIns: 0 });
    const people = [member, owner];
    for (let i = 0; i < 10; i++) people.push(await joinAs(gym, owner.token, `+9198000001${String(i).padStart(2, '0')}`, `P${i}`));
    for (const p of people) await call('POST', `/gyms/${gym.id}/checkins`, p.token, {});
    assert.deepEqual((await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body.crowd, { level: 'moderate', recentCheckIns: 12 });
    clock.advance(91 * 60_000);
    assert.equal((await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body.crowd.recentCheckIns, 0);
  });
});

describe('referrals', () => {
  it('shares a link, counts friends who joined with it once, and lets admins set the reward', async () => {
    const { call, gymWithMember, login } = setup();
    const { owner, member, gym } = await gymWithMember();
    const info = (await call('GET', `/gyms/${gym.id}/referral`, member.token)).body;
    assert.equal(info.link, `https://gymverse.app/join/${gym.joinCode}?ref=${member.userId}`);
    assert.match(info.message, new RegExp(gym.joinCode));
    assert.deepEqual([info.joined, info.reward], [0, null]);

    const friend = await login('+919800000011');
    await call('POST', '/gyms/join', friend.token, { code: gym.joinCode, ref: member.userId });
    await call('POST', '/gyms/join', friend.token, { code: gym.joinCode, ref: owner.userId }); // already a member: ignored
    const stranger = await login('+919800000012');
    await call('POST', '/gyms/join', stranger.token, { code: gym.joinCode, ref: 'not-a-member' });
    const self = await login('+919800000013');
    await call('POST', '/gyms/join', self.token, { code: gym.joinCode, ref: self.userId });
    assert.equal((await call('GET', `/gyms/${gym.id}/referral`, member.token)).body.joined, 1);
    assert.equal((await call('GET', `/gyms/${gym.id}/referral`, owner.token)).body.joined, 0);

    assert.equal((await call('PUT', `/gyms/${gym.id}/referral`, member.token, { reward: 'x' })).status, 403);
    assert.deepEqual((await call('PUT', `/gyms/${gym.id}/referral`, owner.token, { reward: 'One week free' })).body, { reward: 'One week free' });
    assert.equal((await call('GET', `/gyms/${gym.id}/referral`, friend.token)).body.reward, 'One week free');
    assert.deepEqual((await call('PUT', `/gyms/${gym.id}/referral`, owner.token, { reward: null })).body, { reward: null });
  });
});

describe('revenue report', () => {
  it('sums collections, plans, renewals due, unpaid members and coupon discounts', async () => {
    const { call, gymWithMember, joinAs, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    await joinAs(gym, owner.token, '+919800000021', 'Unpaid Uma');
    const monthly = (await call('POST', `/gyms/${gym.id}/plans`, owner.token, { name: 'Monthly', durationDays: 30, pricePaise: 100000 })).body;
    const weekly = (await call('POST', `/gyms/${gym.id}/plans`, owner.token, { name: 'Week pass', durationDays: 5, pricePaise: 30000 })).body;
    await call('POST', `/gyms/${gym.id}/coupons`, owner.token, { code: 'HALF', kind: 'percent', amount: 50 });
    const pay = async (token: string, planId: string, couponCode?: string) => {
      const o = (await call('POST', `/gyms/${gym.id}/payments/orders`, token, { planId, couponCode })).body;
      await call('POST', `/gyms/${gym.id}/payments/${o.paymentId}/verify`, token, { providerPaymentId: 'p', signature: o.mockSignature });
    };
    clock.set('2026-10-20T06:00:00.000Z');
    await pay(member.token, monthly.id); // last month
    clock.set('2026-11-08T04:30:00.000Z');
    await pay(member.token, monthly.id, 'HALF'); // this month, 50% off
    const buyer = await joinAs(gym, owner.token, '+919800000022', 'Weekly Will');
    await pay(buyer.token, weekly.id);
    const r = (await call('GET', `/gyms/${gym.id}/reports/revenue`, owner.token)).body;
    assert.equal(r.collectedThisMonthPaise, 80000);
    assert.equal(r.collectedLastMonthPaise, 100000);
    assert.equal(r.couponDiscountsThisMonthPaise, 50000);
    assert.equal(r.daily.length, 30);
    assert.deepEqual(r.daily.at(-1), { day: '2026-11-08', paise: 80000 });
    assert.deepEqual(r.daily.find((d: any) => d.day === '2026-10-20'), { day: '2026-10-20', paise: 100000 });
    assert.deepEqual(r.byPlan.map((p: any) => [p.planName, p.count, p.paise]), [
      ['Monthly', 2, 150000],
      ['Week pass', 1, 30000],
    ]);
    assert.deepEqual(r.renewalsDue.map((x: any) => [x.name, x.planName]), [['Weekly Will', 'Week pass']]);
    assert.equal(r.unpaidMembers, 1);
    assert.equal((await call('GET', `/gyms/${gym.id}/reports/revenue`, member.token)).status, 403);
  });
});

describe('membership freeze requests', () => {
  async function paidMember() {
    const ctx = setup();
    const { owner, member, gym } = await ctx.gymWithMember();
    const plan = (await ctx.call('POST', `/gyms/${gym.id}/plans`, owner.token, { name: 'Monthly', durationDays: 30, pricePaise: 100000 })).body;
    const o = (await ctx.call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id })).body;
    const paid = (await ctx.call('POST', `/gyms/${gym.id}/payments/${o.paymentId}/verify`, member.token, { providerPaymentId: 'p', signature: o.mockSignature })).body;
    return { ...ctx, owner, member, gym, endsAt: paid.membershipEndsAt as string };
  }
  const body = { startsOn: '2026-11-20', endsOn: '2026-11-29', reason: 'Work trip to Delhi' };

  it('members request; admins approve (end date moves, member notified) or reject', async () => {
    const { call, owner, member, gym, endsAt, joinAs } = await paidMember();
    const created = await call('POST', `/gyms/${gym.id}/freeze-requests`, member.token, body);
    assert.equal(created.status, 201);
    const expected = new Date(new Date(endsAt).getTime() + 10 * DAY).toISOString();
    assert.deepEqual([created.body.days, created.body.status, created.body.newEndsAt], [10, 'pending', expected]);
    const dup = await call('POST', `/gyms/${gym.id}/freeze-requests`, member.token, body);
    assert.equal(dup.body.error, 'freeze_pending');

    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Trainer', 'trainer');
    assert.equal((await call('PATCH', `/gyms/${gym.id}/freeze-requests/${created.body.id}`, trainer.token, { status: 'approved' })).status, 403);
    assert.deepEqual((await call('GET', `/gyms/${gym.id}/freeze-requests`, trainer.token)).body.requests, [], 'trainers only see their own');
    assert.equal((await call('GET', `/gyms/${gym.id}/freeze-requests?status=pending`, owner.token)).body.requests.length, 1);

    const approved = await call('PATCH', `/gyms/${gym.id}/freeze-requests/${created.body.id}`, owner.token, { status: 'approved', note: 'Enjoy!' });
    assert.equal(approved.status, 200);
    assert.deepEqual([approved.body.status, approved.body.note, approved.body.newEndsAt], ['approved', 'Enjoy!', expected]);
    assert.ok(approved.body.decidedAt);
    const s = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.equal(s.membership.endsAt, expected);
    assert.equal(s.membership.daysLeft, 40);
    const notes = (await call('GET', `/gyms/${gym.id}/notifications`, member.token)).body.notifications;
    assert.equal(notes[0].title, 'Membership freeze approved');
    assert.equal(notes[0].kind, 'freeze_decision');
    assert.equal((await call('PATCH', `/gyms/${gym.id}/freeze-requests/${created.body.id}`, owner.token, { status: 'rejected' })).body.error, 'already_decided');

    const second = (await call('POST', `/gyms/${gym.id}/freeze-requests`, member.token, { ...body, startsOn: '2026-12-20', endsOn: '2026-12-21' })).body;
    const rejected = (await call('PATCH', `/gyms/${gym.id}/freeze-requests/${second.id}`, owner.token, { status: 'rejected', note: 'Peak season' })).body;
    assert.deepEqual([rejected.status, rejected.newEndsAt], ['rejected', null]);
    assert.match((await call('GET', `/gyms/${gym.id}/notifications`, member.token)).body.notifications[0].body, /Peak season/);
    assert.deepEqual((await call('GET', `/gyms/${gym.id}/freeze-requests`, member.token)).body.requests.map((r: any) => r.status), ['rejected', 'approved']);
    assert.equal((await call('PATCH', `/gyms/${gym.id}/freeze-requests/missing`, owner.token, { status: 'approved' })).status, 404);
  });

  it('validates length, dates and membership', async () => {
    const { call, gymWithMember } = setup();
    const { member, gym } = await gymWithMember();
    assert.equal((await call('POST', `/gyms/${gym.id}/freeze-requests`, member.token, body)).body.error, 'no_active_membership');
    const p = await paidMember();
    const long = await p.call('POST', `/gyms/${p.gym.id}/freeze-requests`, p.member.token, { ...body, endsOn: '2027-02-01' });
    assert.equal(long.body.error, 'freeze_too_long');
    assert.equal((await p.call('POST', `/gyms/${p.gym.id}/freeze-requests`, p.member.token, { ...body, endsOn: '2026-11-01' })).status, 400);
    assert.equal((await p.call('POST', `/gyms/${p.gym.id}/freeze-requests`, p.member.token, { ...body, reason: '' })).status, 400);
  });
});

describe('member nudges', () => {
  it('admins nudge a member once per kind per gym day, with a push', async () => {
    const { app, call, gymWithMember, joinAs, pushes, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    await call('POST', '/me/devices', member.token, { token: 'ExponentPushToken[nudge1]', platform: 'android' });
    const url = `/gyms/${gym.id}/members/${member.userId}/nudge`;
    assert.equal((await call('POST', url, owner.token, { kind: 'renewal' })).status, 204);
    const again = await call('POST', url, owner.token, { kind: 'renewal', message: 'Please renew' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already_nudged');
    assert.equal((await call('POST', url, owner.token, { kind: 'inactive', message: 'We have new spin bikes!' })).status, 204);
    const notes = (await call('GET', `/gyms/${gym.id}/notifications`, member.token)).body.notifications;
    assert.deepEqual(notes.map((n: any) => [n.kind, n.link]), [
      ['system', null],
      ['membership_expiring', 'membership'],
    ]);
    assert.equal(notes[0].body, 'We have new spin bikes!');
    await app.flushPush();
    assert.equal(pushes.length, 2);

    clock.advance(DAY);
    assert.equal((await call('POST', url, owner.token, { kind: 'renewal' })).status, 204, 'a new gym day');
    assert.equal((await call('POST', url, owner.token, { kind: 'later' })).status, 400);
    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Trainer', 'trainer');
    assert.equal((await call('POST', url, trainer.token, { kind: 'renewal' })).status, 403);
    assert.equal((await call('POST', `/gyms/${gym.id}/members/nobody/nudge`, owner.token, { kind: 'renewal' })).status, 404);
  });
});
