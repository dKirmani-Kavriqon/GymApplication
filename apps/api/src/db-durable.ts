/// <reference types="@cloudflare/workers-types" />
import type { Db, SqlRow, SqlValue } from './db';

/**
 * A Durable Object's built-in SQLite. Its `sql.exec` is synchronous like node:sqlite, so the
 * whole API runs unchanged. Differences handled here:
 *   - transactions go through `storage.transactionSync` (BEGIN/COMMIT are not allowed)
 *   - PRAGMA user_version is not allowed, so the schema version lives in `_gymverse_meta`
 *   - bigint parameters are not accepted, so they are converted to numbers
 * Foreign keys are always on.
 */
export function durableObjectDb(storage: DurableObjectStorage): Db {
  const sql = storage.sql;
  const params = (p: SqlValue[]) => p.map((v) => (typeof v === 'bigint' ? Number(v) : v));
  const rows = (query: string, p: SqlValue[]) => sql.exec(query, ...params(p)).toArray() as SqlRow[];

  sql.exec('CREATE TABLE IF NOT EXISTS _gymverse_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

  return {
    driver: 'durable-object',
    prepare(query) {
      return {
        get: (...p) => rows(query, p)[0],
        all: (...p) => rows(query, p),
        run: (...p) => {
          rows(query, p);
          return {
            changes: Number((sql.exec('SELECT changes() AS c').one() as { c: number }).c),
          };
        },
      };
    },
    exec(query) {
      sql.exec(query).toArray();
    },
    transaction: (fn) => storage.transactionSync(fn),
    getSchemaVersion() {
      const r = sql.exec("SELECT value FROM _gymverse_meta WHERE key = 'schema_version'").toArray()[0] as { value: string } | undefined;
      return r ? Number(r.value) : 0;
    },
    setSchemaVersion(v) {
      sql.exec(
        "INSERT INTO _gymverse_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        String(v),
      );
    },
    close() {
      // The platform owns the database's lifetime.
    },
  };
}
