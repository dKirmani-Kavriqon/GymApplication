import { DatabaseSync } from 'node:sqlite';
import { initDb, type Db, type SqlRow, type SqlValue } from './db';

/** Wraps a node:sqlite database. Nested transactions use savepoints. */
export function nodeDb(raw: DatabaseSync): Db {
  let depth = 0;
  return {
    driver: 'node',
    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        get: (...p: SqlValue[]) => stmt.get(...p) as SqlRow | undefined,
        all: (...p: SqlValue[]) => stmt.all(...p) as SqlRow[],
        run: (...p: SqlValue[]) => ({
          changes: Number(stmt.run(...p).changes),
        }),
      };
    },
    exec: (sql) => raw.exec(sql),
    transaction<T>(fn: () => T): T {
      const sp = `sp_${depth}`;
      raw.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
      depth++;
      try {
        const out = fn();
        depth--;
        raw.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
        return out;
      } catch (err) {
        depth--;
        raw.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw err;
      }
    },
    getSchemaVersion: () => (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    setSchemaVersion: (v) => raw.exec(`PRAGMA user_version = ${Math.trunc(v)}`),
    close: () => raw.close(),
  };
}

/** Opens a database file (or an in-memory database) with the connection settings, without migrating. */
export function openRawDb(path = ':memory:'): Db {
  const raw = new DatabaseSync(path);
  // WAL lets readers run while a write is in progress; it is a no-op for in-memory databases.
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA busy_timeout = 5000');
  raw.exec('PRAGMA synchronous = NORMAL');
  raw.exec('PRAGMA foreign_keys = ON');
  return nodeDb(raw);
}

/** Opens and migrates a database file, or an in-memory database. */
export function openDb(path = ':memory:'): Db {
  return initDb(openRawDb(path));
}

/** Accepts either driver-neutral `Db` or a raw node:sqlite database (older callers, tests). */
export function asDb(db: Db | DatabaseSync): Db {
  if (db instanceof DatabaseSync) {
    db.exec('PRAGMA foreign_keys = ON');
    return nodeDb(db);
  }
  return db;
}
