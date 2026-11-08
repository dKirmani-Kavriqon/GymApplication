import React, { useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { nativeDriver, useReduceMotion } from '../utils/feedback';

/** Motion tokens: short, soft, never in the way. All motion is skipped with the OS "Reduce motion" setting. */
export const MOTION = {
  enterMs: 260,
  staggerMs: 45,
  maxStaggerSteps: 8,
  riseDistance: 10,
  pressScale: 0.97,
};

/**
 * Fade + small rise on mount. `index` staggers siblings (capped so long lists don't lag).
 */
export function useEntrance(index = 0): { opacity: Animated.Value | number; transform: Array<{ translateY: Animated.AnimatedInterpolation<number> | number }> } {
  const reduce = useReduceMotion();
  const progress = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: MOTION.enterMs,
      delay: Math.min(index, MOTION.maxStaggerSteps) * MOTION.staggerMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
    });
    anim.start();
    return () => anim.stop();
  }, [reduce, progress, index]);
  return {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [MOTION.riseDistance, 0] }) }],
  };
}

export function FadeIn({ children, index = 0, style }: { children: React.ReactNode; index?: number; style?: StyleProp<ViewStyle> }) {
  const entrance = useEntrance(index);
  return <Animated.View style={[entrance as unknown as ViewStyle, style]}>{children}</Animated.View>;
}

/** A gentle scale "pop" whenever `value` changes (e.g. a stat going up). */
export function usePop(value: unknown): Animated.Value {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduce) return;
    scale.setValue(1.15);
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: nativeDriver }).start();
  }, [value, reduce, scale]);
  return scale;
}

/** Slow opacity pulse for skeleton placeholders. */
export function usePulse(): Animated.Value {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver }),
        Animated.timing(v, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, v]);
  return v;
}
