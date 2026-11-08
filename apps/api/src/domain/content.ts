import type { Article, ArticleKind, GoalId, MealIdea, MealPlan, MealPlanMeal, MealType } from '@gymverse/shared';
import type { Db } from '../db';
import { notFound } from '../errors';
import * as store from '../store';
import type { Row } from '../store';
import { isFavourite } from './workouts';

/** ceil(words / 200), minimum 1. */
export function readMinutes(body: string): number {
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  return Math.max(1, Math.ceil(words / 200));
}

export function getArticleRow(db: Db, gymId: string, id: string): Row {
  const r = db.prepare('SELECT * FROM articles WHERE id = ? AND gym_id = ?').get(id, gymId) as Row | undefined;
  if (!r) throw notFound('Article not found');
  return r;
}

export function mapArticle(db: Db, r: Row, viewerId: string): Article {
  return {
    id: r.id as string,
    kind: r.kind as ArticleKind,
    title: r.title as string,
    summary: r.summary as string,
    body: r.body as string,
    imageUrl: (r.image_url as string) ?? null,
    videoUrl: (r.video_url as string) ?? null,
    tags: store.parseJson<string[]>(r.tags, []),
    readMinutes: readMinutes(r.body as string),
    publishedAt: r.published_at as string,
    author: store.personRef(db, r.author_id as string),
    favourite: isFavourite(db, r.gym_id as string, viewerId, 'article', r.id as string),
  };
}

export function getMealIdeaRow(db: Db, gymId: string, id: string): Row {
  const r = db.prepare('SELECT * FROM meal_ideas WHERE id = ? AND gym_id = ?').get(id, gymId) as Row | undefined;
  if (!r) throw notFound('Meal idea not found');
  return r;
}

export function mapMealIdea(db: Db, r: Row, viewerId: string): MealIdea {
  return {
    id: r.id as string,
    title: r.title as string,
    mealType: r.meal_type as MealType,
    calories: r.calories as number,
    proteinG: r.protein_g as number,
    carbsG: r.carbs_g as number,
    fatG: r.fat_g as number,
    ingredients: store.parseJson<string[]>(r.ingredients, []),
    steps: store.parseJson<string[]>(r.steps, []),
    imageUrl: (r.image_url as string) ?? null,
    tags: store.parseJson<string[]>(r.tags, []),
    favourite: isFavourite(db, r.gym_id as string, viewerId, 'meal_idea', r.id as string),
  };
}

export function getMealPlanRow(db: Db, gymId: string, id: string): Row {
  const r = db.prepare('SELECT * FROM meal_plans WHERE id = ? AND gym_id = ?').get(id, gymId) as Row | undefined;
  if (!r) throw notFound('Meal plan not found');
  return r;
}

export function mapMealPlan(db: Db, r: Row, viewerId: string): MealPlan {
  return {
    id: r.id as string,
    title: r.title as string,
    goal: (r.goal as GoalId) ?? null,
    description: r.description as string,
    caloriesPerDay: r.calories_per_day as number,
    meals: store.parseJson<MealPlanMeal[]>(r.meals, []),
    favourite: isFavourite(db, r.gym_id as string, viewerId, 'meal_plan', r.id as string),
  };
}
