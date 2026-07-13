import { useCallback, useRef, useState } from 'react';
import { Alert, NativeModules, Platform } from 'react-native';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
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
  const startedAt = useRef<number | null>(null);
  // Null until createAsync fully resolves, so mid-creation status updates
  // (canRecord && !isRecording) can't trigger a spurious resume; cleared again on stop.
  const liveRecording = useRef<Audio.Recording | null>(null);

  const startRecording = useCallback(async () => {
    if (!accessToken) {
      Alert.alert('Sign in required', 'Please sign in before recording a conversation.');
      return;
    }

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone needed', 'Allow microphone access to record a conversation.');
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
      Alert.alert('Recording failed', 'Could not start the microphone recording.');
    }
  }, [accessToken]);

  const stopRecording = useCallback(async (): Promise<DebriefCard | null> => {
    if (!recording || !accessToken) return null;

    setUploading(true);
    const current = recording;
    setRecording(null);
    liveRecording.current = null;
    try {
      await current.stopAndUnloadAsync();
      const uri = current.getURI();
      if (!uri) throw new Error('Missing recording URI');

      const elapsedSeconds =
        recordingMs > 0
          ? recordingMs / 1000
          : startedAt.current
            ? (Date.now() - startedAt.current) / 1000
            : 0;
      const name = recordingName();
      const response = await uploadSession(
        accessToken,
        { uri, name, type: recordingMimeType() },
        { title: 'Recorded conversation', clientDurationSeconds: elapsedSeconds }
      );
      return response.debrief;
    } catch {
      Alert.alert('Recording failed', 'Could not analyze that recording. Try a shorter recording or import an audio file.');
      return null;
    } finally {
      setForegroundService(false);
      setRecordingMs(0);
      startedAt.current = null;
      setUploading(false);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    }
  }, [accessToken, recording, recordingMs]);

  const toggleRecording = useCallback(async () => {
    return recording ? stopRecording() : startRecording().then(() => null);
  }, [recording, startRecording, stopRecording]);

  return {
    isRecording: !!recording,
    isUploadingRecording: uploading,
    recordingSeconds: recordingMs / 1000,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}
