import { createContext, createElement, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { AudioModule, RecordingPresets, RecordingStatus, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { friendlyErrorMessage } from '@/api/http';
import { useAuth } from '@/auth/AuthContext';
import { PendingRecording, recordingId } from '@/storage/pendingRecordings';
import { requestAIConsent } from '@/privacy/aiConsent';
import { usePendingRecordings } from './usePendingRecordings';

let askedForRecordingNotification = false;
async function offerRecordingNotification() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33 || askedForRecordingNotification) return;
  askedForRecordingNotification = true;
  await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, {
    title: 'Recording notification',
    message: 'Show when Mirra is recording and tap the notification to return to your recording. No reminders or marketing notifications are sent.',
    buttonPositive: 'Continue', buttonNegative: 'Not now',
  }).catch(() => {});
}

const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 24000, bitRate: 64000, numberOfChannels: 1,
  web: { mimeType: 'audio/webm', bitsPerSecond: 64000 },
};

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
  // Expo retains the listener for the recorder's lifetime; account/queue closures must stay current.
  const onRecordingStatus = useRef<(status: RecordingStatus) => void>(() => {});
  const recorder = useAudioRecorder(RECORDING_OPTIONS, status => onRecordingStatus.current(status));
  onRecordingStatus.current = (status) => {
    const active = activeRecording.current;
    if (!status.isFinished || !active || stoppingManually.current
      || (status.url && active.audio.uri && status.url !== active.audio.uri)) return;
    setRecording(false);
    const uri = status.url || recorder.uri;
    if (uri) {
      activeRecording.current = null;
      const seconds = recorder.getStatus().durationMillis / 1000 || active.seconds;
      unsaved.current = { ...active, seconds, audio: { ...active.audio, uri } };
      // A notification Stop saves through the same durable queue as the app Stop button.
      void stopRecording();
    } else {
      setError(status.error || 'The microphone stopped. Keep Mirra open and try saving the recording.');
      void setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }).catch(() => {});
    }
  };
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
      await offerRecordingNotification();
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
      recorder.record();
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

  async function stopRecording(): Promise<boolean> {
    if (operationInProgress.current) return false;
    if (!activeRecording.current && !unsaved.current) return true;
    operationInProgress.current = true;
    setSaving(true);
    setError(null);
    try {
      const active = activeRecording.current;
      if (!unsaved.current && active) {
        active.seconds = recorder.getStatus().durationMillis / 1000 || active.seconds;
        stoppingManually.current = true;
        try {
          await recorder.stop();
        } catch (err) {
          if (recorder.getStatus().isRecording || !recorder.uri) throw err;
        }
        const uri = recorder.uri;
        if (!uri) throw new Error('Missing recording URI');
        unsaved.current = { ...active, audio: { ...active.audio, uri } };
        activeRecording.current = null;
        setRecording(false);
      }
      if (!unsaved.current) return true;
      await queue.enqueue(unsaved.current);
      if (Platform.OS === 'web') URL.revokeObjectURL(unsaved.current.audio.uri);
      unsaved.current = null;
      return true;
    } catch (err) {
      setError(unsaved.current
        ? 'Recording is not saved yet. Keep Mirra open, free some device storage, then save again.'
        : friendlyErrorMessage(err, 'Could not finish recording. Please try stopping it again.'));
      return false;
    } finally {
      if (!activeRecording.current) {
        await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }).catch(() => {});
      }
      stoppingManually.current = false;
      setSaving(false);
      operationInProgress.current = false;
    }
  }

  useEffect(() => {
    if (activeRecording.current && activeRecording.current.userId !== user?.id) void stopRecording();
  }, [user?.id, recording]);

  const toggleRecording = () => activeRecording.current || unsaved.current ? stopRecording() : startRecording();

  return {
    isRecording: recording,
    ...queue,
    isSavingRecording: saving,
    isStartingRecording: starting,
    hasUnsavedRecording: !!unsaved.current || (!!activeRecording.current && !recording),
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
