/**
 * Colour utilities used to keep gym branding readable (WCAG AA) no matter
 * which colours an owner picks. Shared by the API (validation), the owner
 * dashboard (live preview + warnings) and the mobile app (runtime theming).
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value.trim());
}

export function normalizeHex(value: string): string {
  const m = HEX_RE.exec(value.trim());
  if (!m) throw new Error(`Invalid hex colour: ${value}`);
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return `#${hex.toUpperCase()}`;
}

export function hexToRgb(value: string): Rgb {
  const hex = normalizeHex(value).slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(value: string): number {
  const { r, g, b } = hexToRgb(value);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const WHITE = '#FFFFFF';
export const INK = '#111827';

/** Best text colour (white or near-black) to put on top of `background`. */
export function readableTextOn(background: string): string {
  return contrastRatio(background, WHITE) >= contrastRatio(background, INK) ? WHITE : INK;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** Blends colour `a` toward `b` by `t` (0 = a, 1 = b). Used to derive tinted surfaces from a brand colour. */
export function mixHex(a: string, b: string, t: number): string {
  return rgbToHex(mix(hexToRgb(a), hexToRgb(b), Math.min(1, Math.max(0, t))));
}

/**
 * Nudges `color` darker or lighter (keeping its hue) until it reaches `min`
 * contrast against `background`. Returns the original colour when it already
 * passes. Used to enforce AA even when a gym picks a pale brand colour.
 */
export function ensureContrast(color: string, background: string, min = 4.5): string {
  const original = normalizeHex(color);
  if (contrastRatio(original, background) >= min) return original;
  const base = hexToRgb(original);
  const towardDark = relativeLuminance(background) > 0.5;
  const target = towardDark ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  for (let step = 1; step <= 100; step++) {
    const candidate = rgbToHex(mix(base, target, step / 100));
    if (contrastRatio(candidate, background) >= min) return candidate;
  }
  return towardDark ? INK : WHITE;
}

export interface ContrastIssue {
  field: 'primary' | 'accent';
  against: 'light' | 'dark';
  ratio: number;
  suggestion: string;
}

export const LIGHT_SURFACE = '#FFFFFF';
export const DARK_SURFACE = '#0B0F17';

/** Which surfaces a gym's theme preference actually shows. */
export function modesFor(pref: 'light' | 'dark' | 'auto'): Array<'light' | 'dark'> {
  return pref === 'auto' ? ['light', 'dark'] : [pref];
}

/**
 * Reports brand colours that would be unreadable as text/icons on the light
 * or dark app surface, each with an AA-compliant suggestion. Pass `modes` to
 * check only the modes the gym uses (see `modesFor`).
 */
export function checkBrandContrast(
  primary: string,
  accent: string,
  min = 3,
  modes: Array<'light' | 'dark'> = ['light', 'dark'],
): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  const fields: Array<['primary' | 'accent', string]> = [
    ['primary', primary],
    ['accent', accent],
  ];
  for (const [field, color] of fields) {
    for (const [against, surface] of [
      ['light', LIGHT_SURFACE],
      ['dark', DARK_SURFACE],
    ] as const) {
      if (!modes.includes(against)) continue;
      const ratio = contrastRatio(color, surface);
      if (ratio < min) {
        issues.push({ field, against, ratio: Math.round(ratio * 100) / 100, suggestion: ensureContrast(color, surface, min) });
      }
    }
  }
  return issues;
}
