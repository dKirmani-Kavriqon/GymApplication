import type { TextStyle } from 'react-native';

/**
 * Plus Jakarta Sans stands in for Satoshi (the reference font, not on Google Fonts).
 * Each weight is its own family on native, so styles pick the family, not fontWeight.
 */
export const FONT_FAMILIES = {
  400: 'PlusJakartaSans_400Regular',
  500: 'PlusJakartaSans_500Medium',
  600: 'PlusJakartaSans_600SemiBold',
  700: 'PlusJakartaSans_700Bold',
  800: 'PlusJakartaSans_800ExtraBold',
} as const;

export type Weight = keyof typeof FONT_FAMILIES;

export function font(weight: Weight): TextStyle {
  return { fontFamily: FONT_FAMILIES[weight] };
}

export const TYPE = {
  display: { ...font(800), fontSize: 36, lineHeight: 40, letterSpacing: -1 },
  h1: { ...font(800), fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  h2: { ...font(700), fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  h3: { ...font(700), fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  body: { ...font(500), fontSize: 15, lineHeight: 22 },
  bodyStrong: { ...font(700), fontSize: 15, lineHeight: 22 },
  small: { ...font(500), fontSize: 13, lineHeight: 18 },
  smallStrong: { ...font(700), fontSize: 13, lineHeight: 18 },
  caption: { ...font(700), fontSize: 11, lineHeight: 14, letterSpacing: 1.2, textTransform: 'uppercase' },
  number: { ...font(800), fontSize: 30, lineHeight: 34, letterSpacing: -0.8 },
  button: { ...font(700), fontSize: 16, lineHeight: 20 },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof TYPE;
