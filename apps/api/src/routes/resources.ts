import type { App } from '../http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ADMIN_ROLES,
  ARTICLE_KINDS,
  FAVOURITE_KINDS,
  articleSchema,
  type FavouriteKind,
  type FavouritesResponse,
  type FeatureKey,
} from '@gymverse/shared';
import { tx, type Db } from '../db';
import type { Ctx, GymAccess } from '../context';
import * as store from '../store';
import type { Row } from '../store';
import { getArticleRow, getMealIdeaRow, getMealPlanRow, mapArticle, mapMealIdea, mapMealPlan } from '../domain/content';
import { canSeeRoutine, getVisibleRoutine, mapRoutine } from '../domain/workouts';

const FAVOURITE_FEATURE: Record<FavouriteKind, FeatureKey> = {
  article: 'resources',
  routine: 'workouts',
  meal_idea: 'nutrition',
  meal_plan: 'nutrition',
};

/** Throws 404 unless the item exists in this gym (and, for routines, the caller can see it). */
function assertFavouritable(db: Db, access: GymAccess, kind: FavouriteKind, id: string): void {
  const gymId = access.gym.id;
  if (kind === 'article') getArticleRow(db, gymId, id);
  else if (kind === 'routine') getVisibleRoutine(db, gymId, id, access.userId, access.role);
  else if (kind === 'meal_idea') getMealIdeaRow(db, gymId, id);
  else getMealPlanRow(db, gymId, id);
}

export function registerResourceRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  // ---------- articles, videos & tips ----------

  app.get('/gyms/:gymId/articles', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'resources');
    const { kind } = z.object({ kind: z.enum(ARTICLE_KINDS).optional() }).parse(req.query);
    const rows = db
      .prepare(`SELECT * FROM articles WHERE gym_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY published_at DESC, rowid DESC`)
      .all(...(kind ? [gym.id, kind] : [gym.id])) as Row[];
    return { articles: rows.map((r) => mapArticle(db, r, userId)) };
  });

  app.get('/gyms/:gymId/articles/:articleId', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'resources');
    const { articleId } = req.params as { articleId: string };
    return mapArticle(db, getArticleRow(db, gym.id, articleId), userId);
  });

  app.post('/gyms/:gymId/articles', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    ctx.featureGuard(gym, 'resources');
    const a = articleSchema.parse(req.body);
    const id = randomUUID();
    const ts = now().toISOString();
    db.prepare(
      `INSERT INTO articles (id, gym_id, kind, title, summary, body, image_url, video_url, tags, author_id, published_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, gym.id, a.kind, a.title, a.summary, a.body, a.imageUrl ?? null, a.videoUrl ?? null, JSON.stringify(a.tags), userId, ts, ts);
    store.audit(db, gym.id, userId, 'article.create', id, now());
    return reply.status(201).send(mapArticle(db, getArticleRow(db, gym.id, id), userId));
  });

  app.patch('/gyms/:gymId/articles/:articleId', async (req) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    ctx.featureGuard(gym, 'resources');
    const { articleId } = req.params as { articleId: string };
    getArticleRow(db, gym.id, articleId);
    const a = articleSchema.parse(req.body);
    db.prepare(
      `UPDATE articles SET kind = ?, title = ?, summary = ?, body = ?, image_url = ?, video_url = ?, tags = ?, updated_at = ?
       WHERE id = ? AND gym_id = ?`,
    ).run(a.kind, a.title, a.summary, a.body, a.imageUrl ?? null, a.videoUrl ?? null, JSON.stringify(a.tags), now().toISOString(), articleId, gym.id);
    store.audit(db, gym.id, userId, 'article.update', articleId, now());
    return mapArticle(db, getArticleRow(db, gym.id, articleId), userId);
  });

  app.delete('/gyms/:gymId/articles/:articleId', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, ADMIN_ROLES);
    ctx.featureGuard(gym, 'resources');
    const { articleId } = req.params as { articleId: string };
    getArticleRow(db, gym.id, articleId);
    tx(db, () => {
      db.prepare("DELETE FROM favourites WHERE gym_id = ? AND kind = 'article' AND item_id = ?").run(gym.id, articleId);
      db.prepare('DELETE FROM articles WHERE id = ? AND gym_id = ?').run(articleId, gym.id);
      store.audit(db, gym.id, userId, 'article.delete', articleId, now());
    });
    return reply.status(204).send();
  });

  // ---------- favourites ----------

  app.get('/gyms/:gymId/favourites', async (req): Promise<FavouritesResponse> => {
    const access = ctx.gymAccess(req);
    const { gym, userId, role } = access;
    const on = (f: FeatureKey) => gym.enabledFeatures.includes(f);
    const favs = (kind: FavouriteKind, table: string) =>
      db
        .prepare(
          `SELECT t.* FROM favourites f JOIN ${table} t ON t.id = f.item_id AND t.gym_id = f.gym_id
           WHERE f.gym_id = ? AND f.user_id = ? AND f.kind = ? ORDER BY f.created_at DESC, f.rowid DESC`,
        )
        .all(gym.id, userId, kind) as Row[];
    return {
      articles: on('resources') ? favs('article', 'articles').map((r) => mapArticle(db, r, userId)) : [],
      routines: on('workouts')
        ? favs('routine', 'routines')
            .filter((r) => canSeeRoutine(db, gym.id, r, userId, role))
            .map((r) => mapRoutine(db, r, userId))
        : [],
      mealIdeas: on('nutrition') ? favs('meal_idea', 'meal_ideas').map((r) => mapMealIdea(db, r, userId)) : [],
      mealPlans: on('nutrition') ? favs('meal_plan', 'meal_plans').map((r) => mapMealPlan(db, r, userId)) : [],
    };
  });

  const favouriteParams = z.object({ kind: z.enum(FAVOURITE_KINDS), itemId: z.string().min(1) });

  app.put('/gyms/:gymId/favourites/:kind/:itemId', async (req) => {
    const access = ctx.gymAccess(req);
    const { kind, itemId } = favouriteParams.parse(req.params);
    ctx.featureGuard(access.gym, FAVOURITE_FEATURE[kind]);
    assertFavouritable(db, access, kind, itemId);
    db.prepare('INSERT OR IGNORE INTO favourites (gym_id, user_id, kind, item_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
      access.gym.id,
      access.userId,
      kind,
      itemId,
      now().toISOString(),
    );
    return { favourite: true };
  });

  app.delete('/gyms/:gymId/favourites/:kind/:itemId', async (req) => {
    const access = ctx.gymAccess(req);
    const { kind, itemId } = favouriteParams.parse(req.params);
    ctx.featureGuard(access.gym, FAVOURITE_FEATURE[kind]);
    assertFavouritable(db, access, kind, itemId);
    db.prepare('DELETE FROM favourites WHERE gym_id = ? AND user_id = ? AND kind = ? AND item_id = ?').run(
      access.gym.id,
      access.userId,
      kind,
      itemId,
    );
    return { favourite: false };
  });
}
