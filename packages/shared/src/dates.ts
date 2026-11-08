export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** Calendar day (YYYY-MM-DD) of `date` in the given IANA time zone. */
export function dayKey(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Hour of day (0-23) of `date` in the given time zone. */
export function hourOf(date: Date, timeZone = DEFAULT_TIMEZONE): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date);
  return Number(h) % 24;
}

const DAY_MS = 86_400_000;

function toUtc(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  return new Date(toUtc(day) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

export interface Streak {
  current: number;
  longest: number;
}

/**
 * Streak of consecutive check-in days. The current streak survives until the
 * end of the day after the last visit, so members are not shown "0" in the
 * morning before they have had a chance to check in.
 */
export function computeStreak(days: string[], today: string): Streak {
  const unique = [...new Set(days)].filter((d) => d <= today).sort();
  if (unique.length === 0) return { current: 0, longest: 0 };
  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    run = daysBetween(unique[i - 1], unique[i]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const last = unique[unique.length - 1];
  const current = daysBetween(last, today) <= 1 ? run : 0;
  return { current, longest };
}

export type MembershipState = 'none' | 'active' | 'expiring' | 'expired';

export interface MembershipStatus {
  state: MembershipState;
  daysLeft: number;
}

export const EXPIRING_SOON_DAYS = 7;

export function membershipStatus(endsAt: string | null | undefined, now: Date): MembershipStatus {
  if (!endsAt) return { state: 'none', daysLeft: 0 };
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (ms <= 0) return { state: 'expired', daysLeft: 0 };
  const daysLeft = Math.ceil(ms / DAY_MS);
  return { state: daysLeft <= EXPIRING_SOON_DAYS ? 'expiring' : 'active', daysLeft };
}

/** The Monday (YYYY-MM-DD) of the week containing `day`. Weeks start on Monday. */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}
