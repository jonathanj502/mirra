import { createContext, createElement, useContext, useRef, useState, ReactNode } from 'react';
import { NativeModules, Platform } from 'react-native';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { friendlyErrorMessage } from '@/api/http';
import { useAuth } from '@/auth/AuthContext';
import { PendingRecording, recordingId } from '@/storage/pendingRecordings';
import { usePendingRecordings } from './usePendingRecordings';
import { usePrivacy } from '@/auth/PrivacyContext';
import { confirmRecordingPermission } from '@/utils/confirm';

// Android needs a foreground service holding the mic open once the app backgrounds;
// optional so web/iOS (and stale native builds) just no-op.
function setForegroundService(running: boolean) {
  if (Platform.OS !== 'android') return;
  const service = NativeModules.RecordingService;
  if (running) service?.startForegroundService();
  else service?.stopForegroundService();
}

function recordingName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return Platform.OS === 'web' ? `mirra-recording-${stamp}.webm` : `mirra-recording-${stamp}.m4a`;
}

function recordingMimeType() {
  return Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
}

function useRecorderState() {
  const { user } = useAuth();
  const { canProcess, reviewConsent } = usePrivacy();
  const queue = usePendingRecordings();
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the original if device storage is full; do not allow another capture to overwrite it.
  const unsaved = useRef<PendingRecording | null>(null);
  const owner = useRef<string | null>(null);
  const operationInProgress = useRef(false);
  const startedAt = useRef<number | null>(null);
  // Null until createAsync fully resolves, so mid-creation status updates
  // (canRecord && !isRecording) can't trigger a spurious resume; cleared again on stop.
  const liveRecording = useRef<Audio.Recording | null>(null);

  const startRecording = async () => {
    if (operationInProgress.current || recording || unsaved.current) return;
    if (!canProcess) { reviewConsent(); return; }
    setError(null);
    if (!user) {
      setError('Please sign in before recording a conversation.');
      return;
    }

    operationInProgress.current = true;
    setStarting(true);
    try {
      if (!await confirmRecordingPermission()) return;
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setError('Allow microphone access to record a conversation.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      setForegroundService(true);
      const created = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
        (status) => {
          setRecordingMs(status.durationMillis ?? 0);
          // Interruption (e.g. phone call) paused a still-valid recording: resume.
          // Retries every status tick until the audio session is available again.
          if (liveRecording.current && status.canRecord && !status.isRecording && !status.isDoneRecording) {
            liveRecording.current.startAsync().catch(() => {});
          }
        },
        500
      );
      liveRecording.current = created.recording;
      owner.current = user.id;
      startedAt.current = Date.now();
      setRecordingMs(created.status.durationMillis ?? 0);
      setRecording(created.recording);
    } catch {
      setForegroundService(false);
      setError('Could not start the microphone recording.');
    } finally {
      operationInProgress.current = false;
      setStarting(false);
    }
  };

  const stopRecording = async () => {
    if (operationInProgress.current || (!recording && !unsaved.current)) return;

    operationInProgress.current = true;
    setSaving(true);
    setError(null);
    try {
      if (!unsaved.current && recording) {
        liveRecording.current = null;
        const status = await recording.stopAndUnloadAsync();
        setRecording(null);
        const uri = recording.getURI();
        if (!uri) throw new Error('Missing recording URI');

        if (!owner.current) throw new Error('Missing recording owner');
        unsaved.current = {
          id: recordingId(), userId: owner.current,
          startedAt: new Date(startedAt.current ?? Date.now()).toISOString(),
          audio: { uri, name: recordingName(), type: recordingMimeType() },
          seconds: (status.durationMillis || recordingMs) / 1000,
        };
        setForegroundService(false);
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
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
      setForegroundService(false);
      setRecordingMs(0);
      startedAt.current = null;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      setSaving(false);
      operationInProgress.current = false;
    }
  };

  const toggleRecording = () => recording || unsaved.current ? stopRecording() : startRecording();

  return {
    isRecording: !!recording,
    ...queue,
    isSavingRecording: saving,
    isStartingRecording: starting,
    hasUnsavedRecording: !!unsaved.current,
    error,
    recordingSeconds: recordingMs / 1000,
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
