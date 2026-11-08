/**
 * PRD §13: "Data leaks between gyms — mitigated by automated tenant-isolation tests".
 * Two gyms, A and B. Every attempt by A's people to read or touch B's data must fail,
 * including when they use a B resource id under their own gym's URL.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, setup } from './helpers';

async function twoGyms() {
  const ctx = setup();
  const a = await ctx.gymWithMember('1');
  const b = await ctx.gymWithMember('2');
  const bClass = (
    await ctx.call('POST', `/gyms/${b.gym.id}/classes`, b.owner.token, {
      title: 'B only',
      startsAt: new Date(ctx.clock.now.getTime() + DAY).toISOString(),
      durationMin: 30,
      capacity: 5,
    })
  ).body;
  const bPlan = (await ctx.call('POST', `/gyms/${b.gym.id}/plans`, b.owner.token, { name: 'B plan', durationDays: 30, pricePaise: 100 })).body;
  await ctx.call('POST', `/gyms/${b.gym.id}/announcements`, b.owner.token, { title: 'B secret', body: 'for B only' });
  await ctx.call('POST', `/gyms/${b.gym.id}/checkins`, b.member.token, {});
  const bOrder = (await ctx.call('POST', `/gyms/${b.gym.id}/payments/orders`, b.member.token, { planId: bPlan.id })).body;
  return { ...ctx, a, b, bClass, bPlan, bOrder };
}

describe('tenant isolation', () => {
  it("A's owner and member get 404 on every B gym route", async () => {
    const { call, a, b, bClass, bOrder } = await twoGyms();
    const routes: Array<[string, string, unknown?]> = [
      ['GET', `/gyms/${b.gym.id}`],
      ['GET', `/gyms/${b.gym.id}/me/summary`],
      ['GET', `/gyms/${b.gym.id}/classes`],
      ['GET', `/gyms/${b.gym.id}/plans`],
      ['GET', `/gyms/${b.gym.id}/announcements`],
      ['GET', `/gyms/${b.gym.id}/members`],
      ['GET', `/gyms/${b.gym.id}/reports/attendance`],
      ['GET', `/gyms/${b.gym.id}/payments`],
      ['GET', `/gyms/${b.gym.id}/classes/${bClass.id}/attendees`],
      ['POST', `/gyms/${b.gym.id}/checkins`, {}],
      ['POST', `/gyms/${b.gym.id}/classes/${bClass.id}/book`],
      ['POST', `/gyms/${b.gym.id}/announcements`, { title: 'hack', body: 'x' }],
      ['POST', `/gyms/${b.gym.id}/members/import`, { rows: [{ phone: '+919555555555' }] }],
      ['PATCH', `/gyms/${b.gym.id}/branding`, { gymName: 'Hacked', primaryColor: '#000000', accentColor: '#000000', themePreference: 'auto' }],
      ['PATCH', `/gyms/${b.gym.id}/members/${b.member.userId}`, { role: 'owner' }],
      ['POST', `/gyms/${b.gym.id}/payments/${bOrder.paymentId}/verify`, { providerPaymentId: 'x', signature: bOrder.mockSignature }],
    ];
    for (const who of [a.owner, a.member]) {
      for (const [method, url, body] of routes) {
        const res = await call(method, url, who.token, body);
        assert.equal(res.status, 404, `${method} ${url} should be 404 but was ${res.status}`);
      }
    }
  });

  it("B resource ids are not reachable through A's gym path", async () => {
    const { call, a, b, bClass, bPlan, bOrder } = await twoGyms();
    const book = await call('POST', `/gyms/${a.gym.id}/classes/${bClass.id}/book`, a.member.token);
    assert.equal(book.status, 404);
    const attendees = await call('GET', `/gyms/${a.gym.id}/classes/${bClass.id}/attendees`, a.owner.token);
    assert.equal(attendees.status, 404);
    const del = await call('DELETE', `/gyms/${a.gym.id}/classes/${bClass.id}`, a.owner.token);
    assert.equal(del.status, 404);
    const order = await call('POST', `/gyms/${a.gym.id}/payments/orders`, a.member.token, { planId: bPlan.id });
    assert.equal(order.status, 404);
    const archive = await call('DELETE', `/gyms/${a.gym.id}/plans/${bPlan.id}`, a.owner.token);
    assert.equal(archive.status, 404);
    const verify = await call('POST', `/gyms/${a.gym.id}/payments/${bOrder.paymentId}/verify`, a.member.token, {
      providerPaymentId: 'x',
      signature: bOrder.mockSignature,
    });
    assert.equal(verify.status, 404);
    const role = await call('PATCH', `/gyms/${a.gym.id}/members/${b.member.userId}`, a.owner.token, { role: 'trainer' });
    assert.equal(role.status, 404);
    const remove = await call('DELETE', `/gyms/${a.gym.id}/members/${b.member.userId}`, a.owner.token);
    assert.equal(remove.status, 404);
  });

  it("A's lists never contain B's data", async () => {
    const { call, a, b } = await twoGyms();
    const ann = (await call('GET', `/gyms/${a.gym.id}/announcements`, a.member.token)).body.announcements;
    assert.equal(ann.length, 0);
    const classes = (await call('GET', `/gyms/${a.gym.id}/classes`, a.member.token)).body.classes;
    assert.equal(classes.length, 0);
    const plans = (await call('GET', `/gyms/${a.gym.id}/plans`, a.member.token)).body.plans;
    assert.equal(plans.length, 0);
    const members = (await call('GET', `/gyms/${a.gym.id}/members`, a.owner.token)).body.members;
    assert.ok(members.every((m: any) => m.userId !== b.member.userId && m.userId !== b.owner.userId));
    const report = (await call('GET', `/gyms/${a.gym.id}/reports/attendance`, a.owner.token)).body;
    assert.equal(report.days.reduce((s: number, d: any) => s + d.count, 0), 0);
  });

  it('streaks and badges are per gym for someone in both gyms', async () => {
    const { call, a, b } = await twoGyms();
    await call('POST', '/gyms/join', b.member.token, { code: a.gym.joinCode });
    const inA = (await call('GET', `/gyms/${a.gym.id}/me/summary`, b.member.token)).body;
    assert.equal(inA.totalCheckIns, 0);
    assert.deepEqual(inA.badges, []);
    const inB = (await call('GET', `/gyms/${b.gym.id}/me/summary`, b.member.token)).body;
    assert.equal(inB.totalCheckIns, 1);
  });
});

// ---------- v0.2 features ----------

async function twoGymsV2() {
  const ctx = await twoGyms();
  const { call, b, clock } = ctx;
  const B = `/gyms/${b.gym.id}`;
  const bExercise = (await call('POST', `${B}/exercises`, b.owner.token, { name: 'B only press', muscleGroup: 'chest', equipment: 'machine' })).body;
  const bPreset = (
    await call('POST', `${B}/routines`, b.owner.token, {
      name: 'B only routine',
      kind: 'preset',
      exercises: [{ exerciseId: bExercise.id, sets: 3, reps: 10 }],
    })
  ).body;
  const bCustom = (
    await call('POST', `${B}/routines`, b.member.token, { name: 'B only custom', exercises: [{ exerciseId: 'ex_push_up', sets: 3, reps: 10 }] })
  ).body;
  await call('POST', `${B}/routines/${bPreset.id}/assign`, b.owner.token, { userId: b.member.userId });
  await call('POST', `${B}/workouts`, b.member.token, {
    routineId: bPreset.id,
    startedAt: new Date(clock.now.getTime() - 3600_000).toISOString(),
    completedAt: clock.now.toISOString(),
    sets: [{ exerciseId: bExercise.id, reps: 10, weightKg: 40 }],
  });
  const bArticle = (await call('POST', `${B}/articles`, b.owner.token, { kind: 'article', title: 'B only article', tags: ['bsecret'] })).body;
  const bIdea = (await call('POST', `${B}/meal-ideas`, b.owner.token, { title: 'B only idea', mealType: 'lunch', calories: 400, proteinG: 20 })).body;
  const bMealPlan = (
    await call('POST', `${B}/meal-plans`, b.owner.token, {
      title: 'B only plan',
      caloriesPerDay: 2000,
      meals: [{ slot: 'lunch', title: 'Thali', calories: 700, proteinG: 25 }],
    })
  ).body;
  for (const [kind, id] of [
    ['article', bArticle.id],
    ['routine', bPreset.id],
    ['meal_idea', bIdea.id],
    ['meal_plan', bMealPlan.id],
  ]) {
    await call('PUT', `${B}/favourites/${kind}/${id}`, b.member.token);
  }
  const bPost = (await call('POST', `${B}/posts`, b.member.token, { body: 'B only post' })).body;
  const bComment = (await call('POST', `${B}/posts/${bPost.id}/comments`, b.owner.token, { body: 'B only comment' })).body;
  await call('PUT', `${B}/posts/${bPost.id}/like`, b.owner.token);
  const bChallenge = (
    await call('POST', `${B}/challenges`, b.owner.token, {
      title: 'B only challenge',
      metric: 'checkins',
      target: 5,
      startsOn: '2026-11-01',
      endsOn: '2026-11-30',
    })
  ).body;
  await call('PUT', `${B}/challenges/${bChallenge.id}/join`, b.member.token);
  await call('PUT', `${B}/support`, b.owner.token, { phone: '+91 1111 222', faqs: [{ q: 'B only question', a: 'B only answer' }] });
  const bTicket = (await call('POST', `${B}/support/tickets`, b.member.token, { subject: 'B only ticket', message: 'help' })).body;
  await call('POST', `${B}/support/tickets/${bTicket.id}/messages`, b.owner.token, { body: 'B only reply' });
  await call('POST', '/me/measurements', b.member.token, { measuredOn: '2026-11-01', weightKg: 70 });
  const bNotifications = (await call('GET', `${B}/notifications`, b.member.token)).body.notifications;
  assert.ok(bNotifications.length >= 3, 'fixture: B member has notifications');
  return { ...ctx, bExercise, bPreset, bCustom, bArticle, bIdea, bMealPlan, bPost, bComment, bChallenge, bTicket, bNotifications };
}

describe('tenant isolation: v0.2 features', () => {
  it("A's owner and member get 404 on every new B gym route", async () => {
    const f = await twoGymsV2();
    const { call, a, b } = f;
    const B = `/gyms/${b.gym.id}`;
    const routine = { name: 'Hack', exercises: [{ exerciseId: 'ex_push_up', sets: 1, reps: 1 }] };
    const now = f.clock.now.toISOString();
    const workout = { startedAt: now, completedAt: now, sets: [{ exerciseId: 'ex_push_up', reps: 1 }] };
    const routes: Array<[string, string, unknown?]> = [
      ['GET', `${B}/exercises`],
      ['POST', `${B}/exercises`, { name: 'Hack', muscleGroup: 'chest', equipment: 'none' }],
      ['GET', `${B}/routines`],
      ['GET', `${B}/routines/${f.bPreset.id}`],
      ['POST', `${B}/routines`, routine],
      ['PATCH', `${B}/routines/${f.bPreset.id}`, routine],
      ['DELETE', `${B}/routines/${f.bPreset.id}`],
      ['POST', `${B}/routines/${f.bPreset.id}/assign`, { userId: a.member.userId }],
      ['GET', `${B}/members/${b.member.userId}/workouts`],
      ['POST', `${B}/workouts`, workout],
      ['GET', `${B}/workouts`],
      ['GET', `${B}/progress`],
      ['GET', `${B}/articles`],
      ['GET', `${B}/articles/${f.bArticle.id}`],
      ['POST', `${B}/articles`, { kind: 'tip', title: 'Hack' }],
      ['PATCH', `${B}/articles/${f.bArticle.id}`, { kind: 'tip', title: 'Hack' }],
      ['DELETE', `${B}/articles/${f.bArticle.id}`],
      ['GET', `${B}/favourites`],
      ['PUT', `${B}/favourites/article/${f.bArticle.id}`],
      ['DELETE', `${B}/favourites/article/${f.bArticle.id}`],
      ['GET', `${B}/meal-plans`],
      ['GET', `${B}/meal-plans/${f.bMealPlan.id}`],
      ['POST', `${B}/meal-plans`, { title: 'Hack', caloriesPerDay: 2000, meals: [{ slot: 'lunch', title: 'x x', calories: 1, proteinG: 1 }] }],
      ['DELETE', `${B}/meal-plans/${f.bMealPlan.id}`],
      ['GET', `${B}/meal-ideas`],
      ['GET', `${B}/meal-ideas/${f.bIdea.id}`],
      ['POST', `${B}/meal-ideas`, { title: 'Hack', mealType: 'lunch', calories: 1, proteinG: 1 }],
      ['DELETE', `${B}/meal-ideas/${f.bIdea.id}`],
      ['GET', `${B}/posts`],
      ['POST', `${B}/posts`, { body: 'hack' }],
      ['PATCH', `${B}/posts/${f.bPost.id}`, { hidden: true }],
      ['DELETE', `${B}/posts/${f.bPost.id}`],
      ['PUT', `${B}/posts/${f.bPost.id}/like`],
      ['DELETE', `${B}/posts/${f.bPost.id}/like`],
      ['GET', `${B}/posts/${f.bPost.id}/comments`],
      ['POST', `${B}/posts/${f.bPost.id}/comments`, { body: 'hack' }],
      ['DELETE', `${B}/comments/${f.bComment.id}`],
      ['GET', `${B}/challenges`],
      ['POST', `${B}/challenges`, { title: 'Hack', metric: 'checkins', target: 1, startsOn: '2026-11-01', endsOn: '2026-11-02' }],
      ['DELETE', `${B}/challenges/${f.bChallenge.id}`],
      ['PUT', `${B}/challenges/${f.bChallenge.id}/join`],
      ['DELETE', `${B}/challenges/${f.bChallenge.id}/join`],
      ['GET', `${B}/challenges/${f.bChallenge.id}/leaderboard`],
      ['GET', `${B}/notifications`],
      ['POST', `${B}/notifications/read`, {}],
      ['GET', `${B}/support`],
      ['PUT', `${B}/support`, { phone: 'hack' }],
      ['GET', `${B}/support/tickets`],
      ['POST', `${B}/support/tickets`, { subject: 'Hack', message: 'x' }],
      ['GET', `${B}/support/tickets/${f.bTicket.id}`],
      ['POST', `${B}/support/tickets/${f.bTicket.id}/messages`, { body: 'hack' }],
      ['PATCH', `${B}/support/tickets/${f.bTicket.id}`, { status: 'closed' }],
      ['GET', `${B}/search?q=only`],
    ];
    for (const who of [a.owner, a.member]) {
      for (const [method, url, body] of routes) {
        const res = await call(method, url, who.token, body);
        assert.equal(res.status, 404, `${method} ${url} should be 404 but was ${res.status}`);
      }
    }
    // Nothing above changed B's data.
    assert.equal((await call('GET', `${B}/posts`, b.member.token)).body.posts[0].likeCount, 1);
    assert.equal((await call('GET', `${B}/support/tickets/${f.bTicket.id}`, b.member.token)).body.status, 'answered');
    assert.equal((await call('GET', `${B}/routines`, b.member.token)).body.presets.length, 1);
    assert.equal((await call('GET', `${B}/articles`, b.member.token)).body.articles.length, 1);
  });

  it("B resource ids are not reachable through A's gym path", async () => {
    const f = await twoGymsV2();
    const { call, a, b, clock } = f;
    const A = `/gyms/${a.gym.id}`;
    const aPreset = (
      await call('POST', `${A}/routines`, a.owner.token, { name: 'A preset', kind: 'preset', exercises: [{ exerciseId: 'ex_push_up', sets: 3, reps: 10 }] })
    ).body;
    const aPost = (await call('POST', `${A}/posts`, a.member.token, { body: 'A post' })).body;
    const expect404 = async (method: string, url: string, token: string, body?: unknown) => {
      const res = await call(method, url, token, body);
      assert.equal(res.status, 404, `${method} ${url} should be 404 but was ${res.status}`);
    };
    const now = clock.now.toISOString();

    // Workouts: another gym's routines, exercises and members (including assigning across gyms).
    await expect404('GET', `${A}/routines/${f.bPreset.id}`, a.owner.token);
    await expect404('GET', `${A}/routines/${f.bCustom.id}`, a.owner.token);
    await expect404('PATCH', `${A}/routines/${f.bPreset.id}`, a.owner.token, { name: 'Hack', exercises: [{ exerciseId: 'ex_push_up', sets: 1, reps: 1 }] });
    await expect404('DELETE', `${A}/routines/${f.bPreset.id}`, a.owner.token);
    await expect404('POST', `${A}/routines/${f.bPreset.id}/assign`, a.owner.token, { userId: a.member.userId });
    await expect404('POST', `${A}/routines/${aPreset.id}/assign`, a.owner.token, { userId: b.member.userId });
    await expect404('GET', `${A}/members/${b.member.userId}/workouts`, a.owner.token);
    await expect404('POST', `${A}/routines`, a.member.token, { name: 'Steal', exercises: [{ exerciseId: f.bExercise.id, sets: 1, reps: 1 }] });
    await expect404('POST', `${A}/workouts`, a.member.token, { startedAt: now, completedAt: now, sets: [{ exerciseId: f.bExercise.id, reps: 1 }] });
    await expect404('POST', `${A}/workouts`, a.member.token, {
      routineId: f.bPreset.id,
      startedAt: now,
      completedAt: now,
      sets: [{ exerciseId: 'ex_push_up', reps: 1 }],
    });

    // Resources, nutrition and favourites.
    await expect404('GET', `${A}/articles/${f.bArticle.id}`, a.member.token);
    await expect404('PATCH', `${A}/articles/${f.bArticle.id}`, a.owner.token, { kind: 'tip', title: 'Hack' });
    await expect404('DELETE', `${A}/articles/${f.bArticle.id}`, a.owner.token);
    await expect404('GET', `${A}/meal-plans/${f.bMealPlan.id}`, a.member.token);
    await expect404('DELETE', `${A}/meal-plans/${f.bMealPlan.id}`, a.owner.token);
    await expect404('GET', `${A}/meal-ideas/${f.bIdea.id}`, a.member.token);
    await expect404('DELETE', `${A}/meal-ideas/${f.bIdea.id}`, a.owner.token);
    for (const [kind, id] of [
      ['article', f.bArticle.id],
      ['routine', f.bPreset.id],
      ['meal_idea', f.bIdea.id],
      ['meal_plan', f.bMealPlan.id],
    ]) {
      await expect404('PUT', `${A}/favourites/${kind}/${id}`, a.member.token);
      await expect404('DELETE', `${A}/favourites/${kind}/${id}`, a.member.token);
    }

    // Community.
    await expect404('GET', `${A}/posts/${f.bPost.id}/comments`, a.member.token);
    await expect404('POST', `${A}/posts/${f.bPost.id}/comments`, a.member.token, { body: 'hi from A' });
    await expect404('PUT', `${A}/posts/${f.bPost.id}/like`, a.member.token);
    await expect404('PATCH', `${A}/posts/${f.bPost.id}`, a.owner.token, { hidden: true });
    await expect404('DELETE', `${A}/posts/${f.bPost.id}`, a.owner.token);
    await expect404('DELETE', `${A}/comments/${f.bComment.id}`, a.owner.token);
    await expect404('PUT', `${A}/challenges/${f.bChallenge.id}/join`, a.member.token);
    await expect404('DELETE', `${A}/challenges/${f.bChallenge.id}/join`, a.member.token);
    await expect404('GET', `${A}/challenges/${f.bChallenge.id}/leaderboard`, a.member.token);
    await expect404('DELETE', `${A}/challenges/${f.bChallenge.id}`, a.owner.token);

    // Support: even A's staff cannot read B's ticket.
    await expect404('GET', `${A}/support/tickets/${f.bTicket.id}`, a.owner.token);
    await expect404('POST', `${A}/support/tickets/${f.bTicket.id}/messages`, a.owner.token, { body: 'hi' });
    await expect404('PATCH', `${A}/support/tickets/${f.bTicket.id}`, a.owner.token, { status: 'closed' });

    // Marking B's notification ids as read through A does nothing.
    const before = (await call('GET', `/gyms/${b.gym.id}/notifications`, b.member.token)).body.unread;
    await call('POST', `${A}/notifications/read`, a.member.token, { ids: f.bNotifications.map((n: any) => n.id) });
    assert.equal((await call('GET', `/gyms/${b.gym.id}/notifications`, b.member.token)).body.unread, before);

    // And the other way round: A's post is not reachable through B's path.
    await expect404('POST', `/gyms/${b.gym.id}/posts/${aPost.id}/comments`, b.member.token, { body: 'x' });
  });

  it("A's lists never contain B's data", async () => {
    const f = await twoGymsV2();
    const { call, a, b } = f;
    const A = `/gyms/${a.gym.id}`;
    const exercises = (await call('GET', `${A}/exercises`, a.member.token)).body.exercises;
    assert.ok(exercises.every((e: any) => e.id !== f.bExercise.id && e.builtIn));
    assert.deepEqual((await call('GET', `${A}/routines`, a.owner.token)).body, { assigned: [], presets: [], mine: [] });
    assert.deepEqual((await call('GET', `${A}/workouts`, a.member.token)).body.workouts, []);
    assert.equal((await call('GET', `${A}/progress`, a.member.token)).body.totalWorkouts, 0);
    assert.deepEqual((await call('GET', `${A}/articles`, a.member.token)).body.articles, []);
    assert.deepEqual((await call('GET', `${A}/meal-plans`, a.member.token)).body.mealPlans, []);
    assert.deepEqual((await call('GET', `${A}/meal-ideas`, a.member.token)).body.mealIdeas, []);
    assert.deepEqual((await call('GET', `${A}/favourites`, a.member.token)).body, { articles: [], routines: [], mealIdeas: [], mealPlans: [] });
    assert.deepEqual((await call('GET', `${A}/posts`, a.owner.token)).body.posts, []);
    assert.deepEqual((await call('GET', `${A}/challenges`, a.member.token)).body.challenges, []);
    assert.deepEqual((await call('GET', `${A}/notifications`, a.member.token)).body, { notifications: [], unread: 0 });
    assert.deepEqual((await call('GET', `${A}/support/tickets`, a.owner.token)).body.tickets, []);
    assert.deepEqual((await call('GET', `${A}/support`, a.member.token)).body.faqs, []);
    const search = (await call('GET', `${A}/search?q=only`, a.member.token)).body;
    assert.deepEqual([search.classes, search.routines, search.exercises, search.articles, search.mealIdeas], [[], [], [], [], []]);
    assert.deepEqual((await call('GET', `${A}/search?q=bsecret`, a.member.token)).body.articles, []);
    assert.deepEqual((await call('GET', `${A}/search?q=owner`, a.member.token)).body.trainers.map((t: any) => t.name), ['Owner 1']);
    const summary = (await call('GET', `${A}/me/summary`, a.member.token)).body;
    assert.deepEqual([summary.activeChallenge, summary.recommendedRoutine, summary.unreadNotifications], [null, null, 0]);

    // Someone in both gyms: their B workouts, favourites, notifications and tickets stay in B.
    await call('POST', '/gyms/join', b.member.token, { code: a.gym.joinCode });
    assert.deepEqual((await call('GET', `${A}/workouts`, b.member.token)).body.workouts, []);
    assert.deepEqual((await call('GET', `${A}/favourites`, b.member.token)).body, { articles: [], routines: [], mealIdeas: [], mealPlans: [] });
    assert.deepEqual((await call('GET', `${A}/routines`, b.member.token)).body.assigned, []);
    assert.deepEqual((await call('GET', `${A}/notifications`, b.member.token)).body.notifications, []);
    assert.deepEqual((await call('GET', `${A}/support/tickets`, b.member.token)).body.tickets, []);
    const inA = (await call('GET', `${A}/me/summary`, b.member.token)).body;
    assert.deepEqual(inA.badges, []);
    assert.equal(inA.activeChallenge, null);
    // Measurements are personal and follow the person.
    assert.equal((await call('GET', '/me/measurements', b.member.token)).body.measurements.length, 1);
  });
});

// ---------- v0.3 features ----------

async function twoGymsV3() {
  const ctx = await twoGyms();
  const { call, b, bClass, bPlan } = ctx;
  const B = `/gyms/${b.gym.id}`;
  const bCoupon = (await call('POST', `${B}/coupons`, b.owner.token, { code: 'BONLY', kind: 'percent', amount: 10 })).body;
  const bDoor = (await call('GET', `${B}/door-code`, b.owner.token)).body;
  await call('POST', `${B}/classes/${bClass.id}/book`, b.member.token);
  await call('PUT', `${B}/referral`, b.owner.token, { reward: 'B only reward' });
  // B's member pays and asks for a freeze.
  const o = (await call('POST', `${B}/payments/orders`, b.member.token, { planId: bPlan.id, couponCode: 'BONLY' })).body;
  await call('POST', `${B}/payments/${o.paymentId}/verify`, b.member.token, { providerPaymentId: 'p', signature: o.mockSignature });
  const bFreeze = (await call('POST', `${B}/freeze-requests`, b.member.token, { startsOn: '2026-11-20', endsOn: '2026-11-25', reason: 'B only trip' })).body;
  const bPost = (await call('POST', `${B}/posts`, b.member.token, { body: 'B only post' })).body;
  const bChallenge = (
    await call('POST', `${B}/challenges`, b.owner.token, { title: 'B only', metric: 'checkins', target: 5, startsOn: '2026-11-01', endsOn: '2026-11-30' })
  ).body;
  return { ...ctx, bCoupon, bDoor, bFreeze, bPost, bChallenge };
}

describe('tenant isolation: v0.3 features', () => {
  it("A's owner and member get 404 on every new B gym route", async () => {
    const f = await twoGymsV3();
    const { call, a, b } = f;
    const B = `/gyms/${b.gym.id}`;
    const routes: Array<[string, string, unknown?]> = [
      ['GET', `${B}/coupons`],
      ['POST', `${B}/coupons`, { code: 'HACK', kind: 'flat', amount: 1 }],
      ['PATCH', `${B}/coupons/${f.bCoupon.id}`, { active: false }],
      ['POST', `${B}/coupons/quote`, { code: 'BONLY', planId: f.bPlan.id }],
      ['PUT', `${B}/classes/${f.bClass.id}/attendees/${b.member.userId}`, { attended: true }],
      ['GET', `${B}/trainer/today`],
      ['GET', `${B}/door-code`],
      ['POST', `${B}/door-code/rotate`],
      ['POST', `${B}/checkins`, { method: 'qr', doorToken: f.bDoor.token }],
      ['GET', `${B}/referral`],
      ['PUT', `${B}/referral`, { reward: 'hack' }],
      ['GET', `${B}/reports/revenue`],
      ['GET', `${B}/freeze-requests`],
      ['POST', `${B}/freeze-requests`, { startsOn: '2026-11-20', endsOn: '2026-11-21', reason: 'hack' }],
      ['PATCH', `${B}/freeze-requests/${f.bFreeze.id}`, { status: 'approved' }],
      ['POST', `${B}/members/${b.member.userId}/nudge`, { kind: 'renewal' }],
      ['GET', `${B}/posts/${f.bPost.id}`],
      ['GET', `${B}/challenges/${f.bChallenge.id}`],
    ];
    for (const who of [a.owner, a.member]) {
      for (const [method, url, body] of routes) {
        const res = await call(method, url, who.token, body);
        assert.equal(res.status, 404, `${method} ${url} should be 404 but was ${res.status}`);
      }
    }
    // Nothing changed in B.
    assert.equal((await call('GET', `${B}/coupons`, b.owner.token)).body.coupons[0].active, true);
    assert.equal((await call('GET', `${B}/freeze-requests`, b.owner.token)).body.requests[0].status, 'pending');
    assert.equal((await call('GET', `${B}/door-code`, b.owner.token)).body.token, f.bDoor.token);
  });

  it("B resource ids, codes and tokens do not work through A's gym path", async () => {
    const f = await twoGymsV3();
    const { call, a, b, login } = f;
    const A = `/gyms/${a.gym.id}`;
    const aPlan = (await call('POST', `${A}/plans`, a.owner.token, { name: 'A plan', durationDays: 30, pricePaise: 100 })).body;
    const expect = async (status: number, method: string, url: string, token: string, body?: unknown) => {
      const res = await call(method, url, token, body);
      assert.equal(res.status, status, `${method} ${url} should be ${status} but was ${res.status}`);
      return res;
    };
    await expect(404, 'PATCH', `${A}/coupons/${f.bCoupon.id}`, a.owner.token, { active: false });
    await expect(404, 'POST', `${A}/coupons/quote`, a.member.token, { code: 'BONLY', planId: aPlan.id });
    await expect(404, 'POST', `${A}/coupons/quote`, a.member.token, { code: 'BONLY', planId: f.bPlan.id });
    await expect(404, 'POST', `${A}/payments/orders`, a.member.token, { planId: aPlan.id, couponCode: 'BONLY' });
    await expect(404, 'POST', `${A}/coupons`, a.owner.token, { code: 'APLAN', kind: 'flat', amount: 1, planIds: [f.bPlan.id] });
    // The same code can exist in both gyms independently.
    await expect(201, 'POST', `${A}/coupons`, a.owner.token, { code: 'BONLY', kind: 'flat', amount: 1 });
    await expect(404, 'GET', `${A}/classes/${f.bClass.id}/attendees`, a.owner.token);
    await expect(404, 'PUT', `${A}/classes/${f.bClass.id}/attendees/${b.member.userId}`, a.owner.token, { attended: true });
    const qr = await expect(403, 'POST', `${A}/checkins`, a.member.token, { method: 'qr', doorToken: f.bDoor.token });
    assert.equal(qr.body.error, 'bad_door_code');
    await expect(404, 'PATCH', `${A}/freeze-requests/${f.bFreeze.id}`, a.owner.token, { status: 'approved' });
    await expect(404, 'POST', `${A}/members/${b.member.userId}/nudge`, a.owner.token, { kind: 'inactive' });
    await expect(404, 'GET', `${A}/posts/${f.bPost.id}`, a.member.token);
    await expect(404, 'GET', `${A}/challenges/${f.bChallenge.id}`, a.member.token);

    // A referral id from another gym is not recorded.
    const friend = await login('+919800000061');
    await call('POST', '/gyms/join', friend.token, { code: a.gym.joinCode, ref: b.member.userId });
    assert.equal((await call('GET', `/gyms/${b.gym.id}/referral`, b.member.token)).body.joined, 0);
  });

  it("A's v0.3 lists and reports never contain B's data", async () => {
    const f = await twoGymsV3();
    const { call, a } = f;
    const A = `/gyms/${a.gym.id}`;
    assert.deepEqual((await call('GET', `${A}/coupons`, a.owner.token)).body.coupons, []);
    assert.deepEqual((await call('GET', `${A}/trainer/today`, a.owner.token)).body.classes, []);
    assert.deepEqual((await call('GET', `${A}/freeze-requests`, a.owner.token)).body.requests, []);
    const referral = (await call('GET', `${A}/referral`, a.member.token)).body;
    assert.deepEqual([referral.joined, referral.reward], [0, null]);
    const revenue = (await call('GET', `${A}/reports/revenue`, a.owner.token)).body;
    assert.deepEqual(
      [revenue.collectedThisMonthPaise, revenue.couponDiscountsThisMonthPaise, revenue.byPlan, revenue.renewalsDue],
      [0, 0, [], []],
    );
    assert.equal((await call('GET', `${A}/door-code`, a.owner.token)).body.token === f.bDoor.token, false);
    assert.deepEqual((await call('GET', `${A}/me/summary`, a.member.token)).body.crowd, { level: 'quiet', recentCheckIns: 0 });
  });
});

describe('tenant isolation: hosted checkout', () => {
  it('payment lookups never cross gyms, and checkout links are bound to their payer', async () => {
    const { call, app, a, b, bOrder, clock } = await twoGyms();
    for (const who of [a.owner, a.member]) {
      assert.equal((await call('GET', `/gyms/${b.gym.id}/payments/${bOrder.paymentId}`, who.token)).status, 404);
      assert.equal((await call('GET', `/gyms/${a.gym.id}/payments/${bOrder.paymentId}`, who.token)).status, 404);
    }
    assert.equal((await call('GET', `/gyms/${b.gym.id}/payments/${bOrder.paymentId}`, b.member.token)).status, 200);
    // A checkout link minted for A's member cannot open or complete B's payment.
    const { signCheckoutToken } = await import('../src/checkout');
    const t = signCheckoutToken(bOrder.paymentId, a.member.userId, 'test-secret', clock.now);
    assert.equal((await app.inject({ method: 'GET', url: `/pay/${bOrder.paymentId}?t=${t}` })).statusCode, 403);
    const res = await app.inject({
      method: 'POST',
      url: `/pay/${bOrder.paymentId}/complete`,
      payload: { t, razorpay_payment_id: 'p', razorpay_order_id: bOrder.providerOrderId, razorpay_signature: bOrder.mockSignature },
    });
    assert.equal(res.statusCode, 403);
  });
});
