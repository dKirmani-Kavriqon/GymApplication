import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, setup } from './helpers';

describe('check-in, streaks and badges', () => {
  it('first check-in returns streak 1 and the First Step badge; repeat same day is idempotent', async () => {
    const { call, gymWithMember } = setup();
    const { member, gym } = await gymWithMember();
    const first = await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    assert.equal(first.status, 201);
    assert.equal(first.body.alreadyCheckedIn, false);
    assert.deepEqual(first.body.streak, { current: 1, longest: 1 });
    assert.deepEqual(first.body.newBadges, ['first_checkin']);

    const again = await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadyCheckedIn, true);
    assert.equal(again.body.totalCheckIns, 1);
    assert.deepEqual(again.body.newBadges, []);
  });

  it('builds a streak over consecutive days and awards On a Roll on day 3', async () => {
    const { call, gymWithMember, clock } = setup();
    const { member, gym } = await gymWithMember();
    let last: any;
    for (let i = 0; i < 3; i++) {
      last = (await call('POST', `/gyms/${gym.id}/checkins`, member.token, {})).body;
      clock.advance(DAY);
    }
    assert.equal(last.streak.current, 3);
    assert.deepEqual(last.newBadges, ['streak_3']);
    clock.advance(DAY); // skipped a day
    const after = (await call('POST', `/gyms/${gym.id}/checkins`, member.token, {})).body;
    assert.deepEqual(after.streak, { current: 1, longest: 3 });
  });

  it('uses the gym time zone to decide which day a visit belongs to', async () => {
    const { call, gymWithMember, clock } = setup();
    const { member, gym } = await gymWithMember();
    clock.set('2026-11-08T17:00:00.000Z'); // 22:30 IST on the 8th
    await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    clock.set('2026-11-08T19:00:00.000Z'); // 00:30 IST on the 9th -> a new day
    const res = await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    assert.equal(res.body.alreadyCheckedIn, false);
    assert.equal(res.body.streak.current, 2);
  });

  it('home summary shows streak, membership, next class and latest announcement', async () => {
    const { call, gymWithMember, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const before = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.equal(before.checkedInToday, false);
    assert.equal(before.membership.state, 'none');
    assert.equal(before.nextClass, null);

    await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    const cls = (
      await call('POST', `/gyms/${gym.id}/classes`, owner.token, {
        title: 'Yoga',
        startsAt: new Date(clock.now.getTime() + 2 * 3600_000).toISOString(),
        durationMin: 45,
        capacity: 10,
      })
    ).body;
    await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, member.token);
    await call('POST', `/gyms/${gym.id}/announcements`, owner.token, { title: 'Welcome', body: 'Hello' });

    const s = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.equal(s.checkedInToday, true);
    assert.equal(s.streak.current, 1);
    assert.equal(s.nextClass.title, 'Yoga');
    assert.equal(s.nextClass.myStatus, 'booked');
    assert.equal(s.announcement.title, 'Welcome');
    assert.deepEqual(s.badges.sort(), ['first_checkin', 'first_class']);
    assert.equal(s.recentDays.length, 1);
  });
});

