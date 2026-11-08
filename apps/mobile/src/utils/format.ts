/** Extracts a gym join code from a QR/deep link (gymverse://join/ABC123, https://.../join/ABC123) or raw text. */
export function parseJoinCode(input: string): string | null {
  const trimmed = input.trim();
  const link = /join\/([A-Za-z0-9]{6})(?:[/?#]|$)/.exec(trimmed);
  const candidate = (link ? link[1] : trimmed).toUpperCase();
  return /^[A-Z0-9]{6}$/.test(candidate) ? candidate : null;
}

export function greeting(date: Date): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '🙂';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today, 7:00 AM" / "Tomorrow, 6:30 PM" / "Wed 12 Nov, 7:00 AM" in device local time. */
export function formatClassTime(iso: string, now: Date): string {
  const d = new Date(iso);
  const h = d.getHours();
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Tomorrow, ${time}`;
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}, ${time}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTH[d.getMonth()]} ${d.getFullYear()}`;
}

/** Last `n` calendar days (YYYY-MM-DD, oldest first) ending at `today`. */
export function lastDays(today: string, n: number): string[] {
  const [y, m, d] = today.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  return Array.from({ length: n }, (_, i) => new Date(base - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Door check-in token from a scanned QR / deep link: gymverse://checkin/<token> or https://.../checkin/<token>. */
export function parseDoorToken(input: string): string | null {
  const m = /checkin\/([A-Za-z0-9_-]{8,200})(?:[/?#]|$)/.exec(input.trim());
  return m ? m[1] : null;
}
