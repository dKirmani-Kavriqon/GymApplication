import { serve, type ServerType } from '@hono/node-server';
import { ConfigError, describeConfig, loadConfig, type Config } from './config';
import { createServer } from './bootstrap';

/**
 * Node server: local development and self-hosting. On Cloudflare the entry is src/worker.ts.
 * All settings come from config.ts; nothing else here reads process.env.
 */
let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`GymVerse API not started. ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const { app, jobs, shutdown } = createServer(config);
app.log.info({ config: describeConfig(config) }, 'starting');

const server: ServerType = serve(
  {
    fetch: (request, env: { incoming?: { socket?: { remoteAddress?: string } } }) =>
      app.fetch(request, { ip: env.incoming?.socket?.remoteAddress }),
    port: config.port,
    hostname: config.host,
  },
  (info) => {
    app.log.info({ port: info.port }, 'listening');
    if (config.jobsEnabled) jobs.start();
  },
);
server.on('error', (err) => {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    // Stop accepting connections first, then let in-flight requests finish.
    server.close();
    shutdown(signal).then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
