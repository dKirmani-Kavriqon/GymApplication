/**
 * `npm run test:worker`: proves the API on the real Cloudflare runtime (workerd), locally.
 *   1. the database driver checks inside a Durable Object
 *   2. the staging Worker (wrangler.jsonc, env staging) with the end-to-end smoke test
 * Exits non-zero on any failure. Uses an in-memory local runtime; nothing is deployed.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_startWorker } from 'wrangler';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, '..', '..');
let failed = 0;

async function start(config: string, env?: string, vars: Record<string, string> = {}) {
  const worker = await unstable_startWorker({
    config,
    env,
    dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, persist: false, watch: false, logLevel: 'warn' },
    bindings: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, { type: 'plain_text', value: v }])),
  });
  await worker.ready;
  return worker;
}

// 1. Driver conformance
const conformance = await start(join(here, 'wrangler.jsonc'));
try {
  const run = Date.now().toString();
  const names = (await (await conformance.fetch('http://x/')).json()) as string[];
  for (const name of names) {
    const res = (await (await conformance.fetch(`http://x/${encodeURIComponent(name)}?run=${run}`)).json()) as { ok: boolean; error?: string };
    if (res.ok) console.log(`ok - durable object driver: ${name}`);
    else {
      failed++;
      console.error(`not ok - durable object driver: ${name}\n${res.error}`);
    }
  }
} finally {
  await conformance.dispose();
}

// 2. The real API Worker (staging settings) + smoke test over HTTP
if (!failed) {
  const api = await start(join(apiDir, 'wrangler.jsonc'), 'staging', { TOKEN_SECRET: 'workerd-test-secret-0123456789abcdef' });
  try {
    const url = (await api.url).toString();
    console.log(`API Worker at ${url}`);
    // Async: the local runtime's proxy lives in this process and must keep serving while the smoke test runs.
    const code = await new Promise<number | null>((resolve) => {
      spawn(process.execPath, ['--import', 'tsx', join(apiDir, 'scripts', 'smoke.ts'), url], { stdio: 'inherit', cwd: apiDir }).on('exit', resolve);
    });
    if (code !== 0) failed++;
  } finally {
    await api.dispose();
  }
}

if (failed) {
  console.error(`\n${failed} workerd check(s) failed`);
  process.exit(1);
}
console.log('\nAll workerd checks passed');
