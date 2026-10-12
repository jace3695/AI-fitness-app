import type { Page } from '@playwright/test';

// Reproduce a slow local confirmation: release the pending 250ms checkpoint
// while the real IndexedDB confirmation transaction is still in progress.
// The application, Auth/PostgREST requests and stored records remain real.
export async function delayDrawingCheckpointUntilConfirmation(page: Page) {
  await page.evaluate(() => {
    const schedule = window.setTimeout.bind(window);
    const cancel = window.clearTimeout.bind(window);
    const put = IDBObjectStore.prototype.put;
    const waiting = new Map<number, () => void>();
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay !== 250 || typeof handler !== 'function') return schedule(handler, delay, ...args);
      const id = schedule(() => {}, 0);
      cancel(id);
      waiting.set(id, () => handler(...args));
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => { if (id !== undefined) waiting.delete(id); cancel(id); }) as typeof window.clearTimeout;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      const result = key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (this.transaction.db.name === 'yeoni-drawing' && this.name === 'records'
        && typeof key === 'string' && key.startsWith('draft:')
        && value && typeof value === 'object' && 'pending' in value && value.pending === false) {
        window.setTimeout = schedule;
        window.clearTimeout = cancel;
        IDBObjectStore.prototype.put = put;
        const callbacks = [...waiting.values()]; waiting.clear();
        callbacks.forEach(callback => callback());
      }
      return result;
    };
  });
}

export async function localDrawingConfirmation(page: Page, owner: string, attemptId: string) {
  return page.evaluate(async ({ owner, attemptId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('yeoni-drawing', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ pending: boolean; revision: number; baseRevision: number }>((resolve, reject) => {
        const request = db.transaction('records').objectStore('records').get(`draft:${owner}:${attemptId}`);
        request.onsuccess = () => resolve({ pending: request.result.pending, revision: request.result.attempt.revision, baseRevision: request.result.baseRevision });
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }, { owner, attemptId });
}
