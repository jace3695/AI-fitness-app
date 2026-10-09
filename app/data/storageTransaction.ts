type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const STORAGE_JOURNAL_KEY = 'yeoni-storage-transaction-v1';
export const STORAGE_GENERATION_KEY = 'yeoni-storage-generation-v1';
const JOURNAL_KEY = STORAGE_JOURNAL_KEY;

export const hasStorageTransaction = (storage: Pick<Storage, 'getItem'>) => storage.getItem(JOURNAL_KEY) !== null;
export const readStorageGeneration = (storage: Pick<Storage, 'getItem'>) => storage.getItem(STORAGE_GENERATION_KEY);

export class StorageSnapshotBusyError extends Error {
  constructor() { super('다른 창의 기록 저장이 끝난 뒤 다시 읽어 주세요.'); this.name = 'StorageSnapshotBusyError'; }
}

/** Reads never recover a journal: it may belong to a writer in another tab. */
export function readStorageSnapshot(storage: Pick<Storage, 'getItem' | 'length' | 'key'>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const generation = readStorageGeneration(storage);
    const journal = storage.getItem(JOURNAL_KEY);
    let before: Record<string, string | null> = {};
    if (journal !== null) {
      const parsed: unknown = JSON.parse(journal);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || Object.values(parsed).some(value => value !== null && typeof value !== 'string')) {
        throw new Error('저장 중인 기록의 복구 정보를 읽지 못했습니다. 원본을 유지합니다.');
      }
      before = parsed as Record<string, string | null>;
    }
    const values: Record<string, string> = Object.create(null);
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key === null || key === JOURNAL_KEY || key === STORAGE_GENERATION_KEY) continue;
      const value = storage.getItem(key);
      if (value !== null) values[key] = value;
    }
    // Restore deleted keys in the view and hide keys newly added by the writer.
    for (const [key, value] of Object.entries(before)) {
      if (value === null) delete values[key];
      else values[key] = value;
    }
    const afterJournal = storage.getItem(JOURNAL_KEY);
    const afterGeneration = readStorageGeneration(storage);
    if (journal !== afterJournal || generation !== afterGeneration) continue;
    const keys = Object.keys(values);
    return { generation, pending: journal !== null, length: keys.length,
      key: (index: number) => keys[index] ?? null,
      getItem: (key: string): string | null => Object.hasOwn(values, key) ? values[key] : null };
  }
  throw new StorageSnapshotBusyError();
}

function markTransactionBoundary(storage: StorageLike) {
  // Keep this after commit/rollback and before removing the journal. A reader
  // must detect a whole null→journal→null cycle between its samples (ABA).
  storage.setItem(STORAGE_GENERATION_KEY, crypto.randomUUID());
}

/** Explicit recovery only. Ordinary readers cannot know whether a peer is active. */
export function recoverStorageTransaction(storage: StorageLike) {
  const raw = storage.getItem(JOURNAL_KEY);
  if (!raw) return;
  const before = JSON.parse(raw) as Record<string, string | null>;
  // Remove new values first so restoring the old snapshot does not need extra quota.
  for (const key of Object.keys(before)) storage.removeItem(key);
  for (const [key, value] of Object.entries(before)) {
    if (value !== null) storage.setItem(key, value);
  }
  markTransactionBoundary(storage);
  storage.removeItem(JOURNAL_KEY);
}

/** All callers publish React state only after this synchronous commit succeeds. */
export function writeStorageBatch(storage: StorageLike, changes: Record<string, string | null>) {
  recoverStorageTransaction(storage);
  const before = Object.fromEntries(Object.keys(changes).map(key => [key, storage.getItem(key)]));
  // If the journal cannot be saved, none of the user's keys have been changed.
  storage.setItem(JOURNAL_KEY, JSON.stringify(before));
  try {
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
    markTransactionBoundary(storage);
    storage.removeItem(JOURNAL_KEY);
  } catch (error) {
    recoverStorageTransaction(storage);
    throw error;
  }
}

export const RECORDS_CHANGED_EVENT = 'yeoni-records-changed';
export const CLOUD_RECORDS_REFRESH_EVENT = 'yeoni-cloud-records-refresh';
/** A confirmed server command changed records without changing local storage. */
export function requestCloudRecordsRefresh(ownerId: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CLOUD_RECORDS_REFRESH_EVENT, { detail: { ownerId } }));
}
let notificationQueued = false;
export function notifyRecordsChanged() {
  if (typeof window === 'undefined' || notificationQueued) return;
  notificationQueued = true;
  queueMicrotask(() => {
    notificationQueued = false;
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(RECORDS_CHANGED_EVENT));
  });
}
