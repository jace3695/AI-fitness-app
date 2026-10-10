import { handwritingSlot, handwritingRecordSignature, type HandwritingRecord } from './handwriting-draft.ts';
import { decodeHandwritingStorageRecord, encodeHandwritingStorageRecord } from './handwriting-storage-codec.ts';
export type HandwritingVersion = { revision: number; attemptId: string } | null;
export const handwritingVersion = (record: HandwritingRecord | null): HandwritingVersion => record ? { revision: record.revision, attemptId: record.attemptId } : null;
function database(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open('yeoni-handwriting', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('slots');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('handwriting_storage_blocked'));
  });
}
export async function readHandwritingRecord(owner: string, factory: IDBFactory = indexedDB): Promise<HandwritingRecord | null> {
  const db = await database(factory);
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('slots'), request = tx.objectStore('slots').get(handwritingSlot(owner));
      let value: unknown; request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
    return await decodeHandwritingStorageRecord(value, owner);
  } finally { db.close(); }
}
/** CAS is atomic across tabs. No digest/encoding awaits occur inside the transaction. */
export async function writeHandwritingRecord(record: HandwritingRecord, expected: HandwritingVersion, factory: IDBFactory = indexedDB): Promise<HandwritingRecord> {
  const prior = expected ? { ...expected } : null;
  const { runtime: next, stored: encoded } = await encodeHandwritingStorageRecord({ ...record, revision: (prior?.revision ?? 0) + 1 });
  const db = await database(factory);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('slots', 'readwrite'), store = tx.objectStore('slots'), request = store.get(handwritingSlot(next.owner));
      let conflict = false;
      request.onsuccess = () => {
        const current = request.result as HandwritingRecord | undefined;
        if (prior ? !current || current.revision !== prior.revision || current.attemptId !== prior.attemptId : current !== undefined) {
          conflict = true; tx.abort(); return;
        }
        store.put(encoded, handwritingSlot(next.owner));
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(Error(conflict ? 'handwriting_draft_changed' : 'handwriting_checkpoint_failed'));
    });
  } finally { db.close(); }
  const checked = await readHandwritingRecord(next.owner, factory);
  if (!checked || checked.revision !== next.revision || checked.attemptId !== next.attemptId || checked.state !== next.state || handwritingRecordSignature(checked) !== handwritingRecordSignature(next)) throw Error('handwriting_draft_changed');
  return checked;
}