describe('class booking', () => {
  async function withClass(capacity: number) {
    const ctx = setup();
    const { owner, member, gym } = await ctx.gymWithMember();
    const cls = (
      await ctx.call('POST', `/gyms/${gym.id}/classes`, owner.token, {
        title: 'HIIT',
        trainerName: 'Vikram',
        startsAt: new Date(ctx.clock.now.getTime() + DAY).toISOString(),
        durationMin: 30,
        capacity,
      })
    ).body;
    return { ...ctx, owner, member, gym, cls };
  }

  it('books until full, then waitlists in order, and promotes on cancel', async () => {
    const { call, login, member, gym, cls, owner } = await withClass(1);
    const m2 = await login('+919222222222');
    const m3 = await login('+919333333333');
    await call('POST', '/gyms/join', m2.token, { code: gym.joinCode });
    await call('POST', '/gyms/join', m3.token, { code: gym.joinCode });

    const b1 = await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, member.token);
    assert.equal(b1.body.session.myStatus, 'booked');
    const b2 = await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, m2.token);
    assert.equal(b2.body.session.myStatus, 'waitlisted');
    assert.equal(b2.body.session.myWaitlistPosition, 1);
    const b3 = await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, m3.token);
    assert.equal(b3.body.session.myWaitlistPosition, 2);

    const cancel = await call('DELETE', `/gyms/${gym.id}/classes/${cls.id}/book`, member.token);
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.promotedUserId, m2.userId);
    assert.equal(cancel.body.session.myStatus, null);

    const list = (await call('GET', `/gyms/${gym.id}/classes`, m3.token)).body.classes;
    assert.equal(list[0].bookedCount, 1);
    assert.equal(list[0].waitlistCount, 1);
    assert.equal(list[0].myWaitlistPosition, 1);

    const attendees = await call('GET', `/gyms/${gym.id}/classes/${cls.id}/attendees`, owner.token);
    assert.deepEqual(attendees.body.attendees.map((a: any) => a.status), ['booked', 'waitlisted']);
    assert.equal((await call('GET', `/gyms/${gym.id}/classes/${cls.id}/attendees`, m3.token)).status, 403);
  });

  it('booking twice does not duplicate', async () => {
    const { call, member, gym, cls } = await withClass(5);
    await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, member.token);
    const again = await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, member.token);
    assert.equal(again.body.session.bookedCount, 1);
  });

  it('cannot book a class that has started', async () => {
    const { call, member, gym, cls, clock } = await withClass(5);
    clock.advance(DAY + 60_000);
    const res = await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, member.token);
    assert.equal(res.status, 409);
  });

  it('members cannot create classes; cancelling without a booking is a 404', async () => {
    const { call, member, gym, cls, clock } = await withClass(5);
    const res = await call('POST', `/gyms/${gym.id}/classes`, member.token, {
      title: 'Mine',
      startsAt: new Date(clock.now.getTime() + DAY).toISOString(),
      durationMin: 30,
      capacity: 5,
    });
    assert.equal(res.status, 403);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/classes/${cls.id}/book`, member.token)).status, 404);
  });
});

describe('membership payments', () => {
  async function withPlan() {
    const ctx = setup();
    const { owner, member, gym } = await ctx.gymWithMember();
    const plan = (
      await ctx.call('POST', `/gyms/${gym.id}/plans`, owner.token, { name: 'Monthly', durationDays: 30, pricePaise: 149900, benefits: ['Locker'] })
    ).body;
    return { ...ctx, owner, member, gym, plan };
  }

  it('pays for a plan and activates the membership with a receipt', async () => {
    const { call, member, gym, plan } = await withPlan();
    const plans = await call('GET', `/gyms/${gym.id}/plans`, member.token);
    assert.equal(plans.body.plans[0].pricePaise, 149900);

    const order = await call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id });
    assert.equal(order.status, 201);
    assert.equal(order.body.amountPaise, 149900);
    const paid = await call('POST', `/gyms/${gym.id}/payments/${order.body.paymentId}/verify`, member.token, {
      providerPaymentId: 'pay_1',
      signature: order.body.mockSignature,
    });
    assert.equal(paid.status, 200);
    assert.match(paid.body.receiptNumber, new RegExp(`^${gym.joinCode}-00001$`));

    const s = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.equal(s.membership.state, 'active');
    assert.equal(s.membership.daysLeft, 30);
    assert.equal(s.membership.planName, 'Monthly');

    // verifying again is idempotent
    const again = await call('POST', `/gyms/${gym.id}/payments/${order.body.paymentId}/verify`, member.token, {
      providerPaymentId: 'pay_1',
      signature: order.body.mockSignature,
    });
    assert.equal(again.body.receiptNumber, paid.body.receiptNumber);
    const history = await call('GET', `/gyms/${gym.id}/payments`, member.token);
    assert.equal(history.body.payments.length, 1);
    assert.equal(history.body.payments[0].status, 'paid');
  });

  it('renewing early extends from the current end date', async () => {
    const { call, member, gym, plan, clock } = await withPlan();
    const pay = async () => {
      const o = (await call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id })).body;
      return (await call('POST', `/gyms/${gym.id}/payments/${o.paymentId}/verify`, member.token, { providerPaymentId: 'p', signature: o.mockSignature }))
        .body;
    };
    await pay();
    clock.advance(25 * DAY);
    const s1 = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.equal(s1.membership.state, 'expiring');
    assert.equal(s1.membership.daysLeft, 5);
    await pay();
    const s2 = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.equal(s2.membership.daysLeft, 35);
  });

  it('rejects a forged signature and marks the payment failed', async () => {
    const { call, member, gym, plan } = await withPlan();
    const o = (await call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id })).body;
    const res = await call('POST', `/gyms/${gym.id}/payments/${o.paymentId}/verify`, member.token, { providerPaymentId: 'p', signature: 'forged' });
    assert.equal(res.status, 402);
    const s = (await call('GET', `/gyms/${gym.id}/me/summary`, member.token)).body;
    assert.equal(s.membership.state, 'none');
  });

  it('archived plans cannot be bought; members cannot create plans', async () => {
    const { call, owner, member, gym, plan } = await withPlan();
    assert.equal((await call('POST', `/gyms/${gym.id}/plans`, member.token, { name: 'Free', durationDays: 30, pricePaise: 0 })).status, 403);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/plans/${plan.id}`, owner.token)).status, 204);
    assert.equal((await call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id })).status, 404);
  });
});

describe('owner reports', () => {
  it('lists members with last visit and flags those at risk', async () => {
    const { call, gymWithMember, login, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const lazy = await login('+919444444444', 'Lazy Larry');
    await call('POST', '/gyms/join', lazy.token, { code: gym.joinCode });
    await call('POST', `/gyms/${gym.id}/checkins`, lazy.token, {});
    clock.advance(15 * DAY);
    await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});

    const res = await call('GET', `/gyms/${gym.id}/members`, owner.token);
    const byName = Object.fromEntries(res.body.members.map((m: any) => [m.name, m]));
    assert.equal(byName['Lazy Larry'].atRisk, true);
    assert.equal(byName['Member 1'].atRisk, false);
    assert.equal(byName['Owner 1'].atRisk, false, 'staff are never flagged');
    assert.equal(byName['Member 1'].totalCheckIns, 1);
    assert.equal((await call('GET', `/gyms/${gym.id}/members`, member.token)).status, 403);
  });

  it('reports daily attendance and peak hours', async () => {
    const { call, gymWithMember, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    clock.set('2026-11-07T01:30:00.000Z'); // 07:00 IST
    await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    await call('POST', `/gyms/${gym.id}/checkins`, owner.token, {});
    clock.set('2026-11-08T01:30:00.000Z');
    await call('POST', `/gyms/${gym.id}/checkins`, member.token, {});
    const r = (await call('GET', `/gyms/${gym.id}/reports/attendance`, owner.token)).body;
    assert.equal(r.days.length, 14);
    assert.deepEqual(r.days.slice(-2), [
      { day: '2026-11-07', count: 2 },
      { day: '2026-11-08', count: 1 },
    ]);
    assert.equal(r.today, 1);
    assert.equal(r.peakHours[7].count, 3);
    assert.equal(r.activeMembers, 2);
    assert.equal(r.totalMembers, 1);
  });
});
