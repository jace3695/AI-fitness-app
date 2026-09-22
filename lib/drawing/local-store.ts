import { parseAttempt, type Attempt } from "./model.ts";

// One atomic record per attempt. Never use another account's cached artwork.
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("yeoni-drawing", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function localRead<T>(key: string): Promise<T | undefined> {
  const db = await database();
  try { return await new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction("records").objectStore("records").get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
export async function localWrite(key: string, value: unknown) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    if (value === undefined) tx.objectStore("records").delete(key);
    else tx.objectStore("records").put(value, key);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export const draftKey = (owner: string, attemptId: string) => `draft:${owner}:${attemptId}`;
export type LocalDraft = { attempt: Attempt; baseRevision: number; pending: boolean };
export async function localDrafts(owner: string): Promise<LocalDraft[]> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const values: LocalDraft[] = [];
    const request = db.transaction("records").objectStore("records").openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(values); return; }
      if (String(cursor.key).startsWith(`draft:${owner}:`) && cursor.value?.attempt?.user_id === owner && cursor.value.pending) {
        try { values.push({ ...cursor.value, attempt: parseAttempt(cursor.value.attempt) }); }
        catch { reject(Error("invalid local drawing")); return; }
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
