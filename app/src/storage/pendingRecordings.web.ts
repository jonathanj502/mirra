import type { PendingRecording } from './pendingRecordings';
export type { PendingRecording } from './pendingRecordings';

export function recordingId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type StoredRecording = PendingRecording & { blob: Blob };

// IndexedDB commits the bytes and metadata together; blob: URLs alone do not survive reloads.
async function transaction<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('mirra-recordings', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('pending', { keyPath: 'id' });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('pending', mode);
      const result = request(tx.objectStore('pending'));
      tx.oncomplete = () => resolve(result.result);
      tx.onabort = () => reject(tx.error ?? new Error('Could not save recording on this device.'));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function savePendingRecording(recording: PendingRecording): Promise<PendingRecording> {
  const response = await fetch(recording.audio.uri);
  if (!response.ok) throw new Error('Could not read the recording.');
  const blob = await response.blob();
  const saved = { ...recording, audio: { ...recording.audio, uri: '' } };
  await transaction('readwrite', store => store.put({ ...saved, blob }));
  // Best effort: browsers may still clear site data when the user requests it.
  void navigator.storage?.persist?.().catch(() => {});
  return saved;
}

export async function listPendingRecordings(userId: string): Promise<PendingRecording[]> {
  const rows = await transaction<StoredRecording[]>('readonly', store => store.getAll());
  return rows.filter(row => row.userId === userId).map(({ blob, ...recording }) => recording)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export async function readPendingAudio(recording: PendingRecording) {
  const row = await transaction<StoredRecording | undefined>('readonly', store => store.get(recording.id));
  if (!row || row.userId !== recording.userId) throw new Error('The saved audio file is missing.');
  return { ...recording.audio, uri: URL.createObjectURL(row.blob) };
}

export function releasePendingAudio(audio: PendingRecording['audio']) {
  URL.revokeObjectURL(audio.uri);
}

export async function removePendingRecording(recording: PendingRecording) {
  await transaction('readwrite', store => store.delete(recording.id));
}

export async function clearPendingRecordings(userId: string) {
  for (const recording of await listPendingRecordings(userId)) await removePendingRecording(recording);
}
