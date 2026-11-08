import type { App } from '../http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ADMIN_ROLES,
  MUSCLE_GROUPS,
  STAFF_ROLES,
  addDays,
  assignRoutineSchema,
  dayKey,
  exerciseSchema,
  measurementSchema,
  mondayOf,
  routineSchema,
  workoutLogSchema,
  type Measurement,
  type ProgressStats,
  type RoutinesResponse,
  type WorkoutLogResult,
} from '@gymverse/shared';
import { tx } from '../db';
import { HttpError, forbidden, notFound } from '../errors';
import type { Ctx } from '../context';
import * as store from '../store';
import type { Row } from '../store';
import { notify } from '../domain/notifications';
import {
  assignRoutine,
  assignedRoutineRows,
  getExerciseRow,
  getVisibleRoutine,
  listExercises,
  listWorkouts,
  mapExercise,
  mapRoutine,
  mapWorkout,
  myRoutineRows,
  presetRoutineRows,
  writeRoutineExercises,
} from '../domain/workouts';

function mapMeasurement(r: Row): Measurement {
  return {
    id: r.id as string,
    measuredOn: r.measured_on as string,
    weightKg: (r.weight_kg as number) ?? null,
    bodyFatPct: (r.body_fat_pct as number) ?? null,
    waistCm: (r.waist_cm as number) ?? null,
  };
}

