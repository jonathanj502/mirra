import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform } from 'react-native';

export const AI_DISCLAIMER = 'We don’t sell your data. Mirra shares audio, transcripts, metrics, and chats with OpenAI for coaching. You control transcript saving.';
const RECORDING_NOTICE = 'Recording continues when your screen locks.';

// Consent is per account on this device. Bump the version if data use changes.
const consentKey = (userId: string) => `@mirra/ai-consent/v1/${userId}`;
const pending = new Map<string, Promise<boolean>>();

async function confirmConsent(userId: string, recording: boolean): Promise<boolean> {
  const key = consentKey(userId);
  const saved = await AsyncStorage.getItem(key);
  const allowed = saved === 'allowed' || saved === 'recording';
  if (allowed && (!recording || saved === 'recording')) return true;

  const title = allowed ? 'Background recording' : 'Privacy & AI';
  const message = [!allowed && AI_DISCLAIMER, recording && RECORDING_NOTICE].filter(Boolean).join('\n\n');
  const accepted = Platform.OS === 'web'
    ? window.confirm(`${title}\n\n${message}`)
    : await new Promise<boolean>((resolve) => {
      Alert.alert(title, message, [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: allowed ? 'Continue' : 'Allow', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
  if (!accepted) return false;
  await AsyncStorage.setItem(key, recording ? 'recording' : 'allowed');
  return true;
}

export function requestAIConsent(userId?: string, recording = false): Promise<boolean> {
  if (!userId) return Promise.resolve(false);
  const existing = pending.get(userId);
  if (existing) return existing.then((allowed) => allowed ? requestAIConsent(userId, recording) : false);
  const request = confirmConsent(userId, recording)
    .catch(() => { throw new Error('Could not save your privacy choice. Please try again.'); })
    .finally(() => pending.delete(userId));
  pending.set(userId, request);
  return request;
}

export async function withdrawAIConsent(userId: string): Promise<void> {
  await pending.get(userId)?.catch(() => {});
  await AsyncStorage.removeItem(consentKey(userId));
}
