import { vi } from 'vitest';

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
}

type Handler = (req: FakeRequest) => FakeReply | unknown;

/** A route value is either a handler or a plain JSON body (status 200). */
export type Routes = Record<string, Handler | object>;

const isReply = (v: unknown): v is FakeReply =>
  !!v && typeof v === 'object' && ('status' in v || 'body' in v) && Object.keys(v).every((k) => k === 'status' || k === 'body');

/** Wraps a reply so the helper can tell `{status, body}` apart from a plain JSON body. */
export const reply = (status: number, body?: unknown): FakeReply => ({ status, body });
export const apiError = (status: number, message: string, error = 'bad_request'): FakeReply => reply(status, { error, message });

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/**
 * Stubs global `fetch` with an in-memory API. Routes are keyed "METHOD /path/:param".
 * Unknown routes answer 404 so a test fails loudly instead of hanging.
 */
export function installFakeApi(routes: Routes) {
  const calls: FakeRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    let result: FakeReply = { status: 404, body: { error: 'not_found', message: `No fake route for ${method} ${url.pathname}` } };
    for (const [key, handler] of Object.entries(routes)) {
      const [m, pattern] = key.split(' ');
      if (m !== method) continue;
      const params = match(pattern, url.pathname);
      if (!params) continue;
      const req: FakeRequest = { method, path: url.pathname, query: url.searchParams, params, body, headers };
      calls.push(req);
      const out = typeof handler === 'function' ? (handler as Handler)(req) : handler;
      result = isReply(out) ? out : { status: 200, body: out };
      break;
    }
    const status = result.status ?? 200;
    const text = result.body === undefined ? '' : JSON.stringify(result.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      json: async () => JSON.parse(text),
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    fetchMock,
    calls,
    /** Requests made to a route key such as "PATCH /gyms/:gymId/branding". */
    callsTo(key: string) {
      const [m, pattern] = key.split(' ');
      return calls.filter((c) => c.method === m && match(pattern, c.path));
    },
  };
}
