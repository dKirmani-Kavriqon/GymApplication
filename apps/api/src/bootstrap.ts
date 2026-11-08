import type { Config } from './config';
import type { GymVerseApp } from './core';
import { openRawDb } from './db-node';
import type { Jobs } from './jobs';
import { appFromConfig, type WireDeps } from './wiring';

export interface ServerParts {
  app: GymVerseApp;
  jobs: Jobs;
  /** Stops jobs, waits for in-flight requests (max `graceMs`), flushes push, closes the DB. The caller stops the listener. */
  shutdown(signal: string, graceMs?: number): Promise<void>;
}

/** Node: opens the database file and wires providers from config. `deps` lets tests swap the network and the logger. */
export function createServer(config: Config, deps: WireDeps = {}): ServerParts {
  const { app, jobs } = appFromConfig(openRawDb(config.dbPath), config, deps);

  let closing: Promise<void> | null = null;
  function shutdown(signal: string, graceMs = 10_000): Promise<void> {
    if (closing) return closing;
    closing = (async () => {
      app.log.info({ signal }, 'shutting down');
      jobs.stop();
      const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), graceMs).unref());
      const result = await Promise.race([app.close().then(() => 'closed' as const), timeout]);
      if (result === 'timeout') app.log.warn({ graceMs }, 'in-flight requests did not finish in time');
      await app.flushPush().catch(() => undefined);
      try {
        app.db.close();
      } catch {
        // already closed
      }
    })();
    return closing;
  }

  return { app, jobs, shutdown };
}
