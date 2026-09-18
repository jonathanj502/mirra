import { File } from 'expo-file-system';

export async function openAudioSource(uri: string) {
  const file = new File(uri);
  if (!file.exists) throw new Error('The saved audio file is missing.');
  const handle = file.open();
  return {
    size: file.size,
    async read(start: number, end: number): Promise<ArrayBuffer> {
      handle.offset = start;
      return handle.readBytes(end - start).buffer;
    },
    close: () => handle.close(),
  };
}
