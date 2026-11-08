import { phoneSchema, type MemberRow } from '@gymverse/shared';

/**
 * Normalises a phone number the way the dashboard sends it to the API:
 * strips spaces/dashes/brackets and assumes India (+91) for bare 10-digit numbers.
 */
export function normalizePhone(input: string): string {
  const v = input.trim().replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(v)) return `+91${v}`;
  if (/^0\d{10}$/.test(v)) return `+91${v.slice(1)}`;
  if (/^91\d{10}$/.test(v)) return `+${v}`;
  return v;
}

export function isValidPhone(input: string): boolean {
  return phoneSchema.safeParse(normalizePhone(input)).success;
}

/** "1,499.50" / "₹1499" → 149950 / 149900. Returns null when not a valid non-negative amount. */
export function rupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Converts a wall-clock date + time in the gym's time zone (e.g. "2026-11-20", "07:30",
 * "Asia/Kolkata") to an ISO-8601 UTC timestamp for the API.
 */
export function zonedLocalToIso(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if (!date || !time || [y, m, d, hh, mm].some((n) => n === undefined || Number.isNaN(n))) {
    throw new Error('Pick a valid date and time');
  }
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  try {
    let ts = wall - tzOffsetMs(wall, timeZone);
    ts = wall - tzOffsetMs(ts, timeZone);
    return new Date(ts).toISOString();
  } catch {
    return new Date(y, m - 1, d, hh, mm).toISOString();
  }
}

function safeTz(timeZone?: string): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat('en-IN', { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

export function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: safeTz(timeZone),
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: safeTz(timeZone), day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );
}

/** "2026-11-08" → "Sun 8" (calendar day, no time-zone shift). */
export function shortDayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const wd = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
  return `${wd} ${d}`;
}

export function hourLabel(hour: number): string {
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

/** Relative label for a YYYY-MM-DD visit day compared to `today` (same format). */
export function lastVisitLabel(day: string | null, today: string): string {
  if (!day) return 'Never';
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${diff} days ago`;
}

export function membershipLabel(m: MemberRow['membership']): string {
  switch (m.state) {
    case 'active':
      return `Active · ${m.daysLeft}d left`;
    case 'expiring':
      return `Expiring · ${m.daysLeft}d left`;
    case 'expired':
      return 'Expired';
    default:
      return 'No plan';
  }
}

export function pluralize(n: number, word: string, plural = `${word}s`): string {
  return `${n} ${n === 1 ? word : plural}`;
}
