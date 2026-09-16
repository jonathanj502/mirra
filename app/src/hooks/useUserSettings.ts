import { useCallback, useRef, useState } from 'react';
import { fetchUserSettings, updateUserSettings } from '@/api/client';
import { UserSettings } from '@/models/debrief';
import { useAuthedFetch } from './useAuthedFetch';
import { friendlyErrorMessage } from '@/api/http';

export const DEFAULT_USER_SETTINGS: UserSettings = {
  notificationsEnabled: false,
  weeklySummaryDay: 'sunday',
  weeklySummaryTime: 'evening',
  reflectionReminders: false,
  productUpdates: false,
  saveTranscripts: true,
  includeTranscriptInReflect: false,
  coachingTone: 'warm_reflective',
  coachingDepth: 'balanced',
  coachingGoal: 'general',
};

export function useUserSettings(token: string | null) {
  const { data: settings, setData: setSettings, loading, error: loadError, refresh } = useAuthedFetch(
    fetchUserSettings, DEFAULT_USER_SETTINGS, 'Could not load settings'
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writes = useRef(Promise.resolve());
  const latest = useRef(0);
  const pending = useRef(0);

  const updateSettings = useCallback(
    async (patch: Partial<UserSettings>) => {
      if (!token) return;
      const revision = ++latest.current;
      if (pending.current++ === 0) setError(null);
      setSettings(current => ({ ...current, ...patch }));
      setSaving(true);
      // Preserve the user's order when several switches are changed before a response arrives.
      const request = writes.current.then(() => updateUserSettings(token, patch));
      writes.current = request.then(() => {}, () => {});
      try {
        const saved = await request;
        if (revision === latest.current) setSettings(saved);
      } catch (err) {
        setError(friendlyErrorMessage(err, 'Could not save settings'));
        if (revision === latest.current) await refresh();
      } finally {
        setSaving(--pending.current > 0);
      }
    },
    [token, setSettings, refresh]
  );

  return { settings, loading, saving, error: error ?? loadError, loadError, refresh, updateSettings };
}
