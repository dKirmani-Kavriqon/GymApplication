import { App, type Req } from './http';
import type { LoggerConfig } from './log';
import { ZodError } from 'zod';
import { initDb, ping, type Db } from './db';
import { HttpError } from './errors';
import type { OtpSender } from './auth';
import { createMockPaymentProvider } from './payments';
import { createCtx, type AppOptions, type Ctx, type LoggerOptions } from './context';
import { RateLimitError } from './rate-limit';
import { maskPhone } from './sms';
import { createPushDispatcher } from './push';
import { onNotification } from './domain/notifications';
import { registerAuthRoutes } from './routes/auth';
import { registerAccountRoutes } from './routes/account';
import { registerGymRoutes } from './routes/gyms';
import { registerMemberRoutes } from './routes/members';
import { registerCheckinRoutes } from './routes/checkins';
import { registerClassRoutes } from './routes/classes';
import { registerPaymentRoutes } from './routes/payments';
import { registerCouponRoutes } from './routes/coupons';
import { registerWebhookRoutes } from './routes/webhooks';
import { registerCheckoutRoutes } from './routes/checkout';
import { registerAnnouncementRoutes } from './routes/announcements';
import { registerWorkoutRoutes } from './routes/workouts';
import { registerResourceRoutes } from './routes/resources';
import { registerNutritionRoutes } from './routes/nutrition';
import { registerCommunityRoutes } from './routes/community';
import { registerNotificationRoutes } from './routes/notifications';
import { registerSupportRoutes } from './routes/support';
import { registerSearchRoutes } from './routes/search';
import { registerBusinessRoutes } from './routes/business';
import { registerAdminRoutes } from './routes/admin';

export type { AppOptions } from './context';

export type GymVerseApp = App & {
  db: Db;
  ctx: Ctx;
  /** Waits until queued push notifications have been handed to the push sender. */
  flushPush(): Promise<void>;
};

export const BODY_LIMIT = 256 * 1024;
export const IMPORT_BODY_LIMIT = 2 * 1024 * 1024;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,100}$/;

/** Keys whose values never reach the logs (at any depth). Phone numbers are masked to the last 4 digits. */
const SECRET_KEYS = new Set(['authorization', 'cookie', 'code', 'devCode', 'token', 'signature', 'phone']);

/** Masks phone numbers and drops checkout tokens (`?t=`) from URLs before they are logged. */
export function safeUrl(text: string): string {
  return text.replace(/([?&]t=)[^&#]*/g, '$1[redacted]').replace(/\+?\d{10,15}/g, (m) => maskPhone(m));
}

export function redactLog(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.has(k) && v !== undefined) out[k] = k === 'phone' && typeof v === 'string' ? maskPhone(v) : '[redacted]';
    else if (depth < 4 && v && typeof v === 'object' && !Array.isArray(v)) out[k] = redactLog(v as Record<string, unknown>, depth + 1);
    else out[k] = v;
  }
  return out;
}

function loggerConfig(l: boolean | LoggerOptions | undefined): LoggerConfig | false {
  if (!l) return false;
  const o: LoggerOptions = l === true ? {} : l;
  return {
    level: o.level ?? 'info',
    redact: redactLog,
    ...(o.stream ? { write: (line: string) => o.stream!.write(line) } : {}),
  };
}

