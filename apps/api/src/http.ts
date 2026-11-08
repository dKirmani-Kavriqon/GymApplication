import { createLogger, silentLogger, type Logger, type LoggerConfig } from './log';

/**
 * A small web framework on the standard Request/Response API, so the same app runs on Node (via
 * @hono/node-server) and inside a Cloudflare Durable Object. It keeps the subset of Fastify's API
 * the routes use (`app.get(path, handler)`, `reply.status().send()`, hooks, an error handler and
 * `inject()` for tests), so route modules did not need rewriting when the API moved off Fastify.
 *
 * Routing matches Fastify: a static segment beats a `:param` at the same position, whatever the
 * registration order (`/gyms/preview/:code` wins over `/gyms/:gymId/members`).
 */

export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export interface Req {
  id: string;
  method: string;
  /** Path plus query string, as sent. */
  url: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  headers: Record<string, string | undefined>;
  body: unknown;
  /** The exact request bytes (webhook signatures are computed over these). */
  rawBody: Uint8Array;
  ip: string;
  log: Logger;
}

export interface Reply {
  statusCode: number;
  sent: boolean;
  status(code: number): Reply;
  code(code: number): Reply;
  header(name: string, value: string): Reply;
  getHeader(name: string): string | undefined;
  removeHeader(name: string): Reply;
  type(contentType: string): Reply;
  send(payload?: unknown): Reply;
}

export type Handler = (req: Req, reply: Reply) => unknown;
export type ErrorHandler = (err: unknown, req: Req, reply: Reply) => unknown;
export type OnRequestHook = (req: Req, reply: Reply) => unknown;
export type OnSendHook = (req: Req, reply: Reply, payload: string | Uint8Array | null) => unknown;

export interface RouteOptions {
  /** Largest accepted body in bytes (default: the app's bodyLimit). */
  bodyLimit?: number;
}

export interface CorsOptions {
  /** `true` reflects any origin (development); otherwise the allowed origins. */
  origin: true | string[];
  methods: string[];
  exposedHeaders: string[];
}

export interface AppConfig {
  logger?: LoggerConfig | false;
  bodyLimit?: number;
  /** Use the left-most X-Forwarded-For address as the client IP. */
  trustProxy?: boolean;
  genReqId?: (header: string | undefined) => string;
  cors?: CorsOptions;
  /** What the request/response log lines contain. */
  serializeReq?: (req: Req) => Record<string, unknown>;
}

export interface FetchInfo {
  /** Client address as seen by the platform (socket address on Node, CF-Connecting-IP on Workers). */
  ip?: string;
}

export interface InjectOptions {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
  remoteAddress?: string;
}

export interface InjectResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  json<T = any>(): T;
}

/** An error carrying an HTTP status (body too large, bad JSON…), answered by the error handler. */
export class RequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  opts: RouteOptions;
}

const BODYLESS = new Set(['GET', 'HEAD', 'OPTIONS']);

function splitPath(path: string): string[] {
  return path.split('/').slice(1);
}

