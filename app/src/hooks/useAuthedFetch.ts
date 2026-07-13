import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';

export function useAuthedFetch<T>(fetcher: (token: string) => Promise<T>, defaultValue: T, errorMessage: string) {
  const { accessToken } = useAuth();
  const [data, setData] = useState<T>(defaultValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) {
      setData(defaultValue);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await fetcher(accessToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : errorMessage);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, setData, loading, error, refresh };
}
