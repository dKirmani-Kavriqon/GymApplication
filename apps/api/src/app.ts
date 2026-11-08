import type { DatabaseSync } from 'node:sqlite';
import { createApp, type GymVerseApp } from './core';
import type { AppOptions } from './context';
import { asDb, openRawDb } from './db-node';
import type { Db } from './db';

/**
 * Node entry to the API (local development, tests, self-hosting): opens node:sqlite and builds
 * the app. Cloudflare uses `createApp` from ./core directly, inside the Durable Object.
 */

export { createApp, safeUrl, redactLog, BODY_LIMIT, IMPORT_BODY_LIMIT, type GymVerseApp } from './core';
export type { AppOptions } from './context';

export type NodeAppOptions = Omit<AppOptions, 'db'> & {
  db?: Db | DatabaseSync;
};

export function buildApp(opts: NodeAppOptions = {}): GymVerseApp {
  const db = opts.db ? asDb(opts.db) : openRawDb(opts.dbPath);
  return createApp(db, { ...opts, db });
}
