import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers';

const plan = {
  title: 'Vegetarian fat loss',
  goal: 'lose_weight',
  description: 'About 1,600 kcal',
  caloriesPerDay: 1600,
  meals: [
    { slot: 'breakfast', title: 'Moong dal chilla', description: '2 chillas with curd', calories: 380, proteinG: 24 },
    { slot: 'dinner', title: 'Paneer tikka', calories: 520, proteinG: 34 },
  ],
};

const idea = (title: string, mealType: string) => ({
  title,
  mealType,
  calories: 300,
  proteinG: 20,
  ingredients: ['Paneer', 'Onion'],
  steps: ['Cook it'],
  tags: ['vegetarian'],
});

describe('meal plans', () => {
  it('admins create and delete; members list and read', async () => {
    const { call, gymWithMember } = setup();
    const { owner, member, gym } = await gymWithMember();
    const created = await call('POST', `/gyms/${gym.id}/meal-plans`, owner.token, plan);
    assert.equal(created.status, 201);
    assert.equal(created.body.meals[1].description, '', 'defaults are applied');
    assert.equal(created.body.goal, 'lose_weight');

    const list = (await call('GET', `/gyms/${gym.id}/meal-plans`, member.token)).body.mealPlans;
    assert.deepEqual(list.map((p: any) => p.title), ['Vegetarian fat loss']);
    const one = await call('GET', `/gyms/${gym.id}/meal-plans/${created.body.id}`, member.token);
    assert.equal(one.body.caloriesPerDay, 1600);
    assert.equal(one.body.favourite, false);

    assert.equal((await call('POST', `/gyms/${gym.id}/meal-plans`, member.token, plan)).status, 403);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/meal-plans/${created.body.id}`, member.token)).status, 403);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/meal-plans/${created.body.id}`, owner.token)).status, 204);
    assert.equal((await call('GET', `/gyms/${gym.id}/meal-plans/${created.body.id}`, member.token)).status, 404);
    assert.equal((await call('DELETE', `/gyms/${gym.id}/meal-plans/${created.body.id}`, owner.token)).status, 404);
  });

  it('validates meal plans', async () => {
    const { call, gymWithMember } = setup();
    const { owner, gym } = await gymWithMember();
    assert.equal((await call('POST', `/gyms/${gym.id}/meal-plans`, owner.token, { ...plan, caloriesPerDay: 300 })).status, 400);
    assert.equal((await call('POST', `/gyms/${gym.id}/meal-plans`, owner.token, { ...plan, meals: [] })).status, 400);
    assert.equal((await call('POST', `/gyms/${gym.id}/meal-plans`, owner.token, { ...plan, goal: 'fly' })).status, 400);
  });
});

describe('meal ideas', () => {
  it('lists by meal type, breakfast first', async () => {
    const { call, gymWithMember, joinAs } = setup();
    const { owner, member, gym } = await gymWithMember();
    const manager = await joinAs(gym, owner.token, '+919800000004', 'Manager', 'manager');
    await call('POST', `/gyms/${gym.id}/meal-ideas`, owner.token, idea('Chicken tikka', 'dinner'));
    const chilla = await call('POST', `/gyms/${gym.id}/meal-ideas`, manager.token, idea('Chilla', 'breakfast'));
    assert.equal(chilla.status, 201, 'managers are admins');
    assert.equal(chilla.body.carbsG, 0);
    await call('POST', `/gyms/${gym.id}/meal-ideas`, owner.token, idea('Roasted chana', 'snack'));

    const all = (await call('GET', `/gyms/${gym.id}/meal-ideas`, member.token)).body.mealIdeas;
    assert.deepEqual(all.map((i: any) => i.mealType), ['breakfast', 'snack', 'dinner']);
    const snacks = (await call('GET', `/gyms/${gym.id}/meal-ideas?mealType=snack`, member.token)).body.mealIdeas;
    assert.deepEqual(snacks.map((i: any) => i.title), ['Roasted chana']);
    assert.equal((await call('GET', `/gyms/${gym.id}/meal-ideas?mealType=brunch`, member.token)).status, 400);
    const one = (await call('GET', `/gyms/${gym.id}/meal-ideas/${chilla.body.id}`, member.token)).body;
    assert.deepEqual(one.ingredients, ['Paneer', 'Onion']);
  });

  it('enforces roles, validation and the feature switch', async () => {
    const { call, gymWithMember, joinAs, disableFeatures } = setup();
    const { owner, member, gym } = await gymWithMember();
    const trainer = await joinAs(gym, owner.token, '+919800000003', 'Trainer', 'trainer');
    assert.equal((await call('POST', `/gyms/${gym.id}/meal-ideas`, member.token, idea('X dish', 'lunch'))).status, 403);
    assert.equal((await call('POST', `/gyms/${gym.id}/meal-ideas`, trainer.token, idea('X dish', 'lunch'))).status, 403);
    assert.equal((await call('POST', `/gyms/${gym.id}/meal-ideas`, owner.token, { ...idea('X dish', 'lunch'), calories: -5 })).status, 400);
    const created = (await call('POST', `/gyms/${gym.id}/meal-ideas`, owner.token, idea('Dal', 'lunch'))).body;
    assert.equal((await call('DELETE', `/gyms/${gym.id}/meal-ideas/${created.id}`, trainer.token)).status, 403);

    await disableFeatures(gym, owner.token, ['nutrition']);
    for (const url of [`/gyms/${gym.id}/meal-ideas`, `/gyms/${gym.id}/meal-plans`, `/gyms/${gym.id}/meal-ideas/${created.id}`]) {
      const res = await call('GET', url, member.token);
      assert.equal(res.status, 403, url);
      assert.equal(res.body.error, 'feature_disabled');
    }
  });
});
