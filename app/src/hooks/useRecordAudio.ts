import { useCallback, useRef, useState } from 'react';
import { NativeModules, Platform } from 'react-native';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { friendlyErrorMessage } from '@/api/http';
import { uploadSession } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { DebriefCard } from '@/models/debrief';

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

export function useRecordAudio() {
  const { accessToken } = useAuth();
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);
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
  // Null until createAsync fully resolves, so mid-creation status updates
  // (canRecord && !isRecording) can't trigger a spurious resume; cleared again on stop.
  const liveRecording = useRef<Audio.Recording | null>(null);

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
  }, [accessToken, recording, pendingRecording]);

  const stopRecording = useCallback(async (): Promise<DebriefCard | null> => {
    if (operationInProgress.current || (!recording && !pendingRecording) || !accessToken) return null;

    operationInProgress.current = true;
    setUploading(true);
    setError(null);
    try {
      let pending = pendingRecording;
      if (!pending && recording) {
        liveRecording.current = null;
        await recording.stopAndUnloadAsync();
        setRecording(null);
        const uri = recording.getURI();
        if (!uri) throw new Error('Missing recording URI');

        pending = {
          audio: { uri, name: recordingName(), type: recordingMimeType() },
          seconds: recordingMs > 0 ? recordingMs / 1000 : startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0,
        };
        setPendingRecording(pending);
        setForegroundService(false);
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      }
      if (!pending) return null;
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
      setForegroundService(false);
      setRecordingMs(0);
      startedAt.current = null;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      setUploading(false);
      operationInProgress.current = false;
    }
  }, [accessToken, recording, recordingMs, pendingRecording]);

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
    recordingSeconds: recordingMs / 1000,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}