/** Builds the API on a database that is already open. Runtime-neutral: used on Node and in the Durable Object. */
export function createApp(database: Db, opts: AppOptions = {}): GymVerseApp {
  // A database handed in by the caller may be from an older version: bring it up to date.
  const db = initDb(database);
  const app = new App({
    logger: loggerConfig(opts.logger),
    trustProxy: opts.trustProxy ?? false,
    bodyLimit: BODY_LIMIT,
    genReqId: (given) => (given && REQUEST_ID.test(given) ? given : crypto.randomUUID()),
    serializeReq: (req: Req) => ({
      method: req.method,
      url: safeUrl(req.url),
      ip: req.ip,
    }),
    cors: {
      origin: opts.corsOrigins ?? true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposedHeaders: ['x-request-id', 'retry-after'],
    },
  }) as GymVerseApp;
  const log = () => app.log;
  const sendOtp: OtpSender =
    opts.sendOtp ?? ((phone) => app.log.info({ phone: maskPhone(phone) }, 'OTP issued (no SMS sender configured)'));
  const push = opts.push ? createPushDispatcher(db, opts.push, log) : null;
  onNotification(db, push ? (n) => push.enqueue(n) : null);
  const ctx = createCtx(db, opts, {
    secret: opts.tokenSecret ?? 'dev-secret-change-me',
    now: opts.now ?? (() => new Date()),
    payments: opts.payments ?? createMockPaymentProvider(),
    sendOtp,
    log,
    push,
  });

  app.db = db;
  app.ctx = ctx;
  app.flushPush = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await push?.flush();
  };

  // ---------- rate limiting (before any parsing or auth work) ----------
  app.addHook('onRequest', async (req) => {
    if (!ctx.limits || req.url.startsWith('/health')) return;
    ctx.limiter.hit(`ip:${req.ip}`, ctx.limits.globalPerMin);
    if (req.url.startsWith('/auth/')) ctx.limiter.hit(`auth:${req.ip}`, ctx.limits.authPerMin);
  });

  // ---------- security headers & request id on every response ----------
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cross-origin-resource-policy', 'same-site');
    reply.removeHeader('x-powered-by');
    if (req.headers.authorization) reply.header('cache-control', 'no-store');
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation',
        message: err.issues[0]?.message ?? 'Invalid input',
        issues: err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    if (err instanceof RateLimitError) {
      reply.header('retry-after', String(err.retryAfterSec));
      return reply.status(429).send({
        error: err.code,
        message: err.message,
        retryAfterSec: err.retryAfterSec,
      });
    }
    if (err instanceof HttpError) {
      if (err.status >= 500) req.log.error({ code: err.code }, err.message);
      return reply.status(err.status).send({ error: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const code = status === 413 ? 'payload_too_large' : status === 415 ? 'unsupported_media_type' : 'bad_request';
      return reply.status(status).send({ error: code, message: (err as Error).message });
    }
    // Never send internals (stack, SQL) to the client; the request id ties the log line to the report.
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({
      error: 'internal',
      message: 'Something went wrong. Please try again.',
      requestId: req.id,
    });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not_found', message: 'Not found' }));

  // ---------- health ----------
  app.get('/health', async () => ({ ok: true }));
  app.get('/health/live', async () => ({ ok: true }));
  app.get('/health/ready', async (_req, reply) =>
    ping(db) ? { ok: true } : reply.status(503).send({ ok: false, error: 'db_unavailable' }),
  );

  registerAuthRoutes(app, ctx); // /auth/*, /me, /me/profile
  registerAccountRoutes(app, ctx); // devices, consent, export, delete
  registerGymRoutes(app, ctx); // create, preview, join, branding, door code, referral
  registerMemberRoutes(app, ctx); // home summary, staff member tools, attendance report
  registerCheckinRoutes(app, ctx);
  registerClassRoutes(app, ctx); // classes, bookings, attendance, trainer today
  registerPaymentRoutes(app, ctx); // plans & payments
  registerCouponRoutes(app, ctx);
  registerWebhookRoutes(app, ctx);
  registerCheckoutRoutes(app, ctx); // hosted checkout pages (/pay/*)
  registerAnnouncementRoutes(app, ctx);
  registerWorkoutRoutes(app, ctx); // exercises, routines, workout logs, progress, /me/measurements
  registerResourceRoutes(app, ctx); // articles, favourites
  registerNutritionRoutes(app, ctx);
  registerCommunityRoutes(app, ctx); // posts, comments, challenges
  registerNotificationRoutes(app, ctx);
  registerSupportRoutes(app, ctx);
  registerSearchRoutes(app, ctx);
  registerBusinessRoutes(app, ctx); // revenue, freeze requests
  registerAdminRoutes(app, ctx); // platform admin console

  return app;
}
