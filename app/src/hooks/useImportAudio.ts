import { useCallback, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { friendlyErrorMessage } from '@/api/http';
import { useRecordAudio } from '@/hooks/useRecordAudio';
import { recordingId } from '@/storage/pendingRecordings';
import { useAuth } from '@/auth/AuthContext';
import { DebriefCard } from '@/models/debrief';
import { titleFromFilename } from '@/utils/timeFormat';
import { usePrivacy } from '@/auth/PrivacyContext';
import { confirmRecordingPermission } from '@/utils/confirm';

const MAX_BYTES = 25 * 1024 * 1024;
const AUDIO_TYPES = [
  'audio/*',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-m4a',
  'audio/x-wav',
  'audio/ogg',
  'audio/aac',
];

async function getAudioDuration(uri: string): Promise<number> {
  const { sound, status } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
  try {
    if (status.isLoaded && status.durationMillis != null) {
      return status.durationMillis / 1000;
    }
    return 0;
  } finally {
    await sound.unloadAsync();
  }
}

function mimeTypeFor(name: string, provided?: string | null): string {
  if (provided && ['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/ogg','audio/aac','audio/webm'].includes(provided)) return provided;
  const ext = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
  if (ext === 'ogg') return 'audio/ogg';
  if (ext === 'aac') return 'audio/aac';
  if (ext === 'webm') return 'audio/webm';
  throw new Error('Choose an M4A, MP3, WAV, OGG, AAC or WebM audio file.');
}

export function useImportAudio() {
  const { user } = useAuth();
  const { enqueue } = useRecordAudio();
  const { canProcess, reviewConsent } = usePrivacy();
  const selecting = useRef(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importAudio = useCallback(async (): Promise<DebriefCard | null> => {
    if (selecting.current) return null;
    if (!canProcess) { reviewConsent(); return null; }
    selecting.current = true;
    setImporting(true);
    setError(null);
    try {
      if (!user) {
        setError('Please sign in before uploading a conversation.');
        return null;
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: AUDIO_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets?.length) return null;
      if (!await confirmRecordingPermission()) return null;

      const asset = result.assets[0];
      const size = asset.size ?? 0;
      if (size > MAX_BYTES) {
        setError('Please choose an audio file under 25 MB.');
        return null;
      }

      // The original file remains with its owner; save a durable copy before any network request.
      const durationSeconds = await getAudioDuration(asset.uri).catch(() => 0);
      const id = recordingId();
      const type = mimeTypeFor(asset.name, asset.mimeType);
      const extension = type.includes('webm') ? 'webm' : type.includes('wav') ? 'wav' : type.includes('mpeg') ? 'mp3' : type.includes('ogg') ? 'ogg' : type.includes('aac') ? 'aac' : 'm4a';
      await enqueue({ id, userId: user.id, startedAt: new Date().toISOString(), seconds: durationSeconds,
        title: titleFromFilename(asset.name).slice(0, 200), audio: { uri: asset.uri, name: `mirra-import-${id}.${extension}`, type } });
      return null;
    } catch (err) {
      const message = friendlyErrorMessage(
        err,
        'Could not analyze that audio file. Try another format or a shorter recording.'
      );
      setError(message);
      return null;
    } finally {
      selecting.current = false;
      setImporting(false);
    }
  }, [user, enqueue, canProcess, reviewConsent]);

  return { importAudio, importing, error };
}
