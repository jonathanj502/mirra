export async function openAudioSource(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('The saved audio file is missing.');
  const blob = await response.blob();
  return {
    size: blob.size,
    async read(start: number, end: number): Promise<Blob> { return blob.slice(start, end); },
    close() {},
  };
}
