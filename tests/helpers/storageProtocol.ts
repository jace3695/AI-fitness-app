import { STORAGE_OWNER_KEY, STORAGE_READY_KEY, STORAGE_SESSION_KEY } from '../../app/data/storageTransaction.ts';

/** Deterministic exclusive lock fixture. It deliberately has no unlocked fallback. */
export function installStorageLocks() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const tails = new Map<string, Promise<unknown>>();
  let active = 0;
  const calls: string[] = [];
  const locks = { request<T>(name: string, _options: unknown, callback: () => T | Promise<T>): Promise<T> {
    calls.push(name);
    const operation = (tails.get(name) ?? Promise.resolve()).catch(() => {}).then(async () => {
      active++;
      try { return await callback(); } finally { active--; }
    });
    tails.set(name, operation);
    return operation;
  } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  return { locks, calls, get active() { return active; }, restore() {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous); else Reflect.deleteProperty(globalThis, 'navigator');
  } };
}
export function preparedStorageSeed(userId = 'fixture-user') {
  const epoch = JSON.stringify({ version: 2, id: crypto.randomUUID(), userId });
  return { [STORAGE_OWNER_KEY]: userId, [STORAGE_SESSION_KEY]: epoch, [STORAGE_READY_KEY]: JSON.stringify({ epoch, userId }) };
}
