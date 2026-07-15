import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { friendlyErrorMessage } from '@/api/http';
import { uploadSession } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { DebriefCard } from '@/models/debrief';
import { titleFromFilename } from '@/utils/timeFormat';

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
  const { accessToken } = useAuth();
  const [importing, setImporting] = useState(false);

  const importAudio = useCallback(async (): Promise<DebriefCard | null> => {
    setImporting(true);
    try {
      if (!accessToken) {
        Alert.alert('Sign in required', 'Please sign in before uploading a conversation.');
        return null;
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: AUDIO_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets?.length) return null;

      const asset = result.assets[0];
      const size = asset.size ?? 0;
      if (size > MAX_BYTES) {
        Alert.alert(
          'File too large',
          'Please choose an audio file under 25 MB.'
        );
        return null;
      }

      const durationSeconds = await getAudioDuration(asset.uri);
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
      Alert.alert('Import failed', message);
      return null;
    } finally {
      setImporting(false);
    }
  }, [accessToken]);

  return { importAudio, importing };
}
