import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRANDING,
  PALETTE,
  THEME_PRESETS,
  buildTheme,
  checkBrandContrast,
  contrastRatio,
  createGymSchema,
  mixHex,
  modesFor,
  mondayOf,
  resolveMemberBranding,
} from '../src';

describe('Burgundy & Beige default', () => {
  it('is the default branding, in light mode', () => {
    expect(DEFAULT_BRANDING.primaryColor).toBe(PALETTE.burgundy);
    expect(DEFAULT_BRANDING.accentColor).toBe(PALETTE.rose);
    expect(DEFAULT_BRANDING.themePreference).toBe('light');
    const g = createGymSchema.parse({ name: 'Gym', city: 'Pune' });
    expect([g.primaryColor, g.accentColor]).toEqual([PALETTE.burgundy, PALETTE.rose]);
  });

  it('passes our own contrast check for the modes it uses', () => {
    expect(checkBrandContrast(DEFAULT_BRANDING.primaryColor, DEFAULT_BRANDING.accentColor, 3, modesFor('light'))).toEqual([]);
  });

  it('gives beige surfaces and burgundy actions', () => {
    const t = buildTheme(DEFAULT_BRANDING, 'light');
    expect(t.primary).toBe(PALETTE.burgundy);
    expect(contrastRatio(t.background, PALETTE.beige)).toBeLessThan(1.1); // visually beige
    expect(t.onPrimary).toBe('#FFFFFF');
  });
});

describe('every preset in both modes', () => {
  for (const p of THEME_PRESETS) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${p.name} (${mode}) keeps text AA-readable`, () => {
        const t = buildTheme({ gymName: 'G', primaryColor: p.primary, accentColor: p.accent, themePreference: mode });
        expect(contrastRatio(t.text, t.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.text, t.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.textMuted, t.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.heading, t.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.primaryText, t.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.onPrimary, t.primary)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.primaryText, t.tint)).toBeGreaterThanOrEqual(3);
      });
    }
    it(`${p.name} accent passes the light-mode brand check`, () => {
      expect(checkBrandContrast(p.primary, p.accent, 3, ['light'])).toEqual([]);
    });
  }
});

describe('member theme overrides (member beats gym beats default)', () => {
  const gym = { gymName: 'Flex', primaryColor: '#0F766E', accentColor: '#CE8509', themePreference: 'auto' as const };

  it('uses the gym when the member has no preference', () => {
    expect(resolveMemberBranding(gym, { themeColor: null, themeMode: 'gym' })).toEqual(gym);
    expect(resolveMemberBranding(null, null)).toEqual(DEFAULT_BRANDING);
  });

  it("applies the member's preset colour with its matching accent", () => {
    const ocean = THEME_PRESETS.find((p) => p.id === 'ocean')!;
    const b = resolveMemberBranding(gym, { themeColor: ocean.primary.toLowerCase(), themeMode: 'gym' });
    expect(b.primaryColor).toBe(ocean.primary);
    expect(b.accentColor).toBe(ocean.accent);
    expect(b.themePreference).toBe('auto');
  });

  it("keeps the gym accent for a custom colour and applies the member's mode", () => {
    const b = resolveMemberBranding(gym, { themeColor: '#123456', themeMode: 'dark' });
    expect(b.primaryColor).toBe('#123456');
    expect(b.accentColor).toBe('#CE8509');
    expect(b.themePreference).toBe('dark');
  });
});

describe('helpers', () => {
  it('mixes colours', () => {
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixHex('#6B0F1A', '#FFFFFF', 0)).toBe('#6B0F1A');
  });
  it('finds the Monday of a week', () => {
    expect(mondayOf('2026-11-08')).toBe('2026-11-02'); // Sunday
    expect(mondayOf('2026-11-09')).toBe('2026-11-09'); // Monday
    expect(mondayOf('2026-11-11')).toBe('2026-11-09');
  });
});
