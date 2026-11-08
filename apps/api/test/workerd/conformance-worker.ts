/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';
import { durableObjectDb } from '../../src/db-durable';
import { driverChecks } from '../driver-conformance';

/**
 * Runs test/driver-conformance.ts inside workerd against a real Durable Object SQLite database.
 * Each check gets its own object, so each starts from an empty database.
 */
export class Conformance extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
    let used = false;
    const checks = driverChecks(() => {
      if (used) throw new Error('a check may open only one fresh database');
      used = true;
      return durableObjectDb(this.ctx.storage);
    });
    const check = checks[name];
    if (!check) return Response.json({ ok: false, error: `unknown check ${name}` }, { status: 404 });
    try {
      check();
      return Response.json({ ok: true });
    } catch (err) {
      return Response.json({ ok: false, error: (err as Error).stack ?? String(err) });
    }
  }
}

export default {
  async fetch(request: Request, env: { CONFORMANCE: DurableObjectNamespace<Conformance> }): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return Response.json(Object.keys(driverChecks(() => { throw new Error('listing only'); })));
    }
    const id = env.CONFORMANCE.idFromName(`${url.pathname}:${url.searchParams.get('run') ?? ''}`);
    return env.CONFORMANCE.get(id).fetch(request);
  },
};
