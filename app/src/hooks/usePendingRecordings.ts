import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { discardRecording, uploadSession } from '@/api/client';
import { ApiError, friendlyErrorMessage } from '@/api/http';
import { supabase } from '@/api/supabase';
import { useAuth } from '@/auth/AuthContext';
import { MAX_RECORDING_SECONDS } from '@/config/recording';
import { hasAIConsent, requestAIConsent } from '@/privacy/aiConsent';
import { DebriefCard } from '@/models/debrief';
import {
  PendingRecording, listPendingRecordings, savePendingRecording,
  readPendingAudio, releasePendingAudio, removePendingRecording,
} from '@/storage/pendingRecordings';

export function usePendingRecordings() {
  const { user } = useAuth();
  const [paused, setPaused] = useState(false);
  const pauseRequested = useRef(false);
  const abortUpload = useRef<AbortController | null>(null);
  const userId = user?.id;
  const [pending, setPending] = useState<(PendingRecording & { error?: string })[]>([]);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState('Uploading and analyzing…');
  const [completed, setCompleted] = useState<{ userId: string; debrief: DebriefCard } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsAIConsent, setNeedsAIConsent] = useState(false);
  const running = useRef(false);
  const busyId = useRef<string | null>(null);
  const discarding = useRef(new Set<string>());
  const failures = useRef(new Map<string, { retryAt: number; message: string }>());
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let activeRequest: AbortController | undefined;
    setPending([]);
    setUploadingId(null);
    setError(null);
    setNeedsAIConsent(false);

    async function checkConsent() {
      const allowed = await hasAIConsent(userId!);
      if (cancelled) return false;
      setNeedsAIConsent(!allowed);
      return allowed;
    }

    async function pump() {
      if (!userId || running.current || cancelled) return;
      running.current = true;
      try {
        const rows = await listPendingRecordings(userId);
        if (cancelled) return;
        setPending(rows.map(row => ({ ...row, error: failures.current.get(row.id)?.message })));
        setError(null);
        if (pauseRequested.current || paused || (Platform.OS === 'web' && !navigator.onLine)) return;
        for (const row of rows) {
          if (cancelled || pauseRequested.current || (AppState.currentState && AppState.currentState !== 'active')) break;
          if ((failures.current.get(row.id)?.retryAt ?? 0) > Date.now()) continue;
          if (discarding.current.has(row.id)) continue;
          let audio: PendingRecording['audio'] | undefined;
          let stage = 'auth';
          busyId.current = row.id;
          try {
            // Refresh expired credentials before sending; never upload another account's audio.
            const { data, error: authError } = await supabase.auth.getSession();
            if (cancelled || pauseRequested.current) break;
            if (authError) throw authError;
            if (!data.session || data.session.user.id !== row.userId) break;
            stage = 'privacy';
            if (!await checkConsent()) break;
            setUploadingId(row.id);
            setUploadMessage('Preparing upload…');
            stage = 'storage';
            audio = await readPendingAudio(row);
            if (cancelled || pauseRequested.current) break;
            stage = 'privacy';
            if (!await checkConsent()) break;
            stage = 'upload';
            const controller = new AbortController();
            activeRequest = controller;
            abortUpload.current = controller;
            let response;
            try {
              response = await uploadSession(data.session.access_token, audio, {
                title: row.title || 'Recorded conversation', clientDurationSeconds: row.seconds > 0 ? Math.min(row.seconds, MAX_RECORDING_SECONDS) : undefined,
                recordingId: row.id, startedAt: row.startedAt,
              }, controller.signal, {
                onProgress: message => { if (!cancelled) setUploadMessage(message); },
                accessToken: async () => {
                  const refreshed = await supabase.auth.getSession();
                  if (cancelled || pauseRequested.current || refreshed.data.session?.user.id !== row.userId) {
                    throw new ApiError('Upload is paused until you sign in to this account.', 401);
                  }
                  if (refreshed.error) throw refreshed.error;
                  if (!await checkConsent()) throw new ApiError('AI processing is paused until you allow it.', 403);
                  return refreshed.data.session.access_token;
                },
              });
            } finally {
              activeRequest = undefined;
              abortUpload.current = null;
            }
            // Delete only after the server acknowledges a saved debrief, even if sign-out intervened.
            if (discarding.current.has(row.id)) break;
            stage = 'storage';
            await removePendingRecording(row);
            failures.current.delete(row.id);
            if (!cancelled && !discarding.current.has(row.id)) {
              setCompleted({ userId, debrief: response.debrief });
              setPending(items => items.filter(item => item.id !== row.id));
            }
          } catch (err) {
            if (cancelled || pauseRequested.current || discarding.current.has(row.id)) break;
            const status = err instanceof ApiError ? err.status : 0;
            const delay = [400, 410, 413, 415, 422].includes(status) ? Infinity : status === 402 ? 300_000 : status >= 500 || status === 429 ? 60_000 : 15_000;
            const message = stage === 'privacy' ? 'Could not check your privacy choice. Upload is paused.'
              : status || stage === 'storage' ? friendlyErrorMessage(err, 'Could not access saved audio.')
              : 'Waiting for a connection. Upload resumes automatically.';
            failures.current.set(row.id, { retryAt: Date.now() + delay, message });
            setPending(items => items.map(item => item.id === row.id ? { ...item, error: message } : item));
            if (stage !== 'storage' && ![400, 410, 413, 415, 422].includes(status)) break;
          } finally {
            if (audio) releasePendingAudio(audio);
            busyId.current = null;
            if (!cancelled) setUploadingId(null);
          }
        }
      } catch (err) {
        if (!cancelled) setError(friendlyErrorMessage(err, 'Could not read saved recordings.'));
      } finally {
        running.current = false;
      }
    }

    function reconnect() {
      for (const [id, failure] of failures.current) {
        if (failure.message.startsWith('Waiting for a connection')) failures.current.delete(id);
      }
      void pump();
    }
    wake.current = () => { void pump(); };
    void pump();
    // ponytail: foreground polling recovers native connectivity within 15s; OS background jobs need a native build.
    const timer = setInterval(() => { void pump(); }, 15_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') reconnect(); });
    if (Platform.OS === 'web') window.addEventListener('online', reconnect);
    return () => {
      cancelled = true;
      activeRequest?.abort();
      clearInterval(timer);
      subscription.remove();
      if (Platform.OS === 'web') window.removeEventListener('online', reconnect);
    };
  }, [userId, paused]);

  async function enqueue(recording: PendingRecording) {
    const saved = await savePendingRecording(recording);
    setPending(items => [...items.filter(item => item.id !== saved.id), saved]);
    wake.current();
  }

  async function discard(recording: PendingRecording) {
    if (recording.userId !== userId || discarding.current.has(recording.id)) return;
    discarding.current.add(recording.id);
    if (busyId.current === recording.id) abortUpload.current?.abort();
    try {
      const { data, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;
      if (data.session?.user.id !== recording.userId) throw new Error('Sign in to this account to discard its recording.');
      await discardRecording(data.session.access_token, recording.id);
      await removePendingRecording(recording);
      failures.current.delete(recording.id);
      setPending(items => items.filter(item => item.id !== recording.id));
    } catch (err) {
      setError(friendlyErrorMessage(err, 'Could not discard the recording.'));
    } finally {
      discarding.current.delete(recording.id);
    }
  }

  async function resumeUploads() {
    try {
      if (await requestAIConsent(userId)) {
        setNeedsAIConsent(false);
        wake.current();
      }
    } catch (err) {
      setError(friendlyErrorMessage(err, 'Could not save your privacy choice.'));
    }
  }

  return {
    needsAIConsent, resumeUploads,
    pauseUploads: () => { pauseRequested.current = true; abortUpload.current?.abort(); setPaused(true); },
    unpauseUploads: () => { pauseRequested.current = false; setPaused(false); wake.current(); },
    pendingRecordings: pending.filter(row => row.userId === userId),
    uploadingId, uploadMessage, queueError: error, enqueue, discard,
    latestDebrief: completed && completed.userId === userId ? completed.debrief : null,
  };
}
