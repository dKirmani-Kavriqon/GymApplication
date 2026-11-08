import { useCallback, useEffect, useRef, useState } from 'react';

/** Loads data on mount / when `key` changes; exposes reload and local updates. */
export function useLoad<T>(load: () => Promise<T>, key: unknown) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const alive = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadRef.current();
      if (alive.current) {
        setData(next);
        setError(null);
      }
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [key, reload]);

  return { data, error, loading, reload, setData };
}
