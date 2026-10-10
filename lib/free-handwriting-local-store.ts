import { freeSlot, freeRecordEqual, parseFreeRecord, type FreeRecord } from './free-handwriting-draft.ts';
function database(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open('yeoni-free-handwriting', 1); let abandoned = false;
    request.onupgradeneeded = () => request.result.createObjectStore('slots');
    request.onsuccess = () => { if (abandoned) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { abandoned = true; reject(Error('free_handwriting_storage_blocked')); };
  });
}
export async function readFreeRecord(owner: string, factory: IDBFactory = indexedDB): Promise<FreeRecord | null> {
  const db = await database(factory);
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('slots'), request = tx.objectStore('slots').get(freeSlot(owner)); let value: unknown;
      request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
    return await parseFreeRecord(value, owner);
  } finally { db.close(); }
}
/** Validate outside the transaction, compare the complete recognized prior value inside it. */
export async function writeFreeRecord(record: FreeRecord, expected: FreeRecord | null, factory: IDBFactory = indexedDB): Promise<FreeRecord> {
  const next = structuredClone({ ...record, revision: (expected?.revision ?? 0) + 1 });
  await parseFreeRecord(next, record.owner);
  if (expected) await parseFreeRecord(expected, record.owner);
  const db = await database(factory);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('slots', 'readwrite'), store = tx.objectStore('slots'), request = store.get(freeSlot(record.owner)); let conflict = false; let failure: unknown;
      request.onsuccess = () => {
        if (expected ? !freeRecordEqual(request.result, expected) : request.result !== undefined) { conflict = true; tx.abort(); return; }
        try { store.put(next, freeSlot(record.owner)); } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(failure ?? Error(conflict ? 'free_handwriting_draft_changed' : 'free_handwriting_checkpoint_failed'));
    });
  } finally { db.close(); }
  const checked = await readFreeRecord(record.owner, factory);
  if (!checked || !freeRecordEqual(checked, next)) throw Error('free_handwriting_draft_changed');
  return checked;
}
