import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { routineBody, setup } from './helpers';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('articles, videos and tips', () => {
  it('admins publish; members read newest first and filter by kind', async () => {
    const { call, gymWithMember, clock } = setup();
    const { owner, member, gym } = await gymWithMember();
    const a = await call('POST', `/gyms/${gym.id}/articles`, owner.token, {
      kind: 'article',
      title: 'Warm up right',
      summary: 'Why it matters',
      body: words(450),
      tags: ['warm-up', 'beginner'],
    });
    assert.equal(a.status, 201);
    assert.equal(a.body.readMinutes, 3); // ceil(450 / 200)
    assert.equal(a.body.author.name, 'Owner 1');
    assert.equal(a.body.favourite, false);
    clock.advance(60_000);
    const tip = await call('POST', `/gyms/${gym.id}/articles`, owner.token, { kind: 'tip', title: 'Drink water' });
    assert.equal(tip.body.readMinutes, 1, 'minimum one minute');
    assert.equal(tip.body.body, '');

    const list = (await call('GET', `/gyms/${gym.id}/articles`, member.token)).body.articles;
    assert.deepEqual(list.map((x: any) => x.title), ['Drink water', 'Warm up right']);
    const tips = (await call('GET', `/gyms/${gym.id}/articles?kind=tip`, member.token)).body.articles;
    assert.deepEqual(tips.map((x: any) => x.kind), ['tip']);
    assert.equal((await call('GET', `/gyms/${gym.id}/articles?kind=podcast`, member.token)).status, 400);
    assert.equal((await call('GET', `/gyms/${gym.id}/articles/${a.body.id}`, member.token)).body.title, 'Warm up right');
  });

  it('only admins write articles, with validation', async () => {
    const { call, gymWithMember, joinAs } = setup();
    const { owner, member, gym } = await gymWithMember();
    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Trainer', 'trainer');
    const body = { kind: 'video', title: 'Squat form', videoUrl: 'https://videos.example.com/squat.mp4' };
    assert.equal((await call('POST', `/gyms/${gym.id}/articles`, member.token, body)).status, 403);
    assert.equal((await call('POST', `/gyms/${gym.id}/articles`, trainer.token, body)).status, 403);
    assert.equal((await call('POST', `/gyms/${gym.id}/articles`, owner.token, { ...body, videoUrl: 'not a url' })).status, 400);
    assert.equal((await call('POST', `/gyms/${gym.id}/articles`, owner.token, { ...body, kind: 'essay' })).status, 400);

    const created = (await call('POST', `/gyms/${gym.id}/articles`, owner.token, body)).body;
    const patched = await call('PATCH', `/gyms/${gym.id}/articles/${created.id}`, owner.token, { ...body, title: 'Squat form, part 1' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.title, 'Squat form, part 1');
    assert.equal((await call('PATCH', `/gyms/${gym.id}/articles/${created.id}`, member.token, body)).status, 403);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/articles/${created.id}`, member.token)).status, 403);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/articles/${created.id}`, owner.token)).status, 204);
    assert.equal((await call('GET', `/gyms/${gym.id}/articles/${created.id}`, member.token)).status, 404);
    assert.equal((await call('PATCH', `/gyms/${gym.id}/articles/${created.id}`, owner.token, body)).status, 404);
  });

  it('is blocked when resources are switched off', async () => {
    const { call, gymWithMember, disableFeatures } = setup();
    const { owner, member, gym } = await gymWithMember();
    const art = (await call('POST', `/gyms/${gym.id}/articles`, owner.token, { kind: 'tip', title: 'Tip' })).body;
    await call('PUT', `/gyms/${gym.id}/favourites/article/${art.id}`, member.token);
    await disableFeatures(gym, owner.token, ['resources']);
    const res = await call('GET', `/gyms/${gym.id}/articles`, member.token);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'feature_disabled');
    assert.equal((await call('PUT', `/gyms/${gym.id}/favourites/article/${art.id}`, member.token)).status, 403);
    assert.deepEqual((await call('GET', `/gyms/${gym.id}/favourites`, member.token)).body.articles, []);
  });
});

