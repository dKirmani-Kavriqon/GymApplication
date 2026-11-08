import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createJobs } from '../src/jobs';
import { DAY, setup } from './helpers';

const MIN = 60_000;

describe('background jobs', () => {
  it('sends a class reminder once, an hour before, to booked members who want them', async () => {
    const { app, call, gymWithMember, joinAs, clock, pushes } = setup();
    const { owner, member, gym } = await gymWithMember();
    const quiet = await joinAs(gym, owner.token, '+919800000031', 'Quiet Quinn');
    const waiter = await joinAs(gym, owner.token, '+919800000032', 'Waiting Wes');
    await call('PATCH', '/me/profile', quiet.token, { notifyClassReminders: false });
    await call('POST', '/me/devices', member.token, { token: 'ExponentPushToken[rem1]', platform: 'ios' });
    const cls = (
      await call('POST', `/gyms/${gym.id}/classes`, owner.token, {
        title: 'Spin',
        startsAt: new Date(clock.now.getTime() + 90 * MIN).toISOString(),
        durationMin: 45,
        capacity: 2,
      })
    ).body;
    for (const p of [member, quiet, waiter]) await call('POST', `/gyms/${gym.id}/classes/${cls.id}/book`, p.token);
    await app.flushPush();
    pushes.length = 0;
    const jobs = createJobs(app.ctx);

    assert.equal(jobs.classReminders(clock.now), 0, '90 minutes out: too early');
    clock.advance(30 * MIN);
    assert.equal(jobs.classReminders(clock.now), 1, 'only the booked member who wants reminders');
    clock.advance(5 * MIN);
    assert.equal(jobs.classReminders(clock.now), 0, 'once per class per member');
    const notes = (await call('GET', `/gyms/${gym.id}/notifications`, member.token)).body.notifications;
    assert.equal(notes[0].title, 'Spin starts in an hour');
    assert.equal(notes[0].kind, 'class_reminder');
    assert.equal(notes[0].link, 'classes');
    assert.equal((await call('GET', `/gyms/${gym.id}/notifications`, waiter.token)).body.notifications[0].title, 'You are on the waitlist');
    await app.flushPush();
    assert.deepEqual(pushes.map((p) => p.title), ['Spin starts in an hour']);
  });

  it('sends membership expiry reminders at most once a day while 3 days or fewer remain', async () => {
    const { app, call, gymWithMember, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const plan = (await call('POST', `/gyms/${gym.id}/plans`, owner.token, { name: 'Week', durationDays: 5, pricePaise: 100 })).body;
    const o = (await call('POST', `/gyms/${gym.id}/payments/orders`, member.token, { planId: plan.id })).body;
    await call('POST', `/gyms/${gym.id}/payments/${o.paymentId}/verify`, member.token, { providerPaymentId: 'p', signature: o.mockSignature });
    const jobs = createJobs(app.ctx);
    assert.equal(jobs.expiryReminders(clock.now), 0, '5 days left');
    clock.advance(2 * DAY);
    assert.equal(jobs.expiryReminders(clock.now), 1);
    assert.equal(jobs.expiryReminders(clock.now), 0, 'same day');
    clock.advance(DAY);
    assert.equal(jobs.expiryReminders(clock.now), 1, 'next day');
    clock.advance(DAY);
    const reminders = (app.db.prepare("SELECT title FROM notifications WHERE kind = 'membership_expiring' AND dedupe_key LIKE 'membership_reminder:%'").all() as any[]).map((r) => r.title);
    assert.deepEqual(reminders, ['Your membership ends in 3 days', 'Your membership ends in 2 days']);
    assert.equal(jobs.expiryReminders(clock.now), 1);
    assert.equal((app.db.prepare("SELECT title FROM notifications WHERE dedupe_key LIKE 'membership_reminder:%' ORDER BY rowid DESC LIMIT 1").get() as any).title, 'Your membership ends tomorrow');
    // Suspended gyms get no reminders.
    app.db.prepare('UPDATE gyms SET suspended = 1 WHERE id = ?').run(gym.id);
    clock.advance(12 * 3600_000);
    assert.equal(jobs.expiryReminders(clock.now), 0);
  });

  it('prunes old OTP rows and schedules work by the gym clock', async () => {
    const { app, call, clock, gymWithMember } = setup();
    await gymWithMember();
    const otps = () => (app.db.prepare('SELECT COUNT(*) AS n FROM otp_codes').get() as { n: number }).n;
    const before = otps();
    assert.ok(before > 0);
    const jobs = createJobs(app.ctx);
    assert.equal(jobs.pruneOtps(clock.now), 0);
    clock.advance(8 * DAY);
    await call('POST', '/auth/otp/request', undefined, { phone: '+919800000041' });
    assert.equal(jobs.pruneOtps(clock.now), before);
    assert.equal(otps(), 1);

    // tick(): expiry reminders only in the gym's 09:00 hour; pruning at most daily; errors are contained.
    const gym = (app.db.prepare('SELECT id FROM gyms LIMIT 1').get() as { id: string }).id;
    const member = (app.db.prepare("SELECT user_id FROM gym_members WHERE gym_id = ? AND role = 'member'").get(gym) as { user_id: string }).user_id;
    const planId = 'plan-tick';
    app.db.prepare("INSERT INTO plans (id, gym_id, name, duration_days, price_paise, benefits, created_at) VALUES (?, ?, 'P', 30, 1, '[]', 'x')").run(planId, gym);
    app.db
      .prepare("INSERT INTO subscriptions (id, gym_id, user_id, plan_id, starts_at, ends_at, created_at) VALUES ('s1', ?, ?, ?, 'x', ?, 'x')")
      .run(gym, member, planId, new Date(clock.now.getTime() + 2 * DAY).toISOString());
    const reminders = () => (app.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE dedupe_key LIKE 'membership_reminder:%'").get() as { n: number }).n;
    clock.set('2026-11-16T01:30:00.000Z'); // 07:00 IST
    app.db.prepare("UPDATE subscriptions SET ends_at = ? WHERE id = 's1'").run(new Date(clock.now.getTime() + 2 * DAY).toISOString());
    jobs.tick(clock.now);
    assert.equal(reminders(), 0);
    clock.set('2026-11-16T03:45:00.000Z'); // 09:15 IST
    jobs.tick(clock.now);
    assert.equal(reminders(), 1);
    jobs.tick(clock.now);
    assert.equal(reminders(), 1);

    const broken = createJobs({ ...app.ctx, db: { prepare: () => { throw new Error('db gone'); } } as never });
    assert.doesNotThrow(() => broken.tick(clock.now));
    jobs.start(60 * 60_000);
    jobs.start(60 * 60_000); // second start is a no-op
    jobs.stop();
    jobs.stop();
  });
});
