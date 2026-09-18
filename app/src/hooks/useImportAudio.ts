import { useCallback, useEffect, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { getAudioDuration } from '@/utils/audioDuration';
import { File } from 'expo-file-system';
import { friendlyErrorMessage } from '@/api/http';
import { useAuth } from '@/auth/AuthContext';
import { useRecordAudio } from '@/hooks/useRecordAudio';
import { recordingId } from '@/storage/pendingRecordings';
import { titleFromFilename } from '@/utils/timeFormat';
import { hasAIConsent, requestAIConsent } from '@/privacy/aiConsent';
import { MAX_AUDIO_BYTES, MAX_RECORDING_SECONDS } from '@/config/recording';

const AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-m4a',
  'audio/x-wav',
  'audio/ogg',
  'audio/aac',
  'audio/webm',
];

function mimeTypeFor(name: string, provided?: string | null): string {
  const type = provided?.split(';', 1)[0].trim().toLowerCase();
  if (type && type !== 'application/octet-stream') return type;
  const ext = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
  if (ext === 'ogg') return 'audio/ogg';
  if (ext === 'aac') return 'audio/aac';
  if (ext === 'webm') return 'audio/webm';
  return '';
}

export function useImportAudio() {
  const { user } = useAuth();
  const { enqueue } = useRecordAudio();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentUserId = useRef(user?.id);
  currentUserId.current = user?.id;
  const activeImport = useRef<AbortController | null>(null);
  useEffect(() => () => { activeImport.current?.abort(); }, [user?.id]);

  const importAudio = useCallback(async (): Promise<void> => {
    if (activeImport.current) return;
    const controller = new AbortController();
    activeImport.current = controller;
    const userId = user?.id;
    const isCurrent = () => !controller.signal.aborted && currentUserId.current === userId;
    setImporting(true);
    setError(null);
    try {
      if (!userId) {
        setError('Please sign in before uploading a conversation.');
        return;
      }

      if (!await requestAIConsent(userId) || !isCurrent()) return;
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*', ...AUDIO_TYPES],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (!isCurrent() || result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const type = mimeTypeFor(asset.name, asset.mimeType);
      if (!AUDIO_TYPES.includes(type)) {
        setError('Unsupported audio type. Choose M4A, MP3, WAV, WebM, AAC, or OGG.');
        return;
      }
      const size = asset.size ?? asset.file?.size ?? new File(asset.uri).size;
      if (!Number.isFinite(size) || size <= 0) {
        setError('Could not read the audio file size. Choose a nonempty audio file.');
        return;
      }
      if (size > MAX_AUDIO_BYTES) {
        setError('Please choose an audio file of 100 MiB or smaller.');
        return;
      }

      // Native players cannot read every supported format (for example WebM on Apple).
      // Zero means unknown locally; the server always validates actual decoded duration.
      const durationSeconds = await getAudioDuration(asset.uri).catch(err => {
        if (type !== 'audio/webm') throw err;
        return 0;
      });
      if (!isCurrent()) return;
      // Apple includes encoder padding in MP3 metadata; this does not extend the server limit.
      if (durationSeconds > MAX_RECORDING_SECONDS + 1) {
        setError('Please choose a conversation no longer than 23 minutes 20 seconds.');
        return;
      }
      if (!await requestAIConsent(userId) || !isCurrent()) return;
      if (!await hasAIConsent(userId) || !isCurrent()) return;
      await enqueue({
        id: recordingId(), userId, startedAt: new Date().toISOString(), seconds: durationSeconds,
        audio: { uri: asset.uri, name: asset.name, type }, title: titleFromFilename(asset.name),
      }).catch(() => {
        throw new Error('Could not save this import on your device. Your original file is unchanged. Please try again.');
      });
    } catch (err) {
      if (!isCurrent()) return;
      const message = friendlyErrorMessage(
        err,
        'Could not analyze that audio file. Try another format or a shorter recording.'
      );
      setError(message);
    } finally {
      activeImport.current = null;
      setImporting(false);
    }
  }, [enqueue, user?.id]);

  return { importAudio, importing, error };
}
