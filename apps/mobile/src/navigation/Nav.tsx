import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';

export type TabKey = 'home' | 'classes' | 'train' | 'community' | 'me';

export interface StackEntry {
  key: number;
  name: string;
  params: Record<string, unknown>;
}

export interface NavValue {
  tab: TabKey;
  stack: StackEntry[];
  setTab(tab: TabKey): void;
  /** Opens a full-screen route on top of the tabs (see navigation/routes.tsx). */
  push(name: string, params?: Record<string, unknown>): void;
  pop(): void;
  /** Back to the tabs, optionally switching tab. */
  reset(tab?: TabKey): void;
  /** Opens the membership/renew sheet from anywhere. */
  openRenew(): void;
  renewOpen: boolean;
  closeRenew(): void;
  /** @internal registry for useBackGuard */
  guards: { current: Array<() => boolean> };
}

const NavCtx = createContext<NavValue | null>(null);
let seq = 0;

/** A small stack + tabs navigator: tabs at the root, full-screen routes pushed on top. */
export function NavProvider({ children, initialTab = 'home' }: { children: React.ReactNode; initialTab?: TabKey }) {
  const [tab, setTabState] = useState<TabKey>(initialTab);
  const [stack, setStack] = useState<StackEntry[]>([]);
  const [renewOpen, setRenewOpen] = useState(false);
  const guards = useRef<Array<() => boolean>>([]);

  const push = useCallback((name: string, params: Record<string, unknown> = {}) => {
    setStack((s) => [...s, { key: ++seq, name, params }]);
  }, []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const reset = useCallback((next?: TabKey) => {
    setStack([]);
    if (next) setTabState(next);
  }, []);
  const setTab = useCallback((next: TabKey) => {
    setStack([]);
    setTabState(next);
  }, []);

  useEffect(() => {
    // No hardware back button on web; react-native-web 0.21 logs an error if we subscribe there.
    if (Platform.OS === 'web') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const guard = guards.current[guards.current.length - 1];
      if (guard && guard()) return true;
      if (stack.length === 0) return false;
      pop();
      return true;
    });
    return () => sub.remove();
  }, [stack.length, pop]);

  const value = useMemo<NavValue>(
    () => ({
      tab,
      stack,
      setTab,
      push,
      pop,
      reset,
      renewOpen,
      openRenew: () => setRenewOpen(true),
      closeRenew: () => setRenewOpen(false),
      guards,
    }),
    [tab, stack, setTab, push, pop, reset, renewOpen],
  );
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}

/**
 * Lets a screen intercept the Android back button (e.g. "discard this workout?").
 * Return true from the handler to stop the default pop.
 */
export function useBackGuard(handler: () => boolean): void {
  const nav = useNav();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = () => ref.current();
    nav.guards.current.push(fn);
    return () => {
      nav.guards.current = nav.guards.current.filter((g) => g !== fn);
    };
  }, [nav.guards]);
}

export function useNav(): NavValue {
  const v = useContext(NavCtx);
  if (!v) throw new Error('useNav must be used inside NavProvider');
  return v;
}

/**
 * Turns a notification/deep-link target into navigation.
 * 'classes' | 'membership' | 'announcements' | 'routine:<id>' | 'ticket:<id>' | 'challenge:<id>' | 'post:<id>' | 'article:<id>'
 */
export function openLink(nav: NavValue, link: string | null | undefined): void {
  if (!link) return;
  const [kind, id] = link.split(':');
  switch (kind) {
    case 'classes':
      return nav.setTab('classes');
    case 'membership':
      nav.reset('me');
      return nav.openRenew();
    case 'announcements':
      return nav.push('Announcements');
    case 'routine':
      return nav.push('RoutineDetail', { id });
    case 'ticket':
      return nav.push('Ticket', { id });
    case 'challenge':
      return nav.push('ChallengeDetail', { id });
    case 'post':
      return nav.push('Post', { id });
    case 'article':
      return nav.push('Article', { id });
    default:
      return undefined;
  }
}