describe('favourites', () => {
  it('favourites articles, routines, meal ideas and meal plans idempotently', async () => {
    const { call, gymWithMember } = setup();
    const { owner, member, gym } = await gymWithMember();
    const art = (await call('POST', `/gyms/${gym.id}/articles`, owner.token, { kind: 'article', title: 'Protein basics' })).body;
    const routine = (await call('POST', `/gyms/${gym.id}/routines`, owner.token, routineBody({ kind: 'preset' }))).body;
    const idea = (
      await call('POST', `/gyms/${gym.id}/meal-ideas`, owner.token, { title: 'Chilla', mealType: 'breakfast', calories: 280, proteinG: 16 })
    ).body;
    const plan = (
      await call('POST', `/gyms/${gym.id}/meal-plans`, owner.token, {
        title: 'Lean',
        caloriesPerDay: 1800,
        meals: [{ slot: 'lunch', title: 'Dal rice', calories: 500, proteinG: 18 }],
      })
    ).body;

    for (const [kind, id] of [
      ['article', art.id],
      ['routine', routine.id],
      ['meal_idea', idea.id],
      ['meal_plan', plan.id],
    ]) {
      const put = await call('PUT', `/gyms/${gym.id}/favourites/${kind}/${id}`, member.token);
      assert.equal(put.status, 200, `${kind}`);
      assert.deepEqual(put.body, { favourite: true });
      assert.deepEqual((await call('PUT', `/gyms/${gym.id}/favourites/${kind}/${id}`, member.token)).body, { favourite: true });
    }
    const favs = (await call('GET', `/gyms/${gym.id}/favourites`, member.token)).body;
    assert.deepEqual(
      [favs.articles.length, favs.routines.length, favs.mealIdeas.length, favs.mealPlans.length],
      [1, 1, 1, 1],
    );
    assert.equal(favs.articles[0].favourite, true);
    assert.equal((await call('GET', `/gyms/${gym.id}/articles/${art.id}`, member.token)).body.favourite, true);
    assert.equal((await call('GET', `/gyms/${gym.id}/articles/${art.id}`, owner.token)).body.favourite, false, 'favourites are per person');
    assert.equal((await call('GET', `/gyms/${gym.id}/routines/${routine.id}`, member.token)).body.favourite, true);

    assert.deepEqual((await call('DELETE', `/gyms/${gym.id}/favourites/article/${art.id}`, member.token)).body, { favourite: false });
    assert.equal((await call('GET', `/gyms/${gym.id}/favourites`, member.token)).body.articles.length, 0);

    // Deleting the item removes it from favourites.
    await call('DELETE', `/gyms/${gym.id}/meal-ideas/${idea.id}`, owner.token);
    assert.equal((await call('GET', `/gyms/${gym.id}/favourites`, member.token)).body.mealIdeas.length, 0);
  });

  it('validates the kind and requires the item to exist and be visible', async () => {
    const { call, gymWithMember, joinAs } = setup();
    const { owner, member, gym } = await gymWithMember();
    const other = await joinAs(gym, owner.token, '+919800000002', 'Other');
    const theirs = (await call('POST', `/gyms/${gym.id}/routines`, other.token, routineBody())).body;
    assert.equal((await call('PUT', `/gyms/${gym.id}/favourites/podcast/abc`, member.token)).status, 400);
    assert.equal((await call('PUT', `/gyms/${gym.id}/favourites/article/missing`, member.token)).status, 404);
    assert.equal((await call('PUT', `/gyms/${gym.id}/favourites/routine/${theirs.id}`, member.token)).status, 404);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/favourites/meal_plan/missing`, member.token)).status, 404);
  });
});
