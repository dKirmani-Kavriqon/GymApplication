import { HttpError } from './errors';

/** Requests allowed per window. `false` turns limiting off entirely. */
export interface RateLimitOptions {
  /** Every request, per client IP. Default 300/min. */
  globalPerMin?: number;
  /** `/auth/*`, per client IP. Default 10/min. */
  authPerMin?: number;
  /** Check-ins, per user. Default 30/min. */
  checkinPerMin?: number;
}

export const DEFAULT_RATE_LIMITS: Required<RateLimitOptions> = { globalPerMin: 300, authPerMin: 10, checkinPerMin: 30 };

export class RateLimitError extends HttpError {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super(429, 'rate_limited', 'Too many requests. Please slow down and try again shortly.');
    this.retryAfterSec = retryAfterSec;
  }
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counters kept in memory. Fine for a single API process (the deployment
 * runs one); move to Redis if the API is ever scaled out horizontally.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private lastSweep = 0;

  constructor(private readonly now: () => Date, private readonly windowMs = 60_000) {}

  /** Counts a hit; throws `RateLimitError` once `key` has used up `limit` in the current window. */
  hit(key: string, limit: number): void {
    const t = this.now().getTime();
    this.sweep(t);
    let w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + this.windowMs };
      this.windows.set(key, w);
    }
    w.count++;
    if (w.count > limit) throw new RateLimitError(Math.max(1, Math.ceil((w.resetAt - t) / 1000)));
  }

  get size(): number {
    return this.windows.size;
  }

  /** Drops expired windows at most once per window length so memory stays bounded. */
  private sweep(t: number): void {
    if (t - this.lastSweep < this.windowMs) return;
    this.lastSweep = t;
    for (const [k, w] of this.windows) if (w.resetAt <= t) this.windows.delete(k);
  }
}
