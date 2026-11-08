import { describe, expect, it } from 'vitest';
import {
  buildTheme,
  checkBrandContrast,
  contrastRatio,
  ensureContrast,
  hexToRgb,
  isHexColor,
  normalizeHex,
  readableTextOn,
  rgbToHex,
} from '../src';

describe('hex parsing', () => {
  it('normalizes short and long hex', () => {
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex('4f46e5')).toBe('#4F46E5');
    expect(hexToRgb('#FF8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe('#FF8000');
  });

  it('rejects invalid colours', () => {
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#12345')).toBe(false);
    expect(() => normalizeHex('nope')).toThrow();
  });
});

describe('contrast', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
  });

  it('picks readable text for light and dark backgrounds', () => {
    expect(readableTextOn('#FFE600')).not.toBe('#FFFFFF'); // yellow -> dark text
    expect(readableTextOn('#1E3A8A')).toBe('#FFFFFF'); // navy -> white text
  });

  it('ensureContrast fixes pale brand colours and leaves good ones alone', () => {
    expect(ensureContrast('#1E3A8A', '#FFFFFF')).toBe('#1E3A8A');
    const fixed = ensureContrast('#FFE600', '#FFFFFF', 4.5);
    expect(contrastRatio(fixed, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    const fixedDark = ensureContrast('#1E1B4B', '#0B0F17', 4.5);
    expect(contrastRatio(fixedDark, '#0B0F17')).toBeGreaterThanOrEqual(4.5);
  });

  it('reports brand colours that are unreadable on light or dark surfaces', () => {
    const issues = checkBrandContrast('#FFE600', '#4F46E5');
    expect(issues.some((i) => i.field === 'primary' && i.against === 'light')).toBe(true);
    for (const issue of issues) {
      const surface = issue.against === 'light' ? '#FFFFFF' : '#0B0F17';
      expect(contrastRatio(issue.suggestion, surface)).toBeGreaterThanOrEqual(3);
    }
    expect(checkBrandContrast('#2563EB', '#2563EB').filter((i) => i.against === 'light')).toHaveLength(0);
  });
});

describe('buildTheme', () => {
  const branding = {
    gymName: 'Iron Temple',
    primaryColor: '#FFE600',
    accentColor: '#0EA5E9',
    themePreference: 'auto' as const,
  };

  it('follows system mode when preference is auto', () => {
    expect(buildTheme(branding, 'dark').mode).toBe('dark');
    expect(buildTheme(branding, 'light').mode).toBe('light');
    expect(buildTheme({ ...branding, themePreference: 'dark' }, 'light').mode).toBe('dark');
  });

  it('always yields AA-readable text and button labels', () => {
    for (const mode of ['light', 'dark'] as const) {
      const t = buildTheme(branding, mode);
      expect(contrastRatio(t.text, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.textMuted, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.primaryText, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.onPrimary, t.primary)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

