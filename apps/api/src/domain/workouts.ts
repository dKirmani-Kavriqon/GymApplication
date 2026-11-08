import { randomUUID } from 'node:crypto';
import type { Equipment, Exercise, Level, MuscleGroup, Role, Routine, RoutineExercise, WorkoutLog, WorkoutSet } from '@gymverse/shared';
import type { Db } from '../db';
import { notFound } from '../errors';
import * as store from '../store';
import type { Row } from '../store';

export function mapExercise(r: Row): Exercise {
  return {
    id: r.id as string,
    name: r.name as string,
    muscleGroup: r.muscle_group as MuscleGroup,
    equipment: r.equipment as Equipment,
    instructions: store.parseJson<string[]>(r.instructions, []),
    videoUrl: (r.video_url as string) ?? null,
    builtIn: r.gym_id === null || r.gym_id === undefined,
  };
}

/** Exercises usable in a gym: the built-in library plus the gym's own. */
export function getExerciseRow(db: Db, gymId: string, id: string): Row {
  const r = db.prepare('SELECT * FROM exercises WHERE id = ? AND (gym_id IS NULL OR gym_id = ?)').get(id, gymId) as Row | undefined;
  if (!r) throw notFound('Exercise not found');
  return r;
}

export function listExercises(db: Db, gymId: string): Exercise[] {
  return (
    db.prepare('SELECT * FROM exercises WHERE gym_id IS NULL OR gym_id = ? ORDER BY name COLLATE NOCASE').all(gymId) as Row[]
  ).map(mapExercise);
}

// ---------- routines ----------

export function getRoutineRow(db: Db, gymId: string, id: string): Row {
  const r = db.prepare('SELECT * FROM routines WHERE id = ? AND gym_id = ?').get(id, gymId) as Row | undefined;
  if (!r) throw notFound('Routine not found');
  return r;
}

export function isAssigned(db: Db, gymId: string, routineId: string, userId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM routine_assignments WHERE gym_id = ? AND routine_id = ? AND user_id = ?').get(gymId, routineId, userId));
}

/** Presets, my own custom routines and routines assigned to me; staff see every routine in the gym. */
export function canSeeRoutine(db: Db, gymId: string, row: Row, userId: string, role: Role): boolean {
  return (
    store.isStaff(role) || row.kind === 'preset' || row.created_by === userId || isAssigned(db, gymId, row.id as string, userId)
  );
}

/** A routine the caller may see, else 404 (never 403, so ids cannot be probed). */
export function getVisibleRoutine(db: Db, gymId: string, id: string, userId: string, role: Role): Row {
  const row = getRoutineRow(db, gymId, id);
  if (!canSeeRoutine(db, gymId, row, userId, role)) throw notFound('Routine not found');
  return row;
}

export function isFavourite(db: Db, gymId: string, userId: string, kind: string, itemId: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM favourites WHERE gym_id = ? AND user_id = ? AND kind = ? AND item_id = ?').get(gymId, userId, kind, itemId),
  );
}

/** Rough minutes: sets × (40 s work + rest). */
export function routineMinutes(items: Array<{ sets: number; restSec: number }>): number {
  const seconds = items.reduce((s, e) => s + e.sets * (40 + e.restSec), 0);
  return Math.max(1, Math.round(seconds / 60));
}

export function mapRoutine(db: Db, r: Row, viewerId: string): Routine {
  const gymId = r.gym_id as string;
  const items = db
    .prepare(
      `SELECT re.exercise_id, re.sets, re.reps, re.weight_kg, re.rest_sec,
              e.id, e.gym_id, e.name, e.muscle_group, e.equipment, e.instructions, e.video_url
       FROM routine_exercises re JOIN exercises e ON e.id = re.exercise_id
       WHERE re.routine_id = ? AND re.gym_id = ? ORDER BY re.position`,
    )
    .all(r.id as string, gymId) as Row[];
  const exercises: RoutineExercise[] = items.map((i) => ({
    exerciseId: i.exercise_id as string,
    exercise: mapExercise(i),
    sets: i.sets as number,
    reps: i.reps as number,
    weightKg: (i.weight_kg as number) ?? null,
    restSec: i.rest_sec as number,
  }));
  const a = db
    .prepare('SELECT assigned_by, note, created_at FROM routine_assignments WHERE gym_id = ? AND routine_id = ? AND user_id = ?')
    .get(gymId, r.id as string, viewerId) as { assigned_by: string; note: string | null; created_at: string } | undefined;
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? null,
    level: r.level as Level,
    kind: r.kind as Routine['kind'],
    durationMin: routineMinutes(exercises),
    createdBy: store.personRef(db, r.created_by as string),
    exercises,
    assignment: a ? { by: store.personRef(db, a.assigned_by), note: a.note, at: a.created_at } : null,
    favourite: isFavourite(db, gymId, viewerId, 'routine', r.id as string),
    createdAt: r.created_at as string,
  };
}

