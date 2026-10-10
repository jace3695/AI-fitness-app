import { installStorageLocks } from './storageProtocol.ts';
import { prepareLocalCloudState } from '../../app/data/cloudSync.ts';
import { verifyAuthenticatedStorageOwner } from '../../app/data/authenticatedStorageOwner.ts';
import { createLanguageSyncLifecycle, readLanguageSyncRequest } from '../../app/data/languageCloudSync.ts';
export function languageFixture(seed: Record<string, string | undefined> = {}) {
  const locks = installStorageLocks(), values = new Map(Object.entries(seed).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = {
    get length() { return values.size; }, key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, String(value)); }, removeItem(key: string) { values.delete(key); },
  };
  const window = Object.assign(new EventTarget(), { localStorage: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  return { storage, values, locks, window,
    async owner(userId = 'a') { return verifyAuthenticatedStorageOwner(storage, async () => ({ data: { user: { id: userId } }, error: null }), prepareLocalCloudState); },
    async request(userId = 'a') { const lease = await this.owner(userId), lifecycle = createLanguageSyncLifecycle(); return { lease, lifecycle, request: readLanguageSyncRequest(lease, lifecycle, storage) }; },
    restore() { locks.restore(); if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); },
  };
}
export function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
export const marker = (time = '2026-10-09T12:00:00.123456Z', id = '11111111-1111-4111-8111-111111111111') => `${time}|${id}`;