/** Static segments score higher than params at the same position; the best-scoring route wins. */
function match(routes: Route[], method: string, segments: string[]): { route: Route; params: Record<string, string> } | null {
  let best: {
    route: Route;
    params: Record<string, string>;
    score: number[];
  } | null = null;
  for (const route of routes) {
    if (route.method !== method || route.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const score: number[] = [];
    let ok = true;
    for (let i = 0; i < segments.length; i++) {
      const want = route.segments[i]!;
      const got = segments[i]!;
      if (want.startsWith(':')) {
        if (!got) {
          ok = false;
          break;
        }
        try {
          params[want.slice(1)] = decodeURIComponent(got);
        } catch {
          params[want.slice(1)] = got;
        }
        score.push(0);
      } else if (want === got) score.push(1);
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (!best || compareScore(score, best.score) > 0) best = { route, params, score };
  }
  return best && { route: best.route, params: best.params };
}

function compareScore(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

function parseQuery(search: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of search) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

/**
 * Past the limit, up to this many bytes are read and thrown away so the client gets a clean 413
 * (answering mid-upload makes many clients report a dropped connection instead). Beyond it the
 * connection is cut.
 */
const DRAIN_LIMIT = 8 * 1024 * 1024;

/** Reads the body, refusing more than `limit` bytes without buffering the excess. */
async function readBody(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);
  const declared = Number(request.headers.get('content-length') ?? '');
  const reader = request.body.getReader();
  const tooLarge = async (seen: number) => {
    let drained = seen;
    while (drained <= DRAIN_LIMIT) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done || !value) return new RequestError(413, 'Request body is too large');
      drained += value.byteLength;
    }
    await reader.cancel().catch(() => undefined);
    return new RequestError(413, 'Request body is too large');
  };
  if (Number.isFinite(declared) && declared > limit) throw await tooLarge(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) throw await tooLarge(size);
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function parseBody(raw: Uint8Array, contentType: string | undefined): unknown {
  if (!raw.byteLength) return undefined;
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  const text = new TextDecoder().decode(raw);
  if (type === 'application/json' || type.endsWith('+json')) {
    try {
      return JSON.parse(text);
    } catch {
      throw new RequestError(400, 'Body is not valid JSON');
    }
  }
  if (type === 'text/plain' || type === '') return text;
  throw new RequestError(415, `Unsupported Media Type: ${type}`);
}

class ReplyImpl implements Reply {
  statusCode = 200;
  sent = false;
  payload: unknown = undefined;
  readonly headers = new Map<string, string>();

  status(code: number) {
    this.statusCode = code;
    return this;
  }
  code(code: number) {
    return this.status(code);
  }
  header(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }
  getHeader(name: string) {
    return this.headers.get(name.toLowerCase());
  }
  removeHeader(name: string) {
    this.headers.delete(name.toLowerCase());
    return this;
  }
  type(contentType: string) {
    return this.header('content-type', contentType);
  }
  send(payload?: unknown) {
    this.payload = payload;
    this.sent = true;
    return this;
  }
}

/** Turns a handler result into bytes, setting a content type when the handler did not. */
function serialize(reply: ReplyImpl, value: unknown): string | Uint8Array | null {
  if (value === undefined) return null;
  if (value instanceof Uint8Array) {
    if (!reply.getHeader('content-type')) reply.type('application/octet-stream');
    return value;
  }
  if (typeof value === 'string') {
    if (!reply.getHeader('content-type')) reply.type('text/plain; charset=utf-8');
    return value;
  }
  if (!reply.getHeader('content-type')) reply.type('application/json; charset=utf-8');
  return JSON.stringify(value);
}

export class App {
  readonly log: Logger;
  private readonly routes: Route[] = [];
  private readonly onRequestHooks: OnRequestHook[] = [];
  private readonly onSendHooks: OnSendHook[] = [];
  private errorHandler: ErrorHandler = (err, _req, reply) =>
    reply.status(500).send({
      error: 'internal',
      message: err instanceof Error ? err.message : 'error',
    });
  private notFoundHandler: Handler = (_req, reply) => reply.status(404).send({ error: 'not_found', message: 'Not found' });
  private inFlight = 0;
  private idle: Array<() => void> = [];
  private closed = false;

  constructor(private readonly config: AppConfig = {}) {
    this.log = config.logger === false || !config.logger ? silentLogger : createLogger(config.logger);
  }

  private add(method: Method, path: string, a: RouteOptions | Handler, b?: Handler): void {
    const handler = (typeof a === 'function' ? a : b)!;
    const opts = typeof a === 'function' ? {} : a;
    this.routes.push({ method, segments: splitPath(path), handler, opts });
  }

  get(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.add('GET', path, a, b);
  }
  post(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.add('POST', path, a, b);
  }
  put(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.add('PUT', path, a, b);
  }
  patch(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.add('PATCH', path, a, b);
  }
  delete(path: string, a: RouteOptions | Handler, b?: Handler) {
    this.add('DELETE', path, a, b);
  }

  addHook(name: 'onRequest', fn: OnRequestHook): void;
  addHook(name: 'onSend', fn: OnSendHook): void;
  addHook(name: 'onRequest' | 'onSend', fn: OnRequestHook | OnSendHook): void {
    if (name === 'onRequest') this.onRequestHooks.push(fn as OnRequestHook);
    else this.onSendHooks.push(fn as OnSendHook);
  }

  setErrorHandler(fn: ErrorHandler): void {
    this.errorHandler = fn;
  }

  setNotFoundHandler(fn: Handler): void {
    this.notFoundHandler = fn;
  }

  private clientIp(request: Request, info: FetchInfo): string {
    if (this.config.trustProxy) {
      const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
      if (fwd) return fwd;
    }
    return info.ip ?? '127.0.0.1';
  }

  private corsHeaders(request: Request, reply: ReplyImpl): void {
    const cors = this.config.cors;
    const origin = request.headers.get('origin');
    if (!cors || !origin) return;
    if (cors.origin !== true && !cors.origin.includes(origin)) return;
    reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'Origin');
    if (cors.exposedHeaders.length) reply.header('access-control-expose-headers', cors.exposedHeaders.join(', '));
  }

  /** Handles one request. Never throws: every failure becomes a response. */
  async fetch(request: Request, info: FetchInfo = {}): Promise<Response> {
    this.inFlight++;
    const started = Date.now();
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const id = this.config.genReqId?.(request.headers.get('x-request-id') ?? undefined) ?? crypto.randomUUID();
    const log = this.log.child({ reqId: id });
    const headers: Record<string, string | undefined> = {};
    request.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const req: Req = {
      id,
      method,
      url: url.pathname + url.search,
      path: url.pathname,
      params: {},
      query: parseQuery(url.searchParams),
      headers,
      body: undefined,
      rawBody: new Uint8Array(0),
      ip: this.clientIp(request, info),
      log,
    };
    const reply = new ReplyImpl();
    const describe = this.config.serializeReq ?? ((r: Req) => ({ method: r.method, url: r.url, ip: r.ip }));
    log.info({ req: describe(req) }, 'incoming request');

    let payload: string | Uint8Array | null = null;
    try {
      payload = await this.run(request, req, reply, method);
    } catch (err) {
      payload = await this.fail(err, req, reply);
    }
    for (const hook of this.onSendHooks) {
      try {
        const next = await hook(req, reply, payload);
        if (next !== undefined) payload = next as string | Uint8Array | null;
      } catch (err) {
        log.error({ err }, 'onSend hook failed');
      }
    }
    log.info(
      {
        res: { statusCode: reply.statusCode },
        responseTime: Date.now() - started,
      },
      'request completed',
    );
    const out = new Headers();
    for (const [k, v] of reply.headers) out.set(k, v);
    const noBody = method === 'HEAD' || reply.statusCode === 204 || reply.statusCode === 304;
    const response = new Response(noBody ? null : payload, {
      status: reply.statusCode,
      headers: out,
    });
    this.done();
    return response;
  }

  private async run(request: Request, req: Req, reply: ReplyImpl, method: string): Promise<string | Uint8Array | null> {
    this.corsHeaders(request, reply);
    if (method === 'OPTIONS' && this.config.cors && request.headers.get('access-control-request-method')) {
      reply.header('access-control-allow-methods', this.config.cors.methods.join(', '));
      const wanted = request.headers.get('access-control-request-headers');
      if (wanted) reply.header('access-control-allow-headers', wanted);
      reply.status(204);
      return null;
    }
    for (const hook of this.onRequestHooks) await hook(req, reply);
    if (reply.sent) return serialize(reply, reply.payload);

    const found = match(this.routes, method === 'HEAD' ? 'GET' : method, splitPath(req.path));
    if (!found) {
      const result = await this.notFoundHandler(req, reply);
      return serialize(reply, reply.sent || result === reply ? reply.payload : result);
    }
    req.params = found.params;
    if (!BODYLESS.has(method)) {
      req.rawBody = await readBody(request, found.route.opts.bodyLimit ?? this.config.bodyLimit ?? 1024 * 1024);
      req.body = parseBody(req.rawBody, req.headers['content-type']);
    } else if (request.body) {
      await request.body.cancel().catch(() => undefined);
    }
    const result = await found.route.handler(req, reply);
    return serialize(reply, reply.sent || result === reply ? reply.payload : result);
  }

  private async fail(err: unknown, req: Req, reply: ReplyImpl): Promise<string | Uint8Array | null> {
    reply.sent = false;
    reply.payload = undefined;
    reply.removeHeader('content-type');
    try {
      const result = await this.errorHandler(err, req, reply);
      return serialize(reply, reply.sent || result === reply ? reply.payload : result);
    } catch (again) {
      req.log.error({ err: again }, 'error handler failed');
      reply.status(500).type('application/json; charset=utf-8');
      return JSON.stringify({
        error: 'internal',
        message: 'Something went wrong. Please try again.',
      });
    }
  }

  private done(): void {
    this.inFlight--;
    if (this.inFlight === 0) for (const r of this.idle.splice(0)) r();
  }

  /** Resolves once no request is in flight. New requests are still answered (the platform stops sending them). */
  close(): Promise<void> {
    this.closed = true;
    if (this.inFlight === 0) return Promise.resolve();
    return new Promise((r) => this.idle.push(r));
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Test helper: runs a request in-process, like Fastify's `inject`. */
  async inject(opts: InjectOptions): Promise<InjectResponse> {
    const headers = new Headers(opts.headers ?? {});
    let body: string | undefined;
    if (opts.payload !== undefined) {
      if (typeof opts.payload === 'string') body = opts.payload;
      else {
        body = JSON.stringify(opts.payload);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      }
    }
    const res = await this.fetch(
      new Request(new URL(opts.url, 'http://localhost'), {
        method: opts.method ?? 'GET',
        headers,
        body,
      }),
      {
        ip: opts.remoteAddress ?? '127.0.0.1',
      },
    );
    const text = await res.text();
    const out: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      out[k] = v;
    });
    return {
      statusCode: res.status,
      headers: out,
      body: text,
      json: () => JSON.parse(text),
    };
  }
}
