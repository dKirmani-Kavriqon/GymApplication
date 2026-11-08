import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { App, RequestError } from '../src/http';
import { createLogger } from '../src/log';

describe('http framework', () => {
  it('prefers static segments over params, whatever the registration order', async () => {
    const app = new App();
    app.get('/gyms/:gymId/members', async (req) => ({ route: 'members', gymId: req.params.gymId }));
    app.get('/gyms/preview/:code', async (req) => ({ route: 'preview', code: req.params.code }));
    assert.deepEqual((await app.inject({ url: '/gyms/preview/members' })).json(), { route: 'preview', code: 'members' });
    assert.deepEqual((await app.inject({ url: '/gyms/g%201/members' })).json(), { route: 'members', gymId: 'g 1' });
    assert.equal((await app.inject({ url: '/gyms//members' })).statusCode, 404, 'empty params never match');
  });

  it('parses queries (repeated keys become arrays) and answers HEAD from GET routes without a body', async () => {
    const app = new App();
    app.get('/q', async (req) => req.query);
    assert.deepEqual((await app.inject({ url: '/q?a=1&b=2&b=3' })).json(), { a: '1', b: ['2', '3'] });
    const head = await app.inject({ method: 'HEAD', url: '/q' });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, '');
  });

  it('serialises strings, bytes, objects and reply.send, and keeps a content type the handler set', async () => {
    const app = new App();
    app.get('/text', async () => 'hello');
    app.get('/bytes', async () => new Uint8Array([104, 105]));
    app.get('/html', async (_req, reply) => reply.type('text/html; charset=utf-8').send('<p>hi</p>'));
    app.post('/created', async (_req, reply) => reply.code(201).header('x-a', '1').send({ ok: true }));
    app.delete('/empty', async (_req, reply) => reply.status(204).send());
    const text = await app.inject({ url: '/text' });
    assert.deepEqual([text.body, text.headers['content-type']], ['hello', 'text/plain; charset=utf-8']);
    const bytes = await app.inject({ url: '/bytes' });
    assert.deepEqual([bytes.body, bytes.headers['content-type']], ['hi', 'application/octet-stream']);
    assert.equal((await app.inject({ url: '/html' })).headers['content-type'], 'text/html; charset=utf-8');
    const created = await app.inject({ method: 'POST', url: '/created' });
    assert.deepEqual([created.statusCode, created.headers['x-a'], created.json()], [201, '1', { ok: true }]);
    assert.equal((await app.inject({ method: 'DELETE', url: '/empty' })).statusCode, 204);
  });

  it('parses JSON and text bodies, refuses other media types and keeps the raw bytes', async () => {
    const app = new App({ bodyLimit: 64 });
    let raw = '';
    app.post('/echo', async (req) => {
      raw = new TextDecoder().decode(req.rawBody);
      return { body: req.body ?? null };
    });
    app.put('/big', { bodyLimit: 1024 }, async (req) => ({ size: req.rawBody.byteLength }));
    app.setErrorHandler((err, _req, reply) => reply.status((err as RequestError).statusCode ?? 500).send({ message: (err as Error).message }));
    assert.deepEqual((await app.inject({ method: 'POST', url: '/echo', payload: { a: 1 } })).json(), { body: { a: 1 } });
    assert.equal(raw, '{"a":1}');
    assert.deepEqual((await app.inject({ method: 'POST', url: '/echo', payload: 'plain', headers: { 'content-type': 'text/plain' } })).json(), {
      body: 'plain',
    });
    assert.deepEqual((await app.inject({ method: 'POST', url: '/echo' })).json(), { body: null }, 'no body is undefined');
    const xml = await app.inject({ method: 'POST', url: '/echo', payload: '<a/>', headers: { 'content-type': 'application/xml' } });
    assert.equal(xml.statusCode, 415);
    assert.equal((await app.inject({ method: 'POST', url: '/echo', payload: 'x'.repeat(65), headers: { 'content-type': 'text/plain' } })).statusCode, 413);
    assert.deepEqual((await app.inject({ method: 'PUT', url: '/big', payload: 'x'.repeat(500), headers: { 'content-type': 'text/plain' } })).json(), {
      size: 500,
    });
  });

  it('refuses a streamed body past the limit even without a content length', async () => {
    const app = new App({ bodyLimit: 10 });
    app.post('/s', async () => ({ ok: true }));
    app.setErrorHandler((err, _req, reply) => reply.status((err as RequestError).statusCode).send({}));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(8));
        c.enqueue(new Uint8Array(8));
        c.close();
      },
    });
    const res = await app.fetch(new Request('http://x/s', { method: 'POST', body, duplex: 'half' } as RequestInit));
    assert.equal(res.status, 413);
  });

  it('answers CORS preflights for allowed origins only', async () => {
    const app = new App({ cors: { origin: ['https://app.example.com'], methods: ['GET', 'PATCH'], exposedHeaders: ['x-request-id'] } });
    app.get('/me', async () => ({ ok: true }));
    const pre = await app.inject({
      method: 'OPTIONS',
      url: '/me',
      headers: { origin: 'https://app.example.com', 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization' },
    });
    assert.equal(pre.statusCode, 204);
    assert.equal(pre.headers['access-control-allow-origin'], 'https://app.example.com');
    assert.equal(pre.headers['access-control-allow-methods'], 'GET, PATCH');
    assert.equal(pre.headers['access-control-allow-headers'], 'authorization');
    const get = await app.inject({ url: '/me', headers: { origin: 'https://app.example.com' } });
    assert.equal(get.headers['access-control-expose-headers'], 'x-request-id');
    const evil = await app.inject({ url: '/me', headers: { origin: 'https://evil.example' } });
    assert.equal(evil.headers['access-control-allow-origin'], undefined);
  });

  it('lets onRequest hooks answer early, survives failing hooks and error handlers', async () => {
    const lines: string[] = [];
    const app = new App({ logger: { level: 'info', write: (l) => void lines.push(l) } });
    app.addHook('onRequest', async (req, reply) => {
      if (req.headers['x-block']) reply.status(403).send({ blocked: true });
    });
    app.addHook('onSend', async () => {
      throw new Error('hook broke');
    });
    app.get('/ok', async () => ({ ok: true }));
    app.get('/crash', async () => {
      throw new Error('first');
    });
    app.setErrorHandler(() => {
      throw new Error('second');
    });
    assert.deepEqual((await app.inject({ url: '/ok', headers: { 'x-block': '1' } })).json(), { blocked: true });
    assert.deepEqual((await app.inject({ url: '/ok' })).json(), { ok: true }, 'a broken onSend hook is logged, not fatal');
    const crash = await app.inject({ url: '/crash' });
    assert.equal(crash.statusCode, 500);
    assert.equal(crash.json().error, 'internal');
    assert.ok(lines.some((l) => l.includes('error handler failed')));
    assert.ok(lines.some((l) => l.includes('onSend hook failed')));
  });

  it('uses the default not-found and error answers, and X-Forwarded-For only when trusted', async () => {
    const app = new App();
    app.get('/ip', async (req) => ({ ip: req.ip }));
    app.get('/boom', async () => {
      throw new Error('nope');
    });
    assert.deepEqual((await app.inject({ url: '/missing' })).json(), { error: 'not_found', message: 'Not found' });
    assert.equal((await app.inject({ url: '/boom' })).statusCode, 500);
    assert.deepEqual((await app.inject({ url: '/ip', headers: { 'x-forwarded-for': '1.2.3.4' }, remoteAddress: '10.0.0.1' })).json(), { ip: '10.0.0.1' });
    const trusted = new App({ trustProxy: true });
    trusted.get('/ip', async (req) => ({ ip: req.ip }));
    assert.deepEqual((await trusted.inject({ url: '/ip', headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } })).json(), { ip: '1.2.3.4' });
  });

  it('close() waits for in-flight requests', async () => {
    const app = new App();
    let release!: () => void;
    app.get('/slow', () => new Promise((r) => (release = () => r({ done: true }))));
    const pending = app.inject({ url: '/slow' });
    await new Promise((r) => setTimeout(r, 5));
    let closed = false;
    const closing = app.close().then(() => (closed = true));
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(closed, false);
    assert.equal(app.isClosed, true);
    release();
    await pending;
    await closing;
    assert.equal(closed, true);
    await app.close();
  });
});

describe('logger', () => {
  it('writes pino-shaped lines above the level, with bindings and serialised errors', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'warn', write: (l) => void lines.push(l) }).child({ reqId: 'r1' });
    log.info('hidden');
    log.warn('plain');
    log.error(new Error('bad'));
    log.error({ err: new Error('inner'), extra: 1 }, 'with fields');
    log.fatal({ n: 1 });
    const parsed = lines.map((l) => JSON.parse(l));
    assert.equal(parsed.length, 4);
    assert.deepEqual([parsed[0].level, parsed[0].msg, parsed[0].reqId], [40, 'plain', 'r1']);
    assert.equal(parsed[1].err.message, 'bad');
    assert.deepEqual([parsed[2].err.message, parsed[2].extra], ['inner', 1]);
    assert.equal(parsed[3].level, 60);
    for (const l of lines) assert.ok(l.endsWith('\n'));
  });

  it('never throws when the sink fails, and is silent when asked', () => {
    const log = createLogger({
      write: () => {
        throw new Error('disk full');
      },
    });
    log.info('ignored');
    log.trace('below default level');
    const silent = createLogger({ level: 'silent', write: () => assert.fail('silent logged') });
    silent.fatal('nothing');
  });
});
