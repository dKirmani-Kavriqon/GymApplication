import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { DEFAULT_BRANDING, buildTheme, type AppTheme, type Branding } from '@gymverse/shared';

interface ThemeValue {
  theme: AppTheme;
  branding: Branding;
}

const ThemeCtx = createContext<ThemeValue>({ theme: buildTheme(DEFAULT_BRANDING, 'light'), branding: DEFAULT_BRANDING });

/**
 * Re-skins everything below it (white-label, PRD §5). Pass the already-resolved
 * branding: GymVerse default → gym brand → member's own theme (resolveMemberBranding).
 */
export function ThemeProvider({ branding, children }: { branding?: Branding | null; children: React.ReactNode }) {
  const system = useColorScheme();
  const b = branding ?? DEFAULT_BRANDING;
  const value = useMemo(
    () => ({ theme: buildTheme(b, system === 'dark' ? 'dark' : 'light'), branding: b }),
    [b.primaryColor, b.accentColor, b.themePreference, b.gymName, b.logoUrl, b.tagline, system], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx).theme;
export const useBranding = () => useContext(ThemeCtx).branding;