/** Replaces a routine's exercise list. Every exercise must be built-in or belong to the gym (404 otherwise). */
export function writeRoutineExercises(
  db: Db,
  gymId: string,
  routineId: string,
  items: Array<{ exerciseId: string; sets: number; reps: number; weightKg?: number | null; restSec: number }>,
): void {
  for (const e of items) getExerciseRow(db, gymId, e.exerciseId);
  db.prepare('DELETE FROM routine_exercises WHERE routine_id = ? AND gym_id = ?').run(routineId, gymId);
  const insert = db.prepare(
    'INSERT INTO routine_exercises (routine_id, gym_id, position, exercise_id, sets, reps, weight_kg, rest_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  items.forEach((e, i) => insert.run(routineId, gymId, i, e.exerciseId, e.sets, e.reps, e.weightKg ?? null, e.restSec));
}

export function assignedRoutineRows(db: Db, gymId: string, userId: string): Row[] {
  return db
    .prepare(
      `SELECT r.* FROM routines r JOIN routine_assignments a ON a.routine_id = r.id AND a.gym_id = r.gym_id
       WHERE r.gym_id = ? AND a.user_id = ? ORDER BY a.created_at DESC, a.rowid DESC`,
    )
    .all(gymId, userId) as Row[];
}

export function presetRoutineRows(db: Db, gymId: string): Row[] {
  return db.prepare("SELECT * FROM routines WHERE gym_id = ? AND kind = 'preset' ORDER BY created_at, rowid").all(gymId) as Row[];
}

export function myRoutineRows(db: Db, gymId: string, userId: string): Row[] {
  return db
    .prepare("SELECT * FROM routines WHERE gym_id = ? AND kind = 'custom' AND created_by = ? ORDER BY created_at DESC, rowid DESC")
    .all(gymId, userId) as Row[];
}

/** Creates or refreshes an assignment (re-assigning updates the note and date). */
export function assignRoutine(db: Db, gymId: string, routineId: string, userId: string, by: string, note: string | null, now: Date): void {
  db.prepare(
    `INSERT INTO routine_assignments (id, gym_id, routine_id, user_id, assigned_by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (routine_id, user_id) DO UPDATE SET assigned_by = excluded.assigned_by, note = excluded.note, created_at = excluded.created_at`,
  ).run(randomUUID(), gymId, routineId, userId, by, note, now.toISOString());
}

// ---------- workout logs ----------

export function mapWorkout(db: Db, r: Row): WorkoutLog {
  const sets = (
    db
      .prepare('SELECT exercise_id, exercise_name, set_number, reps, weight_kg FROM workout_sets WHERE workout_id = ? AND gym_id = ? ORDER BY position')
      .all(r.id as string, r.gym_id as string) as Row[]
  ).map(
    (s): WorkoutSet => ({
      exerciseId: s.exercise_id as string,
      exerciseName: s.exercise_name as string,
      setNumber: s.set_number as number,
      reps: s.reps as number,
      weightKg: (s.weight_kg as number) ?? null,
    }),
  );
  const started = new Date(r.started_at as string).getTime();
  const completed = new Date(r.completed_at as string).getTime();
  return {
    id: r.id as string,
    routineId: (r.routine_id as string) ?? null,
    routineName: (r.routine_name as string) ?? null,
    startedAt: r.started_at as string,
    completedAt: r.completed_at as string,
    durationMin: Math.max(0, Math.round((completed - started) / 60_000)),
    sets,
    totalVolumeKg: r.total_volume_kg as number,
    notes: (r.notes as string) ?? null,
  };
}

export function listWorkouts(db: Db, gymId: string, userId: string, limit: number): WorkoutLog[] {
  return (
    db
      .prepare('SELECT * FROM workout_logs WHERE gym_id = ? AND user_id = ? ORDER BY completed_at DESC, rowid DESC LIMIT ?')
      .all(gymId, userId, limit) as Row[]
  ).map((r) => mapWorkout(db, r));
}
