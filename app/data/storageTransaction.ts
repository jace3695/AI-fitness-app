type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const JOURNAL_KEY = 'yeoni-storage-transaction-v1';

/** Recover an interrupted write before reading or synchronizing a snapshot. */
export function recoverStorageTransaction(storage: StorageLike) {
  const raw = storage.getItem(JOURNAL_KEY);
  if (!raw) return;
  const before = JSON.parse(raw) as Record<string, string | null>;
  // Remove new values first so restoring the old snapshot does not need extra quota.
  for (const key of Object.keys(before)) storage.removeItem(key);
  for (const [key, value] of Object.entries(before)) {
    if (value !== null) storage.setItem(key, value);
  }
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
    storage.removeItem(JOURNAL_KEY);
  } catch (error) {
    recoverStorageTransaction(storage);
    throw error;
  }
}

export const RECORDS_CHANGED_EVENT = 'yeoni-records-changed';
let notificationQueued = false;
export function notifyRecordsChanged() {
  if (typeof window === 'undefined' || notificationQueued) return;
  notificationQueued = true;
  queueMicrotask(() => {
    notificationQueued = false;
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(RECORDS_CHANGED_EVENT));
  });
}