export function registerWorkoutRoutes(app: App, ctx: Ctx): void {
  const { db, now } = ctx;

  // ---------- exercises ----------

  app.get('/gyms/:gymId/exercises', async (req) => {
    const { gym } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'workouts');
    const { q, muscle } = z
      .object({ q: z.string().trim().max(60).optional(), muscle: z.enum(MUSCLE_GROUPS).optional() })
      .parse(req.query);
    const exercises = listExercises(db, gym.id).filter((e) => (!q || store.matches(e.name, q)) && (!muscle || e.muscleGroup === muscle));
    return { exercises };
  });

  app.post('/gyms/:gymId/exercises', async (req, reply) => {
    const { gym, userId } = ctx.gymAccess(req, STAFF_ROLES);
    ctx.featureGuard(gym, 'workouts');
    const e = exerciseSchema.parse(req.body);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO exercises (id, gym_id, name, muscle_group, equipment, instructions, video_url, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, gym.id, e.name, e.muscleGroup, e.equipment, JSON.stringify(e.instructions), e.videoUrl ?? null, userId, now().toISOString());
    store.audit(db, gym.id, userId, 'exercise.create', id, now());
    return reply.status(201).send(mapExercise(getExerciseRow(db, gym.id, id)));
  });

  // ---------- routines ----------

  app.get('/gyms/:gymId/routines', async (req): Promise<RoutinesResponse> => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'workouts');
    return {
      assigned: assignedRoutineRows(db, gym.id, userId).map((r) => mapRoutine(db, r, userId)),
      presets: presetRoutineRows(db, gym.id).map((r) => mapRoutine(db, r, userId)),
      mine: myRoutineRows(db, gym.id, userId).map((r) => mapRoutine(db, r, userId)),
    };
  });

  app.get('/gyms/:gymId/routines/:routineId', async (req) => {
    const { gym, userId, role } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'workouts');
    const { routineId } = req.params as { routineId: string };
    return mapRoutine(db, getVisibleRoutine(db, gym.id, routineId, userId, role), userId);
  });

  app.post('/gyms/:gymId/routines', async (req, reply) => {
    const { gym, userId, role } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'workouts');
    const r = routineSchema.parse(req.body);
    if (r.kind === 'preset' && !store.isStaff(role)) throw forbidden();
    const id = randomUUID();
    const ts = now().toISOString();
    tx(db, () => {
      db.prepare(
        'INSERT INTO routines (id, gym_id, name, description, level, kind, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, gym.id, r.name, r.description ?? null, r.level, r.kind, userId, ts, ts);
      writeRoutineExercises(db, gym.id, id, r.exercises);
      if (r.kind === 'preset') store.audit(db, gym.id, userId, 'routine.create', id, now());
    });
    return reply.status(201).send(mapRoutine(db, getVisibleRoutine(db, gym.id, id, userId, role), userId));
  });

  app.patch('/gyms/:gymId/routines/:routineId', async (req) => {
    const { gym, userId, role } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'workouts');
    const { routineId } = req.params as { routineId: string };
    const row = getVisibleRoutine(db, gym.id, routineId, userId, role);
    const isCreator = row.created_by === userId;
    if (!(isCreator || (row.kind === 'preset' && store.isStaff(role)))) throw forbidden();
    const r = routineSchema.parse(req.body);
    // `kind` defaults to 'custom' in the schema; only change it when the client actually sent it.
    const sentKind = typeof req.body === 'object' && req.body !== null && 'kind' in req.body;
    const kind = sentKind ? r.kind : (row.kind as 'preset' | 'custom');
    if (kind === 'preset' && !store.isStaff(role)) throw forbidden();
    tx(db, () => {
      db.prepare('UPDATE routines SET name = ?, description = ?, level = ?, kind = ?, updated_at = ? WHERE id = ? AND gym_id = ?').run(
        r.name,
        r.description ?? null,
        r.level,
        kind,
        now().toISOString(),
        routineId,
        gym.id,
      );
      writeRoutineExercises(db, gym.id, routineId, r.exercises);
    });
    return mapRoutine(db, getVisibleRoutine(db, gym.id, routineId, userId, role), userId);
  });

  app.delete('/gyms/:gymId/routines/:routineId', async (req, reply) => {
    const { gym, userId, role } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'workouts');
    const { routineId } = req.params as { routineId: string };
    const row = getVisibleRoutine(db, gym.id, routineId, userId, role);
    const allowed = row.created_by === userId || (row.kind === 'preset' && ADMIN_ROLES.includes(role));
    if (!allowed) throw forbidden();
    tx(db, () => {
      db.prepare("DELETE FROM favourites WHERE gym_id = ? AND kind = 'routine' AND item_id = ?").run(gym.id, routineId);
      // Logged workouts keep their own copy of the routine name.
      db.prepare('UPDATE workout_logs SET routine_id = NULL WHERE gym_id = ? AND routine_id = ?').run(gym.id, routineId);
      db.prepare('DELETE FROM routines WHERE id = ? AND gym_id = ?').run(routineId, gym.id);
      store.audit(db, gym.id, userId, 'routine.delete', routineId, now());
    });
    return reply.status(204).send();
  });

  app.post('/gyms/:gymId/routines/:routineId/assign', async (req) => {
    const { gym, userId, role } = ctx.gymAccess(req, STAFF_ROLES);
    ctx.featureGuard(gym, 'workouts');
    const { routineId } = req.params as { routineId: string };
    const row = getVisibleRoutine(db, gym.id, routineId, userId, role);
    const a = assignRoutineSchema.parse(req.body);
    if (!store.getRole(db, gym.id, a.userId)) throw notFound('Member not found');
    tx(db, () => {
      assignRoutine(db, gym.id, routineId, a.userId, userId, a.note ?? null, now());
      const coach = store.personRef(db, userId).name ?? 'Your trainer';
      notify(
        db,
        gym.id,
        a.userId,
        {
          kind: 'routine_assigned',
          title: 'New workout plan',
          body: `${coach} assigned you "${row.name}".${a.note ? ` ${a.note}` : ''}`,
          link: `routine:${routineId}`,
        },
        now(),
      );
      store.audit(db, gym.id, userId, 'routine.assign', `${routineId}:${a.userId}`, now());
    });
    return { assigned: true };
  });

  app.get('/gyms/:gymId/members/:memberId/workouts', async (req) => {
    const { gym } = ctx.gymAccess(req, STAFF_ROLES);
    ctx.featureGuard(gym, 'workouts');
    const { memberId } = req.params as { memberId: string };
    if (!store.getRole(db, gym.id, memberId)) throw notFound('Member not found');
    return {
      workouts: listWorkouts(db, gym.id, memberId, 50),
      assigned: assignedRoutineRows(db, gym.id, memberId).map((r) => mapRoutine(db, r, memberId)),
    };
  });

  // ---------- workout logs & progress ----------

  app.post('/gyms/:gymId/workouts', async (req, reply) => {
    const { gym, userId, role } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'workouts');
    const w = workoutLogSchema.parse(req.body);
    const started = new Date(w.startedAt);
    const completed = new Date(w.completedAt);
    if (completed < started) throw new HttpError(400, 'validation', 'The workout cannot finish before it started.');
    const routine = w.routineId ? getVisibleRoutine(db, gym.id, w.routineId, userId, role) : null;
    const exerciseNames = new Map<string, string>();
    for (const s of w.sets) {
      if (!exerciseNames.has(s.exerciseId)) exerciseNames.set(s.exerciseId, getExerciseRow(db, gym.id, s.exerciseId).name as string);
    }
    const id = randomUUID();
    const at = now();
    const result = tx(db, (): WorkoutLogResult => {
      const volume = w.sets.reduce((sum, s) => sum + s.reps * (s.weightKg ?? 0), 0);
      db.prepare(
        `INSERT INTO workout_logs (id, gym_id, user_id, routine_id, routine_name, started_at, completed_at, day, total_volume_kg, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        gym.id,
        userId,
        routine ? (routine.id as string) : null,
        routine ? (routine.name as string) : null,
        started.toISOString(),
        completed.toISOString(),
        dayKey(completed, gym.timezone),
        Math.round(volume * 100) / 100,
        w.notes ?? null,
        at.toISOString(),
      );
      const insertSet = db.prepare(
        `INSERT INTO workout_sets (id, workout_id, gym_id, exercise_id, exercise_name, position, set_number, reps, weight_kg)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const setNumbers = new Map<string, number>();
      w.sets.forEach((s, i) => {
        const n = (setNumbers.get(s.exerciseId) ?? 0) + 1;
        setNumbers.set(s.exerciseId, n);
        insertSet.run(randomUUID(), id, gym.id, s.exerciseId, exerciseNames.get(s.exerciseId)!, i, n, s.reps, s.weightKg ?? null);
      });
      const newBadges = store.syncBadges(db, gym, userId, at);
      const row = db.prepare('SELECT * FROM workout_logs WHERE id = ? AND gym_id = ?').get(id, gym.id) as Row;
      return { workout: mapWorkout(db, row), newBadges };
    });
    return reply.status(201).send(result);
  });

  app.get('/gyms/:gymId/workouts', async (req) => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'workouts');
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    return { workouts: listWorkouts(db, gym.id, userId, limit) };
  });

  app.get('/gyms/:gymId/progress', async (req): Promise<ProgressStats> => {
    const { gym, userId } = ctx.gymAccess(req);
    ctx.featureGuard(gym, 'workouts');
    const today = dayKey(now(), gym.timezone);
    const firstWeek = addDays(mondayOf(today), -7 * 7);
    const logs = db
      .prepare('SELECT day, total_volume_kg FROM workout_logs WHERE gym_id = ? AND user_id = ? AND day >= ?')
      .all(gym.id, userId, firstWeek) as Array<{ day: string; total_volume_kg: number }>;
    const checkins = store.checkInDays(db, gym.id, userId).filter((d) => d >= firstWeek);
    const weekly = Array.from({ length: 8 }, (_, i) => {
      const weekStart = addDays(firstWeek, i * 7);
      const weekEnd = addDays(weekStart, 6);
      const inWeek = (d: string) => d >= weekStart && d <= weekEnd;
      const mine = logs.filter((l) => inWeek(l.day));
      return {
        weekStart,
        workouts: mine.length,
        volumeKg: Math.round(mine.reduce((s, l) => s + l.total_volume_kg, 0) * 100) / 100,
        checkIns: checkins.filter(inWeek).length,
      };
    });
    const weight = (
      db
        .prepare('SELECT measured_on, weight_kg FROM measurements WHERE user_id = ? AND weight_kg IS NOT NULL ORDER BY measured_on, created_at, rowid')
        .all(userId) as Array<{ measured_on: string; weight_kg: number }>
    ).map((m) => ({ day: m.measured_on, kg: m.weight_kg }));
    const sets = db
      .prepare(
        `SELECT s.exercise_id, s.exercise_name, s.weight_kg, s.reps, w.day FROM workout_sets s
         JOIN workout_logs w ON w.id = s.workout_id AND w.gym_id = s.gym_id
         WHERE s.gym_id = ? AND w.user_id = ? AND s.weight_kg > 0 ORDER BY w.day, s.position`,
      )
      .all(gym.id, userId) as Array<{ exercise_id: string; exercise_name: string; weight_kg: number; reps: number; day: string }>;
    const best = new Map<string, ProgressStats['personalBests'][number]>();
    for (const s of sets) {
      const cur = best.get(s.exercise_id);
      if (!cur || s.weight_kg > cur.weightKg || (s.weight_kg === cur.weightKg && s.reps > cur.reps)) {
        best.set(s.exercise_id, { exerciseId: s.exercise_id, exerciseName: s.exercise_name, weightKg: s.weight_kg, reps: s.reps, on: s.day });
      }
    }
    return {
      totalWorkouts: store.workoutCount(db, gym.id, userId),
      weekly,
      weight,
      personalBests: [...best.values()].sort((a, b) => b.weightKg - a.weightKg).slice(0, 5),
    };
  });

  // ---------- measurements (personal, not gym-scoped) ----------

  app.get('/me/measurements', async (req) => {
    const userId = ctx.userIdOf(req);
    const rows = db.prepare('SELECT * FROM measurements WHERE user_id = ? ORDER BY measured_on, created_at, rowid').all(userId) as Row[];
    return { measurements: rows.map(mapMeasurement) };
  });

  app.post('/me/measurements', async (req, reply) => {
    const userId = ctx.userIdOf(req);
    const m = measurementSchema.parse(req.body);
    const id = randomUUID();
    tx(db, () => {
      db.prepare(
        'INSERT INTO measurements (id, user_id, measured_on, weight_kg, body_fat_pct, waist_cm, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, userId, m.measuredOn, m.weightKg ?? null, m.bodyFatPct ?? null, m.waistCm ?? null, now().toISOString());
      if (m.weightKg != null) {
        const newer = db
          .prepare('SELECT 1 FROM measurements WHERE user_id = ? AND weight_kg IS NOT NULL AND measured_on > ? AND id != ?')
          .get(userId, m.measuredOn, id);
        if (!newer) {
          db.prepare('INSERT OR IGNORE INTO profiles (user_id) VALUES (?)').run(userId);
          db.prepare('UPDATE profiles SET weight_kg = ? WHERE user_id = ?').run(m.weightKg, userId);
        }
      }
    });
    return reply.status(201).send(mapMeasurement(db.prepare('SELECT * FROM measurements WHERE id = ?').get(id) as Row));
  });

  app.delete('/me/measurements/:measurementId', async (req, reply) => {
    const userId = ctx.userIdOf(req);
    const { measurementId } = req.params as { measurementId: string };
    const res = db.prepare('DELETE FROM measurements WHERE id = ? AND user_id = ?').run(measurementId, userId);
    if (res.changes === 0) throw notFound('Measurement not found');
    return reply.status(204).send();
  });
}
