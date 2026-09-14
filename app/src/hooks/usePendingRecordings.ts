import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { uploadSession } from '@/api/client';
import { ApiError, friendlyErrorMessage } from '@/api/http';
import { supabase } from '@/api/supabase';
import { useAuth } from '@/auth/AuthContext';
import { usePrivacy } from '@/auth/PrivacyContext';
import { DebriefCard } from '@/models/debrief';
import {
  PendingRecording, listPendingRecordings, savePendingRecording,
  readPendingAudio, releasePendingAudio, removePendingRecording,
} from '@/storage/pendingRecordings';

export function usePendingRecordings() {
  const { user } = useAuth();
  const { canProcess } = usePrivacy();
  const [paused, setPaused] = useState(false);
  const pauseRequested = useRef(false);
  const abortUpload = useRef<AbortController | null>(null);
  const userId = user?.id;
  const [pending, setPending] = useState<(PendingRecording & { error?: string })[]>([]);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [completed, setCompleted] = useState<{ userId: string; debrief: DebriefCard } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const busyId = useRef<string | null>(null);
  const failures = useRef(new Map<string, { retryAt: number; message: string }>());
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let activeRequest: AbortController | undefined;
    setPending([]);
    setUploadingId(null);
    setError(null);

    async function pump() {
      if (!userId || running.current || cancelled) return;
      running.current = true;
      try {
        const rows = await listPendingRecordings(userId);
        if (cancelled) return;
        setPending(rows.map(row => ({ ...row, error: failures.current.get(row.id)?.message })));
        setError(null);
        if (pauseRequested.current || paused || !canProcess || (Platform.OS === 'web' && !navigator.onLine)) return;
        for (const row of rows) {
          if (cancelled || pauseRequested.current || (AppState.currentState && AppState.currentState !== 'active')) break;
          if ((failures.current.get(row.id)?.retryAt ?? 0) > Date.now()) continue;
          let audio: PendingRecording['audio'] | undefined;
          let stage = 'auth';
          busyId.current = row.id;
          try {
            // Refresh expired credentials before sending; never upload another account's audio.
            const { data, error: authError } = await supabase.auth.getSession();
            if (cancelled || pauseRequested.current) break;
            if (authError) throw authError;
            if (!data.session || data.session.user.id !== row.userId) break;
            setUploadingId(row.id);
            stage = 'storage';
            audio = await readPendingAudio(row);
            if (cancelled || pauseRequested.current) break;
            stage = 'upload';
            const controller = new AbortController();
            activeRequest = controller;
            abortUpload.current = controller;
            // Bound a stalled connection. Retrying this ID returns the same server debrief.
            const timeout = setTimeout(() => controller.abort(), 10 * 60_000);
            let response;
            try {
              response = await uploadSession(data.session.access_token, audio, {
                title: row.title || 'Recorded conversation', clientDurationSeconds: row.seconds,
                recordingId: row.id, startedAt: row.startedAt,
              }, controller.signal);
            } finally {
              clearTimeout(timeout);
              activeRequest = undefined;
              abortUpload.current = null;
            }
            // Delete only after the server acknowledges a saved debrief, even if sign-out intervened.
            stage = 'storage';
            await removePendingRecording(row);
            failures.current.delete(row.id);
            if (!cancelled) {
              setCompleted({ userId, debrief: response.debrief });
              setPending(items => items.filter(item => item.id !== row.id));
            }
          } catch (err) {
            if (cancelled || pauseRequested.current) break;
            const status = err instanceof ApiError ? err.status : 0;
            const delay = [410, 413, 415, 422].includes(status) ? Infinity : status === 402 ? 300_000 : status >= 500 || status === 429 ? 60_000 : 15_000;
            const message = status || stage === 'storage' ? friendlyErrorMessage(err, 'Could not access saved audio.')
              : 'Waiting for a connection. Upload resumes automatically.';
            failures.current.set(row.id, { retryAt: Date.now() + delay, message });
            setPending(items => items.map(item => item.id === row.id ? { ...item, error: message } : item));
            if (stage !== 'storage' && ![410, 413, 415, 422].includes(status)) break;
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
  }, [userId, canProcess, paused]);

  async function enqueue(recording: PendingRecording) {
    const saved = await savePendingRecording(recording);
    setPending(items => [...items.filter(item => item.id !== saved.id), saved]);
    wake.current();
  }

  async function discard(recording: PendingRecording) {
    if (busyId.current === recording.id || recording.userId !== userId) return;
    try {
      await removePendingRecording(recording);
      failures.current.delete(recording.id);
      setPending(items => items.filter(item => item.id !== recording.id));
    } catch (err) {
      setError(friendlyErrorMessage(err, 'Could not discard the recording.'));
    }
  }

  return {
    pauseUploads: () => { pauseRequested.current = true; abortUpload.current?.abort(); setPaused(true); },
    resumeUploads: () => { pauseRequested.current = false; setPaused(false); wake.current(); },
    pendingRecordings: pending.filter(row => row.userId === userId),
    uploadingId, queueError: error, enqueue, discard,
    latestDebrief: completed && completed.userId === userId ? completed.debrief : null,
  };
}
