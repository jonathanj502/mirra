import { useCallback, useState } from 'react';
import { fetchUserSettings, updateUserSettings } from '@/api/client';
import { UserSettings } from '@/models/debrief';
import { useAuthedFetch } from './useAuthedFetch';
import { friendlyErrorMessage } from '@/api/http';

export const DEFAULT_USER_SETTINGS: UserSettings = {
  aiConsentVersion: null,
  aiConsentAt: null,
  notificationsEnabled: false,
  weeklySummaryDay: 'sunday',
  weeklySummaryTime: 'evening',
  reflectionReminders: false,
  productUpdates: false,
  saveTranscripts: false,
  includeTranscriptInReflect: false,
  coachingTone: 'warm_reflective',
  coachingDepth: 'balanced',
};

export function useUserSettings(token: string | null) {
  const { data: settings, setData: setSettings, loading, error: loadError, refresh } = useAuthedFetch(
    fetchUserSettings, DEFAULT_USER_SETTINGS, 'Could not load settings'
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateSettings = useCallback(
    async (patch: Partial<UserSettings>) => {
      if (!token) return;
      const previous = settings;
      const optimistic = { ...settings, ...patch };
      setSettings(optimistic);
      setSaving(true);
      try {
        const saved = await updateUserSettings(token, patch);
        setSettings(saved);
        setError(null);
      } catch (err) {
        setSettings(previous);
        setError(friendlyErrorMessage(err, 'Could not save settings'));
      } finally {
        setSaving(false);
      }
    },
    [settings, token]
  );

  return { settings, loading, saving, error: error ?? loadError, loadError, refresh, updateSettings };
}
