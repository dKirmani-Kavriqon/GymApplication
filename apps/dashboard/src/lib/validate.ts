import { humanize } from '@gymverse/shared';

interface Issue {
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

/** The structural bits of a zod schema we use (keeps the dashboard free of a direct zod import). */
interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: readonly Issue[] } };
}

export type Validated<T> = { ok: true; data: T } | { ok: false; error: string };

/** Friendly name for the first segment of an issue path ("caloriesPerDay" → "Calories per day"). */
function fieldName(path: ReadonlyArray<PropertyKey>): string {
  const parts = path.filter((p): p is string => typeof p === 'string');
  const key = parts[parts.length - 1];
  if (!key) return '';
  const words = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/ g$/, ' (g)');
  const rowIndex = path.find((p) => typeof p === 'number');
  const label = humanize(words);
  return typeof rowIndex === 'number' ? `${label} (row ${rowIndex + 1})` : label;
}

/**
 * Runs a shared zod schema and returns the parsed data, or the first problem as one readable
 * sentence ("Title: Enter at least 2 characters").
 */
export function validate<T>(schema: Schema<T>, value: unknown): Validated<T> {
  const res = schema.safeParse(value);
  if (res.success) return { ok: true, data: res.data };
  const issue = res.error.issues[0];
  if (!issue) return { ok: false, error: 'Please check the form.' };
  const name = fieldName(issue.path);
  return { ok: false, error: name ? `${name}: ${issue.message}` : issue.message };
}

/** "a, b,, c" → ["a", "b", "c"] */
export function splitList(text: string, sep: RegExp = /[,\n]/): string[] {
  return text
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One item per line. */
export function splitLines(text: string): string[] {
  return splitList(text, /\r?\n/);
}

/** "" → null, "12" → 12, "abc" → NaN (so the schema reports it). */
export function numOrNull(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  return Number(t);
}

export function emptyToNull(text: string): string | null {
  const t = text.trim();
  return t ? t : null;
}
