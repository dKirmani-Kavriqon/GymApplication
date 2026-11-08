import { BUILT_IN_EXERCISES } from './exercises';
import { MIGRATIONS, currentVersion } from './migrations';

/**
 * The database the API talks to. Two drivers implement it, both SQLite and both synchronous:
 *   - db-node.ts: node:sqlite (local development, tests, self-hosting)
 *   - db-durable.ts: a Cloudflare Durable Object's built-in SQLite (production)
 * Every tenant-owned row carries `gym_id` and every query filters by it (see
 * test/tenant-isolation.test.ts). Schema changes live in ./migrations.ts as numbered steps.
 */

export type SqlValue = null | number | bigint | string | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export interface Statement {
  get(...params: SqlValue[]): SqlRow | undefined;
  all(...params: SqlValue[]): SqlRow[];
  run(...params: SqlValue[]): { changes: number };
}

export interface Db {
  readonly driver: 'node' | 'durable-object';
  prepare(sql: string): Statement;
  /** Runs one or more statements without parameters. */
  exec(sql: string): void;
  /** Runs `fn` atomically; nested calls join the outer transaction. Keep `fn` synchronous. */
  transaction<T>(fn: () => T): T;
  /** Number of migrations applied (0 for a database that never recorded one). */
  getSchemaVersion(): number;
  setSchemaVersion(v: number): void;
  close(): void;
}

/** Number of migrations; an up-to-date database records exactly this many. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/** Applies every migration the database has not seen yet, each in its own transaction. */
export function migrate(db: Db): number {
  const from = currentVersion(db);
  for (let v = from; v < MIGRATIONS.length; v++) {
    try {
      db.transaction(() => {
        MIGRATIONS[v]!(db);
        db.setSchemaVersion(v + 1);
      });
    } catch (err) {
      throw new Error(`Database migration ${v + 1} failed: ${(err as Error).message}`);
    }
  }
  return MIGRATIONS.length - from;
}

/** Creates/updates the GymVerse built-in exercise library (shared by all gyms). */
function syncBuiltInExercises(db: Db): void {
  const upsert = db.prepare(
    `INSERT INTO exercises (id, gym_id, name, muscle_group, equipment, instructions, video_url, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, NULL, '2026-01-01T00:00:00.000Z')
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, muscle_group = excluded.muscle_group,
       equipment = excluded.equipment, instructions = excluded.instructions`,
  );
  db.transaction(() => {
    for (const e of BUILT_IN_EXERCISES) {
      upsert.run(e.id, e.name, e.muscleGroup, e.equipment, JSON.stringify(e.instructions));
    }
  });
}

/** Migrations, then the built-in exercise library. Idempotent; safe on new, v0.1, v0.2 and current databases. */
export function initDb(db: Db): Db {
  migrate(db);
  syncBuiltInExercises(db);
  return db;
}

/** Runs `fn` inside a transaction. Both drivers are synchronous, so keep `fn` sync. */
export function tx<T>(db: Db, fn: () => T): T {
  return db.transaction(fn);
}

/** For /health/ready. */
export function ping(db: Db): boolean {
  try {
    return (db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
  } catch {
    return false;
  }
}
