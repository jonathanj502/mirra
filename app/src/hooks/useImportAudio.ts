import { useCallback, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { createAudioPlayer } from 'expo-audio';
import { friendlyErrorMessage } from '@/api/http';
import { uploadSession } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { DebriefCard } from '@/models/debrief';
import { titleFromFilename } from '@/utils/timeFormat';
import { requestAIConsent } from '@/privacy/aiConsent';

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
  const player = createAudioPlayer({ uri });
  let subscription: ReturnType<typeof player.addListener> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!player.isLoaded) {
      await new Promise<void>((resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Could not read the audio file. Try another format.'));
        }, 10000);
        subscription = player.addListener('playbackStatusUpdate', (status) => {
          if (status.isLoaded) resolve();
        });
        if (player.isLoaded) resolve();
      });
    }
    return Number.isFinite(player.duration) ? player.duration : 0;
  } finally {
    clearTimeout(timeout);
    subscription?.remove();
    player.remove();
  }
}

function mimeTypeFor(name: string, provided?: string | null): string {
  if (provided && provided !== 'application/octet-stream') return provided;
  const ext = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
  if (ext === 'ogg') return 'audio/ogg';
  if (ext === 'aac') return 'audio/aac';
  return 'audio/mp4';
}

export function useImportAudio() {
  const { accessToken, user } = useAuth();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importAudio = useCallback(async (): Promise<DebriefCard | null> => {
    setImporting(true);
    setError(null);
    try {
      if (!accessToken) {
        setError('Please sign in before uploading a conversation.');
        return null;
      }

      if (!await requestAIConsent(user?.id)) return null;
      const result = await DocumentPicker.getDocumentAsync({
        type: AUDIO_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets?.length) return null;

      const asset = result.assets[0];
      const size = asset.size ?? 0;
      if (size > MAX_BYTES) {
        setError('Please choose an audio file under 25 MB.');
        return null;
      }

      const durationSeconds = await getAudioDuration(asset.uri);
      if (!await requestAIConsent(user?.id)) return null;
      const response = await uploadSession(
        accessToken,
        { uri: asset.uri, name: asset.name, type: mimeTypeFor(asset.name, asset.mimeType) },
        { title: titleFromFilename(asset.name), clientDurationSeconds: durationSeconds }
      );

      return response.debrief;
    } catch (err) {
      const message = friendlyErrorMessage(
        err,
        'Could not analyze that audio file. Try another format or a shorter recording.'
      );
      setError(message);
      return null;
    } finally {
      setImporting(false);
    }
  }, [accessToken, user?.id]);

  return { importAudio, importing, error };
}
