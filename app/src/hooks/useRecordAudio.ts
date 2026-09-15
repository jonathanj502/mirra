import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { friendlyErrorMessage } from '@/api/http';
import { uploadSession } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { DebriefCard } from '@/models/debrief';
import { requestAIConsent } from '@/privacy/aiConsent';

function recordingName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return Platform.OS === 'web' ? `mirra-recording-${stamp}.webm` : `mirra-recording-${stamp}.m4a`;
}

function recordingMimeType() {
  return Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
}

export function useRecordAudio() {
  const { accessToken, user } = useAuth();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 500);
  const [recording, setRecording] = useState(false);
  const recordingMs = recorderState.durationMillis;
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ponytail: one pending clip survives tab switches, not app restarts; use a persisted outbox for restart recovery.
  const [pendingRecording, setPendingRecording] = useState<{
    audio: { uri: string; name: string; type: string };
    seconds: number;
  } | null>(null);
  const operationInProgress = useRef(false);
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (recording && !operationInProgress.current && recorderState.canRecord && !recorderState.isRecording) {
      // Resume a paused, still-valid recording after an audio interruption.
      try { recorder.record(); } catch { /* Retry on the next status update. */ }
    }
  }, [recording, recorderState, recorder]);

  const startRecording = useCallback(async () => {
    if (operationInProgress.current || recording || pendingRecording) return;
    setError(null);
    if (!accessToken) {
      setError('Please sign in before recording a conversation.');
      return;
    }

    operationInProgress.current = true;
    setStarting(true);
    try {
      if (!await requestAIConsent(user?.id, Platform.OS !== 'web')) return;
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Allow microphone access to record a conversation.');
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        allowsBackgroundRecording: Platform.OS !== 'web',
        interruptionMode: 'doNotMix',
        shouldRouteThroughEarpiece: false,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      setRecording(true);
    } catch (err) {
      setError(friendlyErrorMessage(err, 'Could not start the microphone recording.'));
    } finally {
      operationInProgress.current = false;
      setStarting(false);
    }
  }, [accessToken, user?.id, recording, pendingRecording, recorder]);

  const stopRecording = useCallback(async (): Promise<DebriefCard | null> => {
    if (operationInProgress.current || (!recording && !pendingRecording) || !accessToken) return null;

    operationInProgress.current = true;
    setUploading(true);
    setError(null);
    try {
      let pending = pendingRecording;
      if (!pending && recording) {
        const durationMillis = recorder.getStatus().durationMillis;
        await recorder.stop();
        setRecording(false);
        const uri = recorder.uri;
        if (!uri) throw new Error('Missing recording URI');

        pending = {
          audio: { uri, name: recordingName(), type: recordingMimeType() },
          seconds: durationMillis > 0 ? durationMillis / 1000 : startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0,
        };
        setPendingRecording(pending);
        await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }).catch(() => {});
      }
      if (!pending) return null;
      if (!await requestAIConsent(user?.id)) return null;
      const response = await uploadSession(
        accessToken,
        pending.audio,
        { title: 'Recorded conversation', clientDurationSeconds: pending.seconds }
      );
      setPendingRecording(null);
      return response.debrief;
    } catch (err) {
      const message = friendlyErrorMessage(
        err,
        'Could not analyze that recording. Please try uploading it again.'
      );
      setError(message);
      return null;
    } finally {
      startedAt.current = null;
      await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }).catch(() => {});
      setUploading(false);
      operationInProgress.current = false;
    }
  }, [accessToken, user?.id, recording, pendingRecording, recorder]);

  const discardRecording = useCallback(() => {
    if (operationInProgress.current || recording) return;
    setPendingRecording(null);
    setError(null);
  }, [recording]);

  const toggleRecording = useCallback(async () => {
    return recording || pendingRecording ? stopRecording() : startRecording().then(() => null);
  }, [recording, pendingRecording, startRecording, stopRecording]);

  return {
    isRecording: !!recording,
    isUploadingRecording: uploading,
    isStartingRecording: starting,
    hasPendingRecording: !!pendingRecording,
    error,
    discardRecording,
    recordingSeconds: recording ? recordingMs / 1000 : 0,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}
