import { fetchProgressSummary } from '@/api/client';
import { ProgressSummary } from '@/models/debrief';
import { useAuthedFetch } from './useAuthedFetch';

export function useProgressSummary() {
  const { data: progress, loading, error, refresh } = useAuthedFetch<ProgressSummary | null>(fetchProgressSummary, null, 'Could not load progress');
  return { progress, loading, error, refresh };
}
