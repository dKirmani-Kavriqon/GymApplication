import type { App } from '../http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ADMIN_ROLES, MEAL_TYPES, mealIdeaSchema, mealPlanSchema } from '@gymverse/shared';
import { tx } from '../db';
import type { Ctx } from '../context';
import * as store from '../store';
import type { Row } from '../store';
import { getMealIdeaRow, getMealPlanRow, mapMealIdea, mapMealPlan } from '../domain/content';

export function registerNutritionRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  // ---------- meal plans ----------

  app.get('/gyms/:gymId/meal-plans', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'nutrition');
    const rows = db.prepare('SELECT * FROM meal_plans WHERE gym_id = ? ORDER BY created_at, rowid').all(gym.id) as Row[];
    return { mealPlans: rows.map((r) => mapMealPlan(db, r, userId)) };
  });

  app.get('/gyms/:gymId/meal-plans/:planId', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'nutrition');
    const { planId } = req.params as { planId: string };
    return mapMealPlan(db, getMealPlanRow(db, gym.id, planId), userId);
  });

  app.post('/gyms/:gymId/meal-plans', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    ctx.featureGuard(gym, 'nutrition');
    const p = mealPlanSchema.parse(req.body);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO meal_plans (id, gym_id, title, goal, description, calories_per_day, meals, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, gym.id, p.title, p.goal ?? null, p.description, p.caloriesPerDay, JSON.stringify(p.meals), userId, now().toISOString());
    store.audit(db, gym.id, userId, 'meal_plan.create', id, now());
    return reply.status(201).send(mapMealPlan(db, getMealPlanRow(db, gym.id, id), userId));
  });

  app.delete('/gyms/:gymId/meal-plans/:planId', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    ctx.featureGuard(gym, 'nutrition');
    const { planId } = req.params as { planId: string };
    getMealPlanRow(db, gym.id, planId);
    tx(db, () => {
      db.prepare("DELETE FROM favourites WHERE gym_id = ? AND kind = 'meal_plan' AND item_id = ?").run(gym.id, planId);
      db.prepare('DELETE FROM meal_plans WHERE id = ? AND gym_id = ?').run(planId, gym.id);
      store.audit(db, gym.id, userId, 'meal_plan.delete', planId, now());
    });
    return reply.status(204).send();
  });

  // ---------- meal ideas ----------

  app.get('/gyms/:gymId/meal-ideas', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'nutrition');
    const { mealType } = z.object({ mealType: z.enum(MEAL_TYPES).optional() }).parse(req.query);
    const rows = db
      .prepare(`SELECT * FROM meal_ideas WHERE gym_id = ? ${mealType ? 'AND meal_type = ?' : ''} ORDER BY created_at, rowid`)
      .all(...(mealType ? [gym.id, mealType] : [gym.id])) as Row[];
    const order = (t: unknown) => MEAL_TYPES.indexOf(t as (typeof MEAL_TYPES)[number]);
    rows.sort((a, b) => order(a.meal_type) - order(b.meal_type)); // breakfast → dinner, stable within a type
    return { mealIdeas: rows.map((r) => mapMealIdea(db, r, userId)) };
  });

  app.get('/gyms/:gymId/meal-ideas/:ideaId', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'nutrition');
    const { ideaId } = req.params as { ideaId: string };
    return mapMealIdea(db, getMealIdeaRow(db, gym.id, ideaId), userId);
  });

  app.post('/gyms/:gymId/meal-ideas', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    ctx.featureGuard(gym, 'nutrition');
    const m = mealIdeaSchema.parse(req.body);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO meal_ideas (id, gym_id, title, meal_type, calories, protein_g, carbs_g, fat_g, ingredients, steps, image_url, tags, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      gym.id,
      m.title,
      m.mealType,
      m.calories,
      m.proteinG,
      m.carbsG,
      m.fatG,
      JSON.stringify(m.ingredients),
      JSON.stringify(m.steps),
      m.imageUrl ?? null,
      JSON.stringify(m.tags),
      userId,
      now().toISOString(),
    );
    store.audit(db, gym.id, userId, 'meal_idea.create', id, now());
    return reply.status(201).send(mapMealIdea(db, getMealIdeaRow(db, gym.id, id), userId));
  });

  app.delete('/gyms/:gymId/meal-ideas/:ideaId', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    ctx.featureGuard(gym, 'nutrition');
    const { ideaId } = req.params as { ideaId: string };
    getMealIdeaRow(db, gym.id, ideaId);
    tx(db, () => {
      db.prepare("DELETE FROM favourites WHERE gym_id = ? AND kind = 'meal_idea' AND item_id = ?").run(gym.id, ideaId);
      db.prepare('DELETE FROM meal_ideas WHERE id = ? AND gym_id = ?').run(ideaId, gym.id);
      store.audit(db, gym.id, userId, 'meal_idea.delete', ideaId, now());
    });
    return reply.status(204).send();
  });
}
