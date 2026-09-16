import { createContext, createElement, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { friendlyErrorMessage } from '@/api/http';
import { useAuth } from '@/auth/AuthContext';
import { PendingRecording, recordingId } from '@/storage/pendingRecordings';
import { usePendingRecordings } from './usePendingRecordings';
import { requestAIConsent } from '@/privacy/aiConsent';

// Android needs its native foreground service before opening the microphone.
let askedForRecordingNotification = false;
async function setForegroundService(running: boolean) {
  if (Platform.OS !== 'android') return;
  const service = NativeModules.RecordingService;
  if (running && !service) throw new Error('Recording needs the Mirra native Android build.');
  if (running) {
    if (Number(Platform.Version) >= 33 && !askedForRecordingNotification) {
      askedForRecordingNotification = true;
      // Optional: Android still shows the foreground service in Task Manager after denial.
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, {
        title: 'Recording notification',
        message: 'Show when Mirra is recording and tap the notification to return to your recording. No reminders or marketing notifications are sent.',
        buttonPositive: 'Continue', buttonNegative: 'Not now',
      }).catch(() => {});
    }
    await service.startForegroundService();
  }
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
    setError(null);
    if (!user) {
      setError('Please sign in before recording a conversation.');
      return;
    }

    operationInProgress.current = true;
    setStarting(true);
    try {
      if (!await requestAIConsent(user.id, true)) return;
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

      await setForegroundService(true);
      const created = await Audio.Recording.createAsync(
        { ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
          android: { ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android, numberOfChannels: 1, sampleRate: 24000, bitRate: 64000 },
          ios: { ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios, numberOfChannels: 1, sampleRate: 24000, bitRate: 64000 },
          web: { ...Audio.RecordingOptionsPresets.HIGH_QUALITY.web, bitsPerSecond: 64000 },
        },
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
    } catch (err) {
      setForegroundService(false);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      setError(friendlyErrorMessage(err, 'Could not start the microphone recording.'));
    } finally {
      operationInProgress.current = false;
      setStarting(false);
    }
  };

  const stopRecording = async () => {
    if (operationInProgress.current || (!recording && !unsaved.current)) return false;

    operationInProgress.current = true;
    setSaving(true);
    setError(null);
    try {
      if (!unsaved.current && recording) {
        liveRecording.current = null;
        let status;
        try { status = await recording.stopAndUnloadAsync(); }
        catch (err) {
          status = await recording.getStatusAsync().catch(() => null);
          if (!status?.isDoneRecording) {
            liveRecording.current = recording;
            throw err;
          }
        }
        const uri = recording.getURI();
        if (!uri) throw new Error('Missing recording URI');

        if (!owner.current) throw new Error('Missing recording owner');
        unsaved.current = {
          id: recordingId(), userId: owner.current,
          startedAt: new Date(startedAt.current ?? Date.now()).toISOString(),
          audio: { uri, name: recordingName(), type: recordingMimeType() },
          seconds: (status.durationMillis || recordingMs) / 1000,
        };
        setRecording(null);
        setForegroundService(false);
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      }
      if (!unsaved.current) return false;
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
      if (!liveRecording.current) {
        void setForegroundService(false);
        setRecordingMs(0);
        startedAt.current = null;
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      }
      setSaving(false);
      operationInProgress.current = false;
    }
  };

  useEffect(() => {
    // A revoked session or account switch must not leave an invisible microphone running.
    if (recording && owner.current !== user?.id) void stopRecording();
  }, [user?.id, recording]);

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
