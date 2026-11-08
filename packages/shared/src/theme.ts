import {
  ensureContrast,
  mixHex,
  normalizeHex,
  readableTextOn,
} from './color';

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = ThemeMode | 'auto';
/** What a member picks for their own app: follow the gym, or force light/dark/auto. */
export type MemberThemeMode = 'gym' | ThemePreference;

export interface Branding {
  gymName: string;
  tagline?: string | null;
  logoUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  themePreference: ThemePreference;
}

/** The GymVerse default palette ("Burgundy & Beige"). */
export const PALETTE = {
  burgundy: '#6B0F1A',
  wine: '#8B1E3F',
  rose: '#B54B6A',
  blush: '#E7B8B8',
  beige: '#F8F1E7',
  taupe: '#D6C2B3',
  sand: '#EADCC8',
  ivory: '#FAF8F5',
  charcoal: '#1F1F1F',
  muted: '#6B6B6B',
} as const;

export interface ThemePreset {
  id: string;
  name: string;
  primary: string;
  accent: string;
}

/** Ready-made colour pairs for gym owners and members. All pass the AA checks in light mode. */
export const THEME_PRESETS: ThemePreset[] = [
  { id: 'burgundy', name: 'Burgundy & Beige', primary: PALETTE.burgundy, accent: PALETTE.rose },
  { id: 'ocean', name: 'Ocean', primary: '#0B4F6C', accent: '#2E7F9A' },
  { id: 'forest', name: 'Forest', primary: '#1F5135', accent: '#4A7F55' },
  { id: 'plum', name: 'Plum', primary: '#5B2A6E', accent: '#8E4FA3' },
  { id: 'terracotta', name: 'Terracotta', primary: '#9A3B1F', accent: '#B5562F' },
  { id: 'graphite', name: 'Graphite', primary: '#2B2B2B', accent: '#6B6B6B' },
];

export const DEFAULT_BRANDING: Branding = {
  gymName: 'GymVerse',
  tagline: 'Your gym, in your pocket',
  logoUrl: null,
  primaryColor: PALETTE.burgundy,
  accentColor: PALETTE.rose,
  themePreference: 'light',
};

export interface AppTheme {
  mode: ThemeMode;
  /** Page background (beige in the default theme). */
  background: string;
  /** Cards and sheets. */
  surface: string;
  /** Inputs, chips, segmented controls. */
  surfaceAlt: string;
  /** Soft brand tint: icon tiles, progress cards. */
  tint: string;
  /** Stronger brand tint: gradients, decorative shapes. */
  tint2: string;
  border: string;
  text: string;
  textMuted: string;
  /** Large headings and big numbers (brand-tinted near-black in light mode). */
  heading: string;
  /** Brand colour used for the main action on each screen. */
  primary: string;
  /** Text/icon colour placed on top of `primary`. */
  onPrimary: string;
  /** Brand colour as used for text/icons on the surface (contrast-safe). */
  primaryText: string;
  accent: string;
  onAccent: string;
  success: string;
  warning: string;
  danger: string;
  /** Shadow colour (use with low opacity already baked in). */
  shadow: string;
  /** Scrim behind modals. */
  overlay: string;
  radius: { sm: number; md: number; lg: number; xl: number; pill: number };
}

export function resolveMode(pref: ThemePreference, systemMode: ThemeMode | null | undefined): ThemeMode {
  if (pref === 'auto') return systemMode === 'dark' ? 'dark' : 'light';
  return pref;
}

function rgba(hex: string, alpha: number): string {
  const h = normalizeHex(hex).slice(1);
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`;
}

/**
 * Builds the full app theme for a gym's (or member's) branding. Surfaces are
 * warm neutrals lightly tinted with the brand colour, so any brand colour gets
 * the Burgundy & Beige feel. Text colours always meet WCAG AA.
 */
export function buildTheme(branding: Branding, systemMode?: ThemeMode | null): AppTheme {
  const mode = resolveMode(branding.themePreference, systemMode);
  const dark = mode === 'dark';
  const brand = normalizeHex(branding.primaryColor);
  const accentIn = normalizeHex(branding.accentColor);
  const radius = { sm: 12, md: 16, lg: 22, xl: 28, pill: 999 };

  if (!dark) {
    const surface = mixHex('#FFFCF8', brand, 0.012);
    const accent = accentIn;
    return {
      mode,
      background: mixHex(PALETTE.beige, brand, 0.03),
      surface,
      surfaceAlt: mixHex('#FBF4EE', brand, 0.08),
      tint: mixHex('#FBF4EE', brand, 0.1),
      tint2: mixHex('#FBF4EE', brand, 0.22),
      border: mixHex('#F0E5D9', brand, 0.06),
      text: PALETTE.charcoal,
      textMuted: ensureContrast(PALETTE.muted, surface, 4.5),
      heading: ensureContrast(mixHex(brand, PALETTE.charcoal, 0.45), surface, 7),
      primary: brand,
      onPrimary: readableTextOn(brand),
      primaryText: ensureContrast(brand, surface, 4.5),
      accent,
      onAccent: readableTextOn(accent),
      success: '#0F6B47',
      warning: '#8A4B00',
      danger: '#A3122A',
      shadow: rgba(brand, 0.1),
      overlay: 'rgba(31, 31, 31, 0.5)',
      radius,
    };
  }

  const surface = mixHex('#191314', brand, 0.14);
  const primary = ensureContrast(brand, surface, 3);
  const accent = ensureContrast(accentIn, surface, 3);
  return {
    mode,
    background: mixHex('#0F0B0C', brand, 0.1),
    surface,
    surfaceAlt: mixHex('#191314', brand, 0.24),
    tint: mixHex('#191314', brand, 0.3),
    tint2: mixHex('#191314', brand, 0.45),
    border: mixHex('#2A2123', brand, 0.2),
    text: '#F5EEE6',
    textMuted: ensureContrast('#B9ADA5', surface, 4.5),
    heading: '#FFF7F2',
    primary,
    onPrimary: readableTextOn(primary),
    primaryText: ensureContrast(brand, surface, 4.5),
    accent,
    onAccent: readableTextOn(accent),
    success: '#6FD3A0',
    warning: '#F2C27A',
    danger: '#FF8A9B',
    shadow: 'rgba(0, 0, 0, 0.35)',
    overlay: 'rgba(0, 0, 0, 0.6)',
    radius,
  };
}

/**
 * The branding a member actually sees: the gym's branding, with the member's
 * own theme colour and appearance applied on top (member beats gym beats default).
 */
export function resolveMemberBranding(
  gym: Branding | null | undefined,
  member?: { themeColor?: string | null; themeMode?: MemberThemeMode | null } | null,
): Branding {
  const base = gym ?? DEFAULT_BRANDING;
  let primaryColor = base.primaryColor;
  let accentColor = base.accentColor;
  if (member?.themeColor) {
    primaryColor = normalizeHex(member.themeColor);
    const preset = THEME_PRESETS.find((p) => p.primary.toUpperCase() === primaryColor);
    accentColor = preset ? preset.accent : base.accentColor;
  }
  const mode = member?.themeMode ?? 'gym';
  return { ...base, primaryColor, accentColor, themePreference: mode === 'gym' ? base.themePreference : mode };
}
