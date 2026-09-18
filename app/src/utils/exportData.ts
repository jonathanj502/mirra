import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export async function saveJsonDownload(filename: string, value: unknown) {
  const json = JSON.stringify(value, null, 2);
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (!FileSystem.cacheDirectory || !await Sharing.isAvailableAsync()) throw new Error('Sharing is unavailable on this device.');
  const path = `${FileSystem.cacheDirectory}${filename}`;
  try {
    await FileSystem.writeAsStringAsync(path, json);
    await Sharing.shareAsync(path, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Save your Mirra data' });
  } finally { await FileSystem.deleteAsync(path, { idempotent: true }); }
}
