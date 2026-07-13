import { fetchUsage } from '@/api/client';
import { UsageSummary } from '@/models/debrief';
import { useAuthedFetch } from './useAuthedFetch';

export function useUsage() {
  const { data: usage, loading, error, refresh } = useAuthedFetch<UsageSummary | null>(fetchUsage, null, 'Could not load usage');
  return { usage, loading, error, refresh };
}
