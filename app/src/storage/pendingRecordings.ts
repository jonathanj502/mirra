import * as FileSystem from 'expo-file-system/legacy';

export type PendingRecording = {
  id: string;
  userId: string;
  startedAt: string;
  seconds: number;
  title?: string;
  audio: { uri: string; name: string; type: string };
};

export function recordingId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function directory(userId: string, id = '') {
  if (!FileSystem.documentDirectory) throw new Error('Recording storage is unavailable.');
  return `${FileSystem.documentDirectory}pending-recordings/${encodeURIComponent(userId)}/${id}`;
}

export async function savePendingRecording(recording: PendingRecording): Promise<PendingRecording> {
  const folder = directory(recording.userId, recording.id);
  await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
  // Picker filenames are display metadata, not paths or our manifest filenames.
  const uri = `${folder}/audio`;
  // Copy before publishing the manifest; never move/delete the only original on a failed save.
  if (recording.audio.uri !== uri) await FileSystem.copyAsync({ from: recording.audio.uri, to: uri });
  const saved = { ...recording, audio: { ...recording.audio, uri } };
  await FileSystem.writeAsStringAsync(`${folder}/recording.tmp`, JSON.stringify(saved));
  await FileSystem.moveAsync({ from: `${folder}/recording.tmp`, to: `${folder}/recording.json` });
  if (FileSystem.cacheDirectory && recording.audio.uri.startsWith(FileSystem.cacheDirectory)) {
    await FileSystem.deleteAsync(recording.audio.uri, { idempotent: true }).catch(() => {});
  }
  return saved;
}

export async function listPendingRecordings(userId: string): Promise<PendingRecording[]> {
  const root = directory(userId);
  if (!(await FileSystem.getInfoAsync(root)).exists) return [];
  const recordings: PendingRecording[] = [];
  for (const id of await FileSystem.readDirectoryAsync(root)) {
    const manifest = `${root}${id}/recording.json`;
    const temporary = `${root}${id}/recording.tmp`;
    // A restart between the manifest write and rename can still recover the completed clip.
    const path = (await FileSystem.getInfoAsync(manifest)).exists ? manifest : temporary;
    if (!(await FileSystem.getInfoAsync(path)).exists) continue;
    const recording: PendingRecording = JSON.parse(await FileSystem.readAsStringAsync(path));
    if (recording.userId !== userId || recording.id !== id) throw new Error('Could not read saved recordings.');
    // Rebase the saved filename when iOS changes the application's container path.
    // Old queue entries used the original filename; new entries always use "audio".
    recording.audio.uri = `${root}${id}/${recording.audio.uri.split('/').pop()}`;
    recordings.push(recording);
  }
  return recordings.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export async function readPendingAudio(recording: PendingRecording) {
  if (!(await FileSystem.getInfoAsync(recording.audio.uri)).exists) throw new Error('The saved audio file is missing.');
  return recording.audio;
}

export function releasePendingAudio(_audio: PendingRecording['audio']) {}

export async function removePendingRecording(recording: PendingRecording) {
  await FileSystem.deleteAsync(directory(recording.userId, recording.id), { idempotent: true });
}
