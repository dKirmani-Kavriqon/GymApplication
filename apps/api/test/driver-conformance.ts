import assert from 'node:assert/strict';
import { SCHEMA_VERSION, initDb, tx, type Db } from '../src/db';
import { seedDemo } from '../src/demo-seed';

/**
 * The same checks run against both database drivers: node:sqlite (test/db-driver.test.ts) and a
 * Durable Object's SQLite inside workerd (test/workerd/, `npm run test:worker`). If a driver
 * behaves differently from the other in any way the API relies on, one of these fails.
 * `fresh()` must return a new, empty database each call.
 */
export function driverChecks(fresh: () => Db): Record<string, () => void> {
  const table = (db: Db) => {
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, f REAL, s TEXT, b BLOB)');
    return db;
  };
  return {
    'runs several statements in one exec': () => {
      const db = fresh();
      db.exec('CREATE TABLE a (id TEXT); CREATE TABLE b (id TEXT); INSERT INTO a VALUES (1);');
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM a').get() as { n: number }).n, 1);
      assert.deepEqual(db.prepare('SELECT * FROM b').all(), []);
    },

    'get, all and value types': () => {
      const db = table(fresh());
      db.prepare('INSERT INTO t VALUES (?, ?, ?, ?, ?)').run('x', 5, 1.5, null, new Uint8Array([1, 2, 3]));
      db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').run('y', 10n);
      const x = db.prepare('SELECT * FROM t WHERE id = ?').get('x')!;
      assert.deepEqual([x.id, x.n, x.f, x.s], ['x', 5, 1.5, null]);
      assert.deepEqual([...new Uint8Array(x.b as ArrayBuffer | Uint8Array)], [1, 2, 3]);
      assert.equal(db.prepare('SELECT n FROM t WHERE id = ?').get('y')!.n, 10, 'bigint parameters are stored as numbers');
      assert.equal(db.prepare('SELECT * FROM t WHERE id = ?').get('none'), undefined);
      assert.deepEqual(
        db.prepare('SELECT id FROM t ORDER BY id').all().map((r) => r.id),
        ['x', 'y'],
      );
    },

    'run reports changed rows': () => {
      const db = table(fresh());
      assert.equal(db.prepare("INSERT INTO t (id, n) VALUES ('a', 1), ('b', 2)").run().changes, 2);
      assert.equal(db.prepare("INSERT OR IGNORE INTO t (id, n) VALUES ('a', 9)").run().changes, 0);
      assert.equal(db.prepare('UPDATE t SET n = n + 1').run().changes, 2);
      assert.equal(db.prepare("UPDATE t SET n = 0 WHERE id = 'zzz'").run().changes, 0);
      assert.equal(db.prepare("DELETE FROM t WHERE id = 'a'").run().changes, 1);
    },

    'transactions commit, roll back on error, and nest': () => {
      const db = table(fresh());
      tx(db, () => db.prepare("INSERT INTO t (id) VALUES ('kept')").run());
      assert.throws(() =>
        tx(db, () => {
          db.prepare("INSERT INTO t (id) VALUES ('gone')").run();
          throw new Error('boom');
        }),
      );
      tx(db, () => {
        db.prepare("INSERT INTO t (id) VALUES ('outer')").run();
        try {
          tx(db, () => {
            db.prepare("INSERT INTO t (id) VALUES ('inner')").run();
            throw new Error('inner fails');
          });
        } catch {
          // the outer transaction carries on without the inner one's writes
        }
      });
      assert.deepEqual(
        db.prepare('SELECT id FROM t ORDER BY id').all().map((r) => r.id),
        ['kept', 'outer'],
      );
      assert.equal(tx(db, () => 42), 42, 'returns the callback value');
    },

    'constraint errors surface as errors': () => {
      const db = table(fresh());
      db.prepare("INSERT INTO t (id) VALUES ('dup')").run();
      assert.throws(() => db.prepare("INSERT INTO t (id) VALUES ('dup')").run(), /UNIQUE|constraint/i);
    },

    'foreign keys are enforced and cascade': () => {
      const db = fresh();
      db.exec('CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE c (id TEXT PRIMARY KEY, p_id TEXT NOT NULL REFERENCES p(id) ON DELETE CASCADE)');
      assert.throws(() => db.prepare("INSERT INTO c VALUES ('c1', 'missing')").run(), /FOREIGN KEY/i);
      db.exec("INSERT INTO p VALUES ('p1'); INSERT INTO c VALUES ('c1', 'p1')");
      db.prepare("DELETE FROM p WHERE id = 'p1'").run();
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM c').get() as { n: number }).n, 0);
    },

    'later columns win when a join repeats a name': () => {
      const db = fresh();
      db.exec("CREATE TABLE l (id TEXT, v TEXT); CREATE TABLE r (id TEXT, v TEXT); INSERT INTO l VALUES ('1', 'left'); INSERT INTO r VALUES ('1', 'right')");
      const row = db.prepare('SELECT l.*, r.v FROM l JOIN r ON r.id = l.id').get()!;
      assert.equal(row.v, 'right');
    },

    'migrates an empty database to the current schema, idempotently': () => {
      const db = initDb(fresh());
      assert.equal(db.getSchemaVersion(), SCHEMA_VERSION);
      initDb(db);
      assert.equal(db.getSchemaVersion(), SCHEMA_VERSION);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
      for (const name of ['users', 'gyms', 'gym_members', 'payments', 'coupons', 'webhook_events', 'exercises']) assert.ok(tables.includes(name), name);
      assert.ok((db.prepare('SELECT COUNT(*) AS n FROM exercises WHERE gym_id IS NULL').get() as { n: number }).n >= 20);
    },

    'seeds the demo gym, and again without duplicating': () => {
      const db = initDb(fresh());
      const first = seedDemo(db, new Date('2026-11-08T04:30:00.000Z'));
      assert.equal(first.createdGym, true);
      const count = () => (db.prepare('SELECT COUNT(*) AS n FROM gym_members').get() as { n: number }).n;
      const members = count();
      assert.ok(members >= 3);
      assert.equal(seedDemo(db, new Date('2026-11-08T04:30:00.000Z')).createdGym, false);
      assert.equal(count(), members);
    },
  };
}
