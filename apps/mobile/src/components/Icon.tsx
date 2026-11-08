import React from 'react';
import Feather from '@expo/vector-icons/Feather';
import { useTheme } from '../theme/ThemeContext';

export type IconName = React.ComponentProps<typeof Feather>['name'];

/** Line icons (Feather), always paired with a text label somewhere nearby (PRD §8 rule 2). */
export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const t = useTheme();
  return <Feather name={name} size={size} color={color ?? t.text} accessibilityElementsHidden importantForAccessibility="no" />;
}
