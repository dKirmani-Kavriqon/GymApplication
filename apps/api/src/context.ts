import type { Req } from './http';
import type { Logger } from './log';
import type { FeatureKey, Gym, Role } from '@gymverse/shared';
import type { Db } from './db';
import { HttpError, forbidden, notFound } from './errors';
import { verifyToken, type OtpSender } from './auth';
import type { PaymentProvider } from './payments';
import type { PushDispatcher, PushSender } from './push';
import { DEFAULT_RATE_LIMITS, RateLimiter, type RateLimitOptions } from './rate-limit';
import * as store from './store';

export interface LoggerOptions {
  level?: string;
  /** Where JSON log lines go (tests capture them); default stdout. */
  stream?: { write(line: string): void };
}

export interface AppOptions {
  db?: Db;
  dbPath?: string;
  tokenSecret?: string;
  now?: () => Date;
  sendOtp?: OtpSender;
  /** Return the OTP in the API response. Development/tests only. */
  exposeDevOtp?: boolean;
  payments?: PaymentProvider;
  /** Push sender (Expo in production). Without one, notifications are in-app only. */
  push?: PushSender;
  logger?: boolean | LoggerOptions;
  corsOrigins?: string[] | true;
  /** Use X-Forwarded-For for the client IP (behind Caddy). */
  trustProxy?: boolean;
  /** Per-minute limits; `false` disables rate limiting. */
  rateLimit?: RateLimitOptions | false;
  /** Public base URL of this API (hosted checkout links). Default http://localhost:4000. */
  publicUrl?: string;
  /** E.164 phone numbers allowed into /admin. */
  platformAdminPhones?: string[];
}

export interface GymAccess {
  userId: string;
  gym: Gym;
  role: Role;
}

/** What every route module gets: the database, the clock and the auth/tenant guards. */
export interface Ctx {
  db: Db;
  now: () => Date;
  secret: string;
  opts: AppOptions;
  payments: PaymentProvider;
  sendOtp: OtpSender;
  log: () => Logger;
  push: PushDispatcher | null;
  limiter: RateLimiter;
  limits: Required<RateLimitOptions> | null;
  /** Public base URL, no trailing slash. */
  publicUrl: string;
  userIdOf(req: Req): string;
  /**
   * Tenant guard: the caller must be an active member of `:gymId`. Non-members
   * get 404 so gym ids cannot be probed. Optionally restricts by role.
   * Suspended gyms answer 403 `gym_suspended` (owners may still read the gym itself).
   */
  gymAccess(req: Req, roles?: readonly Role[], opts?: { ownerMayReadSuspended?: boolean }): GymAccess;
  featureGuard(gym: Gym, feature: FeatureKey): void;
  isPlatformAdmin(userId: string): boolean;
  /** Counts a hit against a per-key limit (no-op when rate limiting is off). */
  rateLimit(bucket: 'checkin', key: string): void;
}

export const gymSuspended = () => new HttpError(403, 'gym_suspended', "This gym's account is paused. Please contact the gym.");

export function createCtx(
  db: Db,
  opts: AppOptions,
  deps: {
    secret: string;
    now: () => Date;
    payments: PaymentProvider;
    sendOtp: OtpSender;
    log: () => Logger;
    push: PushDispatcher | null;
  },
): Ctx {
  const { secret, now } = deps;
  const limits = opts.rateLimit === false ? null : { ...DEFAULT_RATE_LIMITS, ...(opts.rateLimit ?? {}) };
  const limiter = new RateLimiter(now);
  const admins = new Set(opts.platformAdminPhones ?? []);

  function userIdOf(req: Req): string {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const userId = token ? verifyToken(token, secret, now()) : null;
    if (!userId) throw new HttpError(401, 'unauthorized', 'Please log in again.');
    const exists = db.prepare('SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL').get(userId);
    if (!exists) throw new HttpError(401, 'unauthorized', 'Please log in again.');
    return userId;
  }

  function gymAccess(req: Req, roles?: readonly Role[], o: { ownerMayReadSuspended?: boolean } = {}): GymAccess {
    const userId = userIdOf(req);
    const { gymId } = req.params as { gymId: string };
    const role = store.getRole(db, gymId, userId);
    if (!role) throw notFound('Gym not found');
    const gym = store.getGym(db, gymId);
    if (gym.suspended && !(o.ownerMayReadSuspended && role === 'owner')) throw gymSuspended();
    if (roles && !roles.includes(role)) throw forbidden();
    return { userId, gym, role };
  }

  function featureGuard(gym: Gym, feature: FeatureKey): void {
    if (!gym.enabledFeatures.includes(feature)) {
      throw new HttpError(403, 'feature_disabled', 'Your gym has not switched this feature on.');
    }
  }

  function isPlatformAdmin(userId: string): boolean {
    if (!admins.size) return false;
    const r = db.prepare('SELECT phone FROM users WHERE id = ? AND deleted_at IS NULL').get(userId) as { phone: string } | undefined;
    return Boolean(r && admins.has(r.phone));
  }

  function rateLimit(bucket: 'checkin', key: string): void {
    if (limits) limiter.hit(`${bucket}:${key}`, limits.checkinPerMin);
  }

  const publicUrl = (opts.publicUrl ?? 'http://localhost:4000').replace(/\/+$/, '');
  return { db, opts, ...deps, limiter, limits, publicUrl, userIdOf, gymAccess, featureGuard, isPlatformAdmin, rateLimit };
}
