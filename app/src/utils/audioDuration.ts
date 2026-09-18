import { createAudioPlayer } from 'expo-audio';

export async function getAudioDuration(uri: string): Promise<number> {
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
    if (!Number.isFinite(player.duration) || player.duration <= 0) {
      throw new Error('Could not read the audio duration. Try another file or format.');
    }
    return player.duration;
  } finally {
    clearTimeout(timeout);
    subscription?.remove();
    player.remove();
  }
}
