import { createContext, createElement, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { Platform } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { friendlyErrorMessage } from '@/api/http';
import { useAuth } from '@/auth/AuthContext';
import { PendingRecording, recordingId } from '@/storage/pendingRecordings';
import { requestAIConsent } from '@/privacy/aiConsent';
import { MAX_RECORDING_SECONDS } from '@/config/recording';
import { usePendingRecordings } from './usePendingRecordings';

function recordingName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return Platform.OS === 'web' ? `mirra-recording-${stamp}.webm` : `mirra-recording-${stamp}.m4a`;
}

function recordingMimeType() {
  return Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
}

function useRecorderState() {
  const { user } = useAuth();
  const queue = usePendingRecordings();
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the original if device storage is full; another capture must not overwrite it.
  const unsaved = useRef<PendingRecording | null>(null);
  const activeRecording = useRef<PendingRecording | null>(null);
  const operationInProgress = useRef(false);
  const stoppingManually = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, (status) => {
    const active = activeRecording.current;
    if (!status.isFinished || !active || stoppingManually.current
      || (status.url && active.audio.uri && status.url !== active.audio.uri)) return;
    activeRecording.current = null;
    setRecording(false);
    if (status.url) {
      unsaved.current = { ...active, audio: { ...active.audio, uri: status.url } };
      // Native duration limits and notification Stop use the same durable save path.
      void stopRecording();
    } else {
      setError(status.error || 'The microphone stopped unexpectedly. Please try recording again.');
      void setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }).catch(() => {});
    }
  });
  const recorderState = useAudioRecorderState(recorder, 500);
  useEffect(() => {
    if (activeRecording.current && recorderState.durationMillis > 0) {
      activeRecording.current.seconds = recorderState.durationMillis / 1000;
    }
    // Expo handles interruption pause/resume natively; do not compete for the microphone.
  }, [recorderState]);

  async function startRecording() {
    if (operationInProgress.current || activeRecording.current || unsaved.current) return;
    setError(null);
    if (!user) {
      setError('Please sign in before recording a conversation.');
      return;
    }

    operationInProgress.current = true;
    setStarting(true);
    try {
      if (!await requestAIConsent(user.id, Platform.OS !== 'web')) return;
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
      activeRecording.current = {
        id: recordingId(), userId: user.id, startedAt: new Date().toISOString(), seconds: 0,
        audio: { uri: Platform.OS === 'web' ? '' : recorder.uri ?? '', name: recordingName(), type: recordingMimeType() },
      };
      recorder.record({ forDuration: MAX_RECORDING_SECONDS });
      setRecording(!!activeRecording.current);
    } catch (err) {
      activeRecording.current = null;
      await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }).catch(() => {});
      setError(friendlyErrorMessage(err, 'Could not start the microphone recording.'));
    } finally {
      operationInProgress.current = false;
      setStarting(false);
      if (unsaved.current) void stopRecording();
    }
  }

  async function stopRecording() {
    if (operationInProgress.current || (!activeRecording.current && !unsaved.current)) return;
    operationInProgress.current = true;
    setSaving(true);
    setError(null);
    try {
      const active = activeRecording.current;
      if (!unsaved.current && active) {
        active.seconds = recorder.getStatus().durationMillis / 1000 || active.seconds;
        stoppingManually.current = true;
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) throw new Error('Missing recording URI');
        unsaved.current = { ...active, audio: { ...active.audio, uri } };
        activeRecording.current = null;
        setRecording(false);
      }
      if (!unsaved.current) return;
      await queue.enqueue(unsaved.current);
      if (Platform.OS === 'web') URL.revokeObjectURL(unsaved.current.audio.uri);
      unsaved.current = null;
    } catch (err) {
      setError(unsaved.current
        ? 'Recording is not saved yet. Keep Mirra open, free some device storage, then save again.'
        : friendlyErrorMessage(err, 'Could not finish recording. Please try stopping it again.'));
    } finally {
      if (!activeRecording.current) {
        await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }).catch(() => {});
      }
      stoppingManually.current = false;
      setSaving(false);
      operationInProgress.current = false;
    }
  }

  const toggleRecording = () => activeRecording.current || unsaved.current ? stopRecording() : startRecording();

  return {
    isRecording: recording,
    ...queue,
    isSavingRecording: saving,
    isStartingRecording: starting,
    hasUnsavedRecording: !!unsaved.current,
    error,
    recordingSeconds: recording ? recorderState.durationMillis / 1000 : 0,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}

const RecordingContext = createContext<ReturnType<typeof useRecorderState> | null>(null);

export function RecordingProvider({ children }: { children: ReactNode }) {
  return createElement(RecordingContext.Provider, { value: useRecorderState() }, children);
}

export function useRecordAudio() {
  const value = useContext(RecordingContext);
  if (!value) throw new Error('useRecordAudio must be used within RecordingProvider');
  return value;
}
