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
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ponytail: one pending clip survives tab switches, not app restarts; use a persisted outbox for restart recovery.
  const [pendingRecording, setPendingRecording] = useState<{
    audio: { uri: string; name: string; type: string };
    seconds: number;
  } | null>(null);
  const operationInProgress = useRef(false);
  const activeRecording = useRef<{ uri: string | null; durationMillis: number } | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, (status) => {
    const active = activeRecording.current;
    if (!status.isFinished || !active || (status.url && active.uri && status.url !== active.uri)) return;
    activeRecording.current = null;
    setRecording(false);
    if (status.url) {
      setPendingRecording({
        audio: { uri: status.url, name: recordingName(), type: recordingMimeType() },
        seconds: active.durationMillis / 1000,
      });
    }
    if (status.hasError || !status.url) {
      setError(status.error || 'The microphone stopped unexpectedly. Please try recording again.');
    }
    void setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }).catch(() => {});
  });
  const recorderState = useAudioRecorderState(recorder, 500);
  const recordingMs = recorderState.durationMillis;
  useEffect(() => {
    if (activeRecording.current && recorderState.durationMillis > 0) {
      activeRecording.current.durationMillis = recorderState.durationMillis;
    }
    // Expo handles interruption pause/resume natively; do not restart while another app owns the mic.
  }, [recorderState]);

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
      activeRecording.current = { uri: recorder.uri, durationMillis: 0 };
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
        const durationMillis = recorder.getStatus().durationMillis || activeRecording.current?.durationMillis || 0;
        // This path handles the app's Stop button; ignore its duplicate native completion event.
        activeRecording.current = null;
        await recorder.stop();
        setRecording(false);
        const uri = recorder.uri;
        if (!uri) throw new Error('Missing recording URI');

        pending = {
          audio: { uri, name: recordingName(), type: recordingMimeType() },
          seconds: durationMillis / 1000,
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
