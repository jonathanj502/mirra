import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/auth/AuthContext';
import { friendlyErrorMessage } from '@/api/http';

export function useAuthedFetch<T>(fetcher: (token: string) => Promise<T>, defaultValue: T, errorMessage: string) {
  const { accessToken } = useAuth();
  const [data, setData] = useState<T>(defaultValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialValue = useRef(defaultValue);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    if (!accessToken) {
      setData(initialValue.current);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await fetcher(accessToken);
      if (id === requestId.current) setData(next);
    } catch (err) {
      if (id === requestId.current) setError(friendlyErrorMessage(err, errorMessage));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [accessToken, fetcher, errorMessage]);

  useFocusEffect(useCallback(() => {
    void refresh();
    return () => { requestId.current++; };
  }, [refresh]));

  return { data, setData, loading, error, refresh };
}
