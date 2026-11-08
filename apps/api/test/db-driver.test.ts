import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { asDb, nodeDb, openRawDb } from '../src/db-node';
import { ping } from '../src/db';
import { driverChecks } from './driver-conformance';

describe('node:sqlite driver (same checks as the Durable Object driver)', () => {
  for (const [name, check] of Object.entries(driverChecks(() => openRawDb(':memory:')))) it(name, check);
});

describe('node:sqlite driver specifics', () => {
  it('wraps a raw database with foreign keys on, and passes a Db through', () => {
    const raw = new DatabaseSync(':memory:');
    const db = asDb(raw);
    assert.equal(db.driver, 'node');
    assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);
    assert.equal(asDb(db), db);
    const plain = nodeDb(new DatabaseSync(':memory:'));
    plain.setSchemaVersion(7);
    assert.equal(plain.getSchemaVersion(), 7);
  });

  it('reports an unavailable database to the readiness probe', () => {
    const db = openRawDb(':memory:');
    assert.equal(ping(db), true);
    db.close();
    assert.equal(ping(db), false);
  });
});
