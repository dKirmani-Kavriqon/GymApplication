import { useEffect, useState, type CSSProperties } from 'react';

/**
 * True when it's OK to animate: the browser supports matchMedia (jsdom in tests doesn't, so tests
 * always see final values) and the user hasn't asked for reduced motion.
 */
export function motionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  if (typeof window.requestAnimationFrame !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Counts from 0 up to `target` over `duration` ms (ease-out). Returns the final value straight
 * away when motion isn't allowed (reduced motion, tests, SSR).
 */
export function useCountUp(target: number, duration = 600): number {
  const [value, setValue] = useState(() => (motionAllowed() ? 0 : target));
  useEffect(() => {
    if (!motionAllowed() || !Number.isFinite(target)) {
      setValue(target);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / duration);
      setValue(t >= 1 ? target : target * easeOutCubic(t));
      if (t < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

/** Inline style for staggered entrance: the CSS reads `--i` for animation-delay (capped). */
export function stagger(i: number): CSSProperties {
  return { '--i': Math.min(i, 10) } as CSSProperties;
}
