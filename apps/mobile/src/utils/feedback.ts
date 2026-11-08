import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/** Light haptic tap on every action (PRD §8 rule 7). No-ops where unsupported. */
export function tapFeedback(): void {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function successFeedback(): void {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

/** Under Jest, motion is skipped so tests are deterministic (no timers firing outside act). */
const IN_TESTS = typeof process !== 'undefined' && !!process.env.JEST_WORKER_ID;

/** Respects the OS "Reduce motion" setting (PRD §8 animation budget). */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(IN_TESTS);
  useEffect(() => {
    if (IN_TESTS) return;
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => alive && setReduce(Boolean(v)))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduce(v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}

export const nativeDriver = Platform.OS !== 'web';
