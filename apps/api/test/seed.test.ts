import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seedDemo } from '../src/demo-seed';
import { setup } from './helpers';

describe('demo seed', () => {
  it('creates FLEX42 with data for every feature, idempotently', async () => {
    const { app, call, login, clock } = setup();
    const first = seedDemo(app.db, clock.now);
    assert.deepEqual([first.createdGym, first.addedContent, first.addedV03, first.recoloured], [true, true, true, false]);
    const again = seedDemo(app.db, clock.now);
    assert.deepEqual([again.createdGym, again.addedContent, again.addedV03, again.recoloured, again.gymId], [false, false, false, false, first.gymId]);

    const ravi = await login('+919999900002');
    const me = (await call('GET', '/me', ravi.token)).body;
    const gym = me.memberships[0].gym;
    assert.equal(gym.joinCode, 'FLEX42');
    assert.deepEqual([gym.branding.primaryColor, gym.branding.accentColor, gym.branding.themePreference], ['#6B0F1A', '#B54B6A', 'light']);
    // Ravi's demo login goes straight to Home.
    assert.equal(me.profile.setupComplete, true);
    assert.equal(me.consent.needsConsent, false);
    const g = `/gyms/${gym.id}`;

    // v0.3 demo data.
    const owner = await login('+919999900001');
    const coupons = (await call('GET', `${g}/coupons`, owner.token)).body.coupons;
    assert.deepEqual(coupons.map((c: any) => [c.code, c.kind, c.amount]), [['DIWALI20', 'percent', 20]]);
    assert.ok((await call('GET', `${g}/door-code`, owner.token)).body.token);
    const freezes = (await call('GET', `${g}/freeze-requests?status=pending`, owner.token)).body.requests;
    assert.equal(freezes.length, 1);
    assert.equal(freezes[0].member.name, 'Anita Desai');
    assert.ok(freezes[0].newEndsAt);
    assert.match((await call('GET', `${g}/referral`, ravi.token)).body.reward, /week free/);
    const yesterday = app.db
      .prepare("SELECT id FROM class_sessions WHERE gym_id = ? AND title = 'Evening Strength'")
      .get(gym.id) as { id: string };
    const attendees = (await call('GET', `${g}/classes/${yesterday.id}/attendees`, owner.token)).body.attendees;
    assert.deepEqual(attendees.map((a: any) => [a.name, a.attended]), [
      ['Ravi Kumar', true],
      ['Karan Mehta', true],
      ['Anita Desai', false],
    ]);
    const monthlyPlan = (await call('GET', `${g}/plans`, ravi.token)).body.plans[0];
    assert.equal((await call('POST', `${g}/coupons/quote`, ravi.token, { code: 'DIWALI20', planId: monthlyPlan.id })).body.discountPaise, 29980);

    const summary = (await call('GET', `${g}/me/summary`, ravi.token)).body;
    assert.equal(summary.recommendedRoutine.name, 'Fat-loss circuit');
    assert.equal(summary.recommendedRoutine.assignment.by.name, 'Coach Vikram');
    assert.equal(summary.activeChallenge.status, 'active');
    assert.ok(summary.activeChallenge.joined);
    assert.ok(summary.unreadNotifications >= 3);
    assert.equal(summary.membership.state, 'expiring');
    assert.equal(summary.nextClass.title, 'Morning Yoga');
    assert.ok(summary.badges.includes('first_workout') && summary.badges.includes('first_class'));

    const routines = (await call('GET', `${g}/routines`, ravi.token)).body;
    assert.deepEqual(routines.presets.map((r: any) => r.name), ['Beginner full body', 'Push day', 'Leg day']);
    assert.equal(routines.assigned.length, 1);
    const workouts = (await call('GET', `${g}/workouts`, ravi.token)).body.workouts;
    assert.ok(workouts.length >= 6);
    assert.equal((await call('GET', '/me/measurements', ravi.token)).body.measurements.length, 4);
    const progress = (await call('GET', `${g}/progress`, ravi.token)).body;
    assert.equal(progress.weight.length, 4);
    assert.ok(progress.personalBests.length > 0);

    const articles = (await call('GET', `${g}/articles`, ravi.token)).body.articles;
    assert.deepEqual(
      articles.reduce((acc: Record<string, number>, a: any) => ({ ...acc, [a.kind]: (acc[a.kind] ?? 0) + 1 }), {}),
      { article: 2, video: 1, tip: 2 },
    );
    assert.equal((await call('GET', `${g}/meal-plans`, ravi.token)).body.mealPlans.length, 2);
    assert.equal((await call('GET', `${g}/meal-ideas`, ravi.token)).body.mealIdeas.length, 4);
    const favs = (await call('GET', `${g}/favourites`, ravi.token)).body;
    assert.ok(favs.articles.length + favs.mealIdeas.length + favs.routines.length >= 3);

    const posts = (await call('GET', `${g}/posts`, ravi.token)).body.posts;
    assert.equal(posts.length, 4);
    assert.ok(posts.every((p: any) => p.likeCount > 0 && p.commentCount > 0));
    const challenges = (await call('GET', `${g}/challenges`, ravi.token)).body.challenges;
    assert.equal(challenges.length, 2);
    const monthly = challenges.find((c: any) => c.title === '30 check-ins in November');
    assert.deepEqual([monthly.metric, monthly.target, monthly.startsOn, monthly.endsOn, monthly.joined], ['checkins', 30, '2026-11-01', '2026-11-30', true]);
    const board = (await call('GET', `${g}/challenges/${monthly.id}/leaderboard`, ravi.token)).body.entries;
    assert.ok(board.some((e: any) => e.user.name === 'Member'), 'Sneha hides her stats');
    assert.ok(board.some((e: any) => e.isMe));

    const support = (await call('GET', `${g}/support`, ravi.token)).body;
    assert.equal(support.faqs.length, 5);
    const tickets = (await call('GET', `${g}/support/tickets`, ravi.token)).body.tickets;
    assert.deepEqual(tickets.map((t: any) => [t.status, t.messages.length]), [['answered', 2]]);
    const notes = (await call('GET', `${g}/notifications`, ravi.token)).body.notifications.map((n: any) => n.kind);
    for (const k of ['routine_assigned', 'challenge', 'support_reply', 'booking', 'membership_expiring']) assert.ok(notes.includes(k), k);

    assert.equal((await call('GET', `${g}/members/${ravi.userId}/workouts`, owner.token)).status, 200);
  });
});

describe('demo seed top-up', () => {
  it('switches an older demo gym to the new colours and adds the v0.3 layer once', async () => {
    const { app, clock } = setup();
    const first = seedDemo(app.db, clock.now);
    // Make it look like a database seeded before v0.3.
    app.db.prepare("UPDATE gyms SET primary_color = '#E11D48', accent_color = '#D97706', theme_pref = 'auto' WHERE id = ?").run(first.gymId);
    app.db.prepare('DELETE FROM coupons').run();
    const topUp = seedDemo(app.db, clock.now);
    assert.deepEqual([topUp.createdGym, topUp.addedContent, topUp.addedV03, topUp.recoloured], [false, false, true, true]);
    const gym = app.db.prepare('SELECT primary_color, accent_color, theme_pref FROM gyms WHERE id = ?').get(first.gymId) as any;
    assert.deepEqual({ ...gym }, { primary_color: '#6B0F1A', accent_color: '#B54B6A', theme_pref: 'light' });
    // A gym whose owner chose their own colours is left alone.
    app.db.prepare("UPDATE gyms SET primary_color = '#0B4F6C' WHERE id = ?").run(first.gymId);
    assert.equal(seedDemo(app.db, clock.now).recoloured, false);
  });
});
