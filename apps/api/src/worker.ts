/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';
import { timingSafeEqual } from 'node:crypto';
import { ConfigError, describeConfig, loadConfig, type Config } from './config';
import type { GymVerseApp } from './core';
import { durableObjectDb } from './db-durable';
import { seedDemo } from './demo-seed';
import type { Jobs } from './jobs';
import { appFromConfig } from './wiring';

/**
 * Cloudflare entry. The Worker is a thin front door; the whole API runs inside one Durable
 * Object (`GymVerseApi`) whose built-in SQLite database holds every gym. One object means one
 * writer, so rate limits and transactions behave exactly as on a single server, and Cloudflare
 * keeps 30 days of point-in-time recovery for its storage.
 *
 *   request → Worker (adds the client IP, answers /__ops) → GymVerseApi.fetch → app
 *   cron    → Worker.scheduled → GymVerseApi.tick (reminders, OTP pruning, push)
 */

export interface Env {
  GYMVERSE: DurableObjectNamespace<GymVerseApi>;
  /** Where the database object is first created (it stays there). Default `apac` (India). */
  LOCATION_HINT?: DurableObjectLocationHint;
  [key: string]: unknown;
}

/** Header the Worker sets with the client address; anything a client sends under this name is overwritten. */
const CLIENT_IP_HEADER = 'x-gymverse-client-ip';
/** Every request goes to this one object. Changing the name starts an empty database. */
const DATABASE_OBJECT = 'gymverse-primary';

const UNAVAILABLE = { error: 'unavailable', message: 'GymVerse is not available right now. Please try again shortly.' };

/** Only string bindings (vars and secrets) are configuration. */
function configEnv(env: Record<string, unknown>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') out[k] = v;
  return out;
}

export class GymVerseApi extends DurableObject<Env> {
  private app: GymVerseApp | null = null;
  private jobs: Jobs | null = null;
  private config: Config | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // Nothing else runs until the schema is migrated.
    void state.blockConcurrencyWhile(async () => {
      try {
        this.config = loadConfig(configEnv(env));
        const parts = appFromConfig(durableObjectDb(state.storage), this.config);
        this.app = parts.app;
        this.jobs = parts.jobs;
        if (this.config.demoSeed) seedDemo(parts.app.db);
        parts.app.log.info({ config: describeConfig(this.config) }, 'GymVerse API ready');
      } catch (err) {
        // Config problems name the variable, never its value.
        const detail = err instanceof ConfigError ? err.message : (err as Error).message;
        console.error(JSON.stringify({ level: 60, time: Date.now(), msg: 'GymVerse API not started', detail }));
      }
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (!this.app) return Response.json(UNAVAILABLE, { status: 503 });
    return this.app.fetch(request, { ip: request.headers.get(CLIENT_IP_HEADER) || undefined });
  }

  /** One scheduler tick (cron every 5 minutes), then sends the push notifications it queued. */
  async tick(at?: string): Promise<void> {
    if (!this.app || !this.jobs) return;
    this.jobs.tick(at ? new Date(at) : undefined);
    await this.app.flushPush();
  }

  /** Point-in-time recovery: the bookmark for `at` (or now). */
  async bookmark(at?: string): Promise<string> {
    return at ? this.ctx.storage.getBookmarkForTime(new Date(at)) : this.ctx.storage.getCurrentBookmark();
  }

  /**
   * Rolls the whole database back to `at` (within the last 30 days). Takes effect when the object
   * restarts, which this triggers. Returns a bookmark that undoes the restore.
   */
  async restore(at: string): Promise<{ restoredTo: string; undo: string }> {
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) throw new Error('`at` must be an ISO date-time');
    const target = await this.ctx.storage.getBookmarkForTime(when);
    const undo = await this.ctx.storage.onNextSessionRestoreBookmark(target);
    // Restart after the response has gone out.
    setTimeout(() => this.ctx.abort('restoring to an earlier point in time'), 50);
    return { restoredTo: when.toISOString(), undo };
  }

  /** Restores a bookmark returned earlier (e.g. the `undo` from `restore`). */
  async restoreBookmark(bookmark: string): Promise<{ undo: string }> {
    const undo = await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
    setTimeout(() => this.ctx.abort('restoring a bookmark'), 50);
    return { undo };
  }
}

function database(env: Env): DurableObjectStub<GymVerseApi> {
  const id = env.GYMVERSE.idFromName(DATABASE_OBJECT);
  return env.GYMVERSE.get(id, { locationHint: env.LOCATION_HINT ?? 'apac' });
}

function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

/**
 * Operator endpoints, off unless OPS_TOKEN is set. Bearer OPS_TOKEN required.
 *   GET  /__ops/bookmark?at=ISO     bookmark for a time (or now)
 *   POST /__ops/restore {at}        roll the database back to `at`
 *   POST /__ops/restore {bookmark}  restore a bookmark (undo a restore)
 */
async function handleOps(request: Request, env: Env, url: URL): Promise<Response> {
  const token = typeof env.OPS_TOKEN === 'string' && env.OPS_TOKEN.length >= 32 ? env.OPS_TOKEN : undefined;
  if (!token) return json({ error: 'not_found', message: 'Not found' }, 404);
  if (!bearerMatches(request.headers.get('authorization'), token)) return json({ error: 'unauthorized', message: 'Unauthorized' }, 401);
  const db = database(env);
  try {
    if (request.method === 'GET' && url.pathname === '/__ops/bookmark') {
      return json({ bookmark: await db.bookmark(url.searchParams.get('at') ?? undefined) });
    }
    if (request.method === 'POST' && url.pathname === '/__ops/restore') {
      const body = (await request.json().catch(() => ({}))) as { at?: unknown; bookmark?: unknown };
      if (typeof body.bookmark === 'string') return json(await db.restoreBookmark(body.bookmark));
      if (typeof body.at === 'string') return json(await db.restore(body.at));
      return json({ error: 'validation', message: 'Send {"at": "<ISO time>"} or {"bookmark": "<bookmark>"}' }, 400);
    }
  } catch (err) {
    return json({ error: 'ops_failed', message: (err as Error).message }, 400);
  }
  return json({ error: 'not_found', message: 'Not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__ops/')) return handleOps(request, env, url);
    const headers = new Headers(request.headers);
    headers.set(CLIENT_IP_HEADER, request.headers.get('cf-connecting-ip') ?? '');
    try {
      return await database(env).fetch(new Request(request, { headers }));
    } catch (err) {
      // The object restarting (deploy, restore) or overloaded: answer like the app would.
      console.error(JSON.stringify({ level: 50, time: Date.now(), msg: 'database object unavailable', err: (err as Error).message }));
      return Response.json(UNAVAILABLE, { status: 503, headers: { 'retry-after': '5' } });
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(database(env).tick(new Date(controller.scheduledTime).toISOString()));
  },
} satisfies ExportedHandler<Env>;
