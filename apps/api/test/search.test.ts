import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, routineBody, setup } from './helpers';

describe('search', () => {
  async function searchable() {
    const ctx = setup();
    const { call, joinAs, clock } = ctx;
    const { owner, member, gym } = await ctx.gymWithMember();
    const other = await joinAs(gym, owner.token, '+919800000002', 'Yogi Member'); // not staff: never in trainers
    await joinAs(gym, owner.token, '+919800000003', 'Yogesh Kumar', 'trainer');
    const cls = (title: string, trainerName: string | null, inDays: number) =>
      call('POST', `/gyms/${gym.id}/classes`, owner.token, {
        title,
        trainerName,
        startsAt: new Date(clock.now.getTime() + inDays * DAY).toISOString(),
        durationMin: 45,
        capacity: 10,
      });
    await cls('Morning Yoga', 'Anjali', 1);
    await cls('HIIT', 'Coach Vikram', 2);
    await cls('Yoga far away', 'Anjali', 20); // outside the 14-day window
    await call('POST', `/gyms/${gym.id}/routines`, owner.token, routineBody({ name: 'Yoga flow', kind: 'preset' }));
    await call('POST', `/gyms/${gym.id}/routines`, member.token, routineBody({ name: 'My yoga day' }));
    await call('POST', `/gyms/${gym.id}/routines`, other.token, routineBody({ name: 'Yoga secret' }));
    await call('POST', `/gyms/${gym.id}/articles`, owner.token, { kind: 'article', title: 'Yoga for runners' });
    await call('POST', `/gyms/${gym.id}/articles`, owner.token, { kind: 'tip', title: 'Stretch daily', tags: ['yoga', 'mobility'] });
    await call('POST', `/gyms/${gym.id}/articles`, owner.token, { kind: 'tip', title: 'Unrelated' });
    await call('POST', `/gyms/${gym.id}/meal-ideas`, owner.token, { title: 'Greek yogurt bowl', mealType: 'breakfast', calories: 250, proteinG: 20 });
    await call('POST', `/gyms/${gym.id}/meal-ideas`, owner.token, {
      title: 'Lassi',
      mealType: 'snack',
      calories: 200,
      proteinG: 8,
      tags: ['yogurt'],
    });
    return { ...ctx, owner, member, gym };
  }

  it('matches every group case-insensitively, scoped to what the caller can see', async () => {
    const { call, member, gym } = await searchable();
    const res = await call('GET', `/gyms/${gym.id}/search?q=YOG`, member.token);
    assert.equal(res.status, 200);
    const r = res.body;
    assert.equal(r.query, 'YOG');
    assert.deepEqual(r.classes.map((c: any) => c.title), ['Morning Yoga']);
    assert.deepEqual(r.routines.map((x: any) => x.name).sort(), ['My yoga day', 'Yoga flow']);
    assert.deepEqual(r.articles.map((a: any) => a.title).sort(), ['Stretch daily', 'Yoga for runners']);
    assert.deepEqual(r.mealIdeas.map((m: any) => m.title).sort(), ['Greek yogurt bowl', 'Lassi']);
    assert.deepEqual(r.trainers.map((t: any) => t.name), ['Yogesh Kumar']);
    assert.deepEqual(r.exercises, []);

    const byTrainer = (await call('GET', `/gyms/${gym.id}/search?q=vikram`, member.token)).body;
    assert.deepEqual(byTrainer.classes.map((c: any) => c.title), ['HIIT']);
    const exercises = (await call('GET', `/gyms/${gym.id}/search?q=squat`, member.token)).body.exercises;
    assert.ok(exercises.length >= 2 && exercises.every((e: any) => /squat/i.test(e.name)));
  });

  it('needs at least two characters and caps each group at 10', async () => {
    const { call, owner, member, gym, clock } = await searchable();
    assert.equal((await call('GET', `/gyms/${gym.id}/search?q=y`, member.token)).status, 400);
    assert.equal((await call('GET', `/gyms/${gym.id}/search`, member.token)).status, 400);
    for (let i = 0; i < 12; i++) {
      await call('POST', `/gyms/${gym.id}/classes`, owner.token, {
        title: `Spin ${i}`,
        startsAt: new Date(clock.now.getTime() + (i + 1) * 3600_000).toISOString(),
        durationMin: 30,
        capacity: 5,
      });
    }
    assert.equal((await call('GET', `/gyms/${gym.id}/search?q=spin`, member.token)).body.classes.length, 10);
  });

  it('returns empty groups for switched-off features', async () => {
    const { call, owner, member, gym, disableFeatures } = await searchable();
    await disableFeatures(gym, owner.token, ['classes', 'workouts', 'resources', 'nutrition']);
    const r = (await call('GET', `/gyms/${gym.id}/search?q=yog`, member.token)).body;
    assert.deepEqual([r.classes, r.routines, r.exercises, r.articles, r.mealIdeas], [[], [], [], [], []]);
    assert.equal(r.trainers.length, 1);
  });
});
