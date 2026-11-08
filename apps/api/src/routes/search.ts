import type { App } from '../http';
import { z } from 'zod';
import { STAFF_ROLES, type FeatureKey, type SearchResults } from '@gymverse/shared';
import type { Ctx } from '../context';
import * as store from '../store';
import type { Row } from '../store';
import { mapArticle, mapMealIdea } from '../domain/content';
import { assignedRoutineRows, listExercises, mapRoutine, myRoutineRows, presetRoutineRows } from '../domain/workouts';

const MAX_PER_GROUP = 10;
const CLASS_WINDOW_DAYS = 14;

export function registerSearchRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  app.get('/gyms/:gymId/search', async (req): Promise<SearchResults> => {
    const { gym, userId } = ctx.gymAccess(req);
    const { q } = z.object({ q: z.string().trim().min(2, 'Type at least 2 characters to search').max(60) }).parse(req.query);
    const on = (f: FeatureKey) => gym.enabledFeatures.includes(f);
    const hit = (...fields: Array<string | null | undefined>) => fields.some((f) => store.matches(f, q));
    const tagsHit = (tags: unknown) => store.parseJson<string[]>(tags, []).some((t) => store.matches(t, q));
    const top = <T>(list: T[]) => list.slice(0, MAX_PER_GROUP);

    let classes: SearchResults['classes'] = [];
    if (on('classes')) {
      const from = now();
      const to = new Date(from.getTime() + CLASS_WINDOW_DAYS * 86_400_000);
      const rows = db
        .prepare('SELECT * FROM class_sessions WHERE gym_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at')
        .all(gym.id, from.toISOString(), to.toISOString()) as Row[];
      classes = top(rows.filter((r) => hit(r.title as string, r.trainer_name as string | null))).map((r) => store.mapSession(db, r, userId));
    }

    let routines: SearchResults['routines'] = [];
    let exercises: SearchResults['exercises'] = [];
    if (on('workouts')) {
      const seen = new Set<string>();
      const rows = [...assignedRoutineRows(db, gym.id, userId), ...presetRoutineRows(db, gym.id), ...myRoutineRows(db, gym.id, userId)].filter(
        (r) => !seen.has(r.id as string) && seen.add(r.id as string) && hit(r.name as string),
      );
      routines = top(rows).map((r) => mapRoutine(db, r, userId));
      exercises = top(listExercises(db, gym.id).filter((e) => hit(e.name)));
    }

    let articles: SearchResults['articles'] = [];
    if (on('resources')) {
      const rows = db.prepare('SELECT * FROM articles WHERE gym_id = ? ORDER BY published_at DESC, rowid DESC').all(gym.id) as Row[];
      articles = top(rows.filter((r) => hit(r.title as string) || tagsHit(r.tags))).map((r) => mapArticle(db, r, userId));
    }

    let mealIdeas: SearchResults['mealIdeas'] = [];
    if (on('nutrition')) {
      const rows = db.prepare('SELECT * FROM meal_ideas WHERE gym_id = ? ORDER BY created_at, rowid').all(gym.id) as Row[];
      mealIdeas = top(rows.filter((r) => hit(r.title as string) || tagsHit(r.tags))).map((r) => mapMealIdea(db, r, userId));
    }

    const marks = STAFF_ROLES.map(() => '?').join(', ');
    const staff = db
      .prepare(
        `SELECT u.id, u.name FROM gym_members m JOIN users u ON u.id = m.user_id
         WHERE m.gym_id = ? AND m.status = 'active' AND m.role IN (${marks}) ORDER BY u.name COLLATE NOCASE`,
      )
      .all(gym.id, ...STAFF_ROLES) as Array<{ id: string; name: string | null }>;
    const trainers = top(staff.filter((s) => hit(s.name))).map((s) => ({ id: s.id, name: s.name }));

    return { query: q, classes, routines, exercises, articles, mealIdeas, trainers };
  });
}
