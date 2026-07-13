import { fetchProfileSummary } from '@/api/client';
import { ProfileSummary } from '@/models/debrief';
import { useAuthedFetch } from './useAuthedFetch';

export function useProfileSummary() {
  const { data: summary, loading, error, refresh } = useAuthedFetch<ProfileSummary | null>(fetchProfileSummary, null, 'Could not load profile summary');
  return { summary, loading, error, refresh };
}
