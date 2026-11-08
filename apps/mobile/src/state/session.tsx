import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GymMembership, MeResponse } from '@gymverse/shared';
import { ApiError, DEFAULT_API_URL, createApi, type Api } from '../api/client';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const TOKEN_KEY = 'gv.token';
const GYM_KEY = 'gv.activeGym';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface SessionValue {
  status: SessionStatus;
  api: Api;
  /** Device storage (token, intro seen, active gym). */
  storage: KeyValueStorage;
  me: MeResponse | null;
  activeGym: GymMembership | null;
  signIn(token: string): Promise<MeResponse | null>;
  signOut(): Promise<void>;
  refreshMe(): Promise<MeResponse | null>;
  setMe(me: MeResponse): void;
  selectGym(gymId: string): void;
}

const SessionCtx = createContext<SessionValue | null>(null);

export interface SessionProviderProps {
  children: React.ReactNode;
  /** Injected in tests; defaults to the real HTTP client. */
  makeApi?: (getToken: () => string | null) => Api;
  storage?: KeyValueStorage;
}

export function SessionProvider({ children, makeApi, storage = AsyncStorage }: SessionProviderProps) {
  const tokenRef = useRef<string | null>(null);
  const api = useMemo(
    () => (makeApi ?? ((get) => createApi(DEFAULT_API_URL, get)))(() => tokenRef.current),
    [makeApi],
  );
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [activeGymId, setActiveGymId] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    tokenRef.current = null;
    setMe(null);
    setStatus('signedOut');
    await storage.removeItem(TOKEN_KEY);
  }, [storage]);

  const refreshMe = useCallback(async () => {
    try {
      const next = await api.me();
      setMe(next);
      return next;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) await signOut();
      return null;
    }
  }, [api, signOut]);

  const signIn = useCallback(
    async (token: string) => {
      tokenRef.current = token;
      await storage.setItem(TOKEN_KEY, token);
      const next = await refreshMe();
      if (next) setStatus('signedIn');
      return next;
    },
    [refreshMe, storage],
  );

  // Restore a saved session on launch.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [token, gym] = await Promise.all([storage.getItem(TOKEN_KEY), storage.getItem(GYM_KEY)]);
      if (!alive) return;
      if (gym) setActiveGymId(gym);
      if (!token) return setStatus('signedOut');
      tokenRef.current = token;
      const next = await refreshMe();
      if (alive) setStatus(next ? 'signedIn' : 'signedOut');
    })();
    return () => {
      alive = false;
    };
  }, [refreshMe, storage]);

  const selectGym = useCallback(
    (gymId: string) => {
      setActiveGymId(gymId);
      void storage.setItem(GYM_KEY, gymId);
    },
    [storage],
  );

  const activeGym = useMemo(() => {
    const list = me?.memberships ?? [];
    return list.find((m) => m.gym.id === activeGymId) ?? list[0] ?? null;
  }, [me, activeGymId]);

  const value = useMemo<SessionValue>(
    () => ({ status, api, storage, me, activeGym, signIn, signOut, refreshMe, setMe, selectGym }),
    [status, api, storage, me, activeGym, signIn, signOut, refreshMe, selectGym],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}

export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}
