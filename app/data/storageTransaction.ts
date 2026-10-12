export type StorageReader = Pick<Storage, 'getItem' | 'length' | 'key'>;
export type TransactionStorage = StorageReader & Pick<Storage, 'setItem' | 'removeItem'>;
export const STORAGE_JOURNAL_KEY = 'yeoni-storage-transaction-v1';
export const STORAGE_GENERATION_KEY = 'yeoni-storage-generation-v1';
export const STORAGE_PROTOCOL_KEY = 'yeoni-storage-transaction-v2';
export const STORAGE_LOCK_NAME = 'yeoni-shared-local-storage-v2';
export const STORAGE_OWNER_KEY = 'fitness-cloud-sync-user';
export const STORAGE_SESSION_KEY = 'fitness-cloud-sync-epoch';
export const STORAGE_READY_KEY = 'fitness-cloud-sync-ready';
export const CLOUD_SESSION_CHANGED_EVENT = 'yeoni-cloud-session-changed';

export class StorageSnapshotBusyError extends Error {
  constructor() { super('다른 창의 기록 저장이 끝난 뒤 다시 읽어 주세요.'); this.name = 'StorageSnapshotBusyError'; }
}
export class StorageCorruptionError extends Error {
  constructor() { super('저장 중인 기록의 복구 정보를 읽지 못했습니다. 원본을 유지합니다.'); this.name = 'StorageCorruptionError'; }
}
export class StorageLegacyMigrationRequiredError extends Error {
  constructor() { super('이전 버전의 저장 복구 정보가 남아 있습니다. 모든 이전 창을 닫고 별도 복구 절차를 진행해야 합니다. 기록은 그대로 보존했습니다.'); this.name = 'StorageLegacyMigrationRequiredError'; }
}
export class StorageLocksUnavailableError extends Error {
  constructor() { super('이 브라우저에서는 안전한 기록 저장을 지원하지 않습니다. Web Locks를 지원하는 최신 브라우저를 사용해 주세요.'); this.name = 'StorageLocksUnavailableError'; }
}
export class StorageSessionChangedError extends Error {
  constructor() { super('로그인 계정이 변경되었거나 기록을 준비 중입니다. 다시 확인한 뒤 저장해 주세요.'); this.name = 'StorageSessionChangedError'; }
}
export interface StorageOwnerToken { userId: string | null; epoch: string | null }
export interface StorageSnapshot extends StorageReader { generation: string | null; pending: boolean }
export interface StorageWriteOptions { owner?: StorageOwnerToken }
type Changes = Record<string, string | null>;
type Protocol = { version: 2; state: 'committed'; generation: string }
  | { version: 2; state: 'prepared'; generation: string; transactionId: string; before: Changes };
type Session = { version: 2; id: string; userId: string | null };
type Ready = { epoch: string; userId: string | null };
const locallyFenced = new WeakSet<object>();
const failedInvalidations = new WeakSet<object>();
const insideTransform = new WeakSet<object>();

const isMap = (value: unknown): value is Changes => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.values(value).every(item => item === null || typeof item === 'string');
function parseProtocol(raw: string | null): Protocol | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Protocol;
    if (value?.version !== 2 || typeof value.generation !== 'string' || !value.generation
      || (value.state !== 'committed' && value.state !== 'prepared')
      || (value.state === 'prepared' && (typeof value.transactionId !== 'string' || !value.transactionId || !isMap(value.before)))) throw new StorageCorruptionError();
    if (value.state === 'prepared') validateChanges(value.before);
    return value;
  } catch { throw new StorageCorruptionError(); }
}
function parseLegacy(raw: string): Changes {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isMap(value)) throw new StorageCorruptionError();
    // Legacy readers project only records, never session invalidation metadata.
    if (Object.keys(value).some(key => key === STORAGE_SESSION_KEY || key === STORAGE_PROTOCOL_KEY || key === STORAGE_JOURNAL_KEY || key === STORAGE_GENERATION_KEY)) throw new StorageCorruptionError();
    return value;
  } catch { throw new StorageCorruptionError(); }
}
function parseSession(raw: string | null): Session | null {
  if (raw === null || !raw.startsWith('{')) return null; // Legacy numeric epoch is read-only until preparation.
  try {
    const value = JSON.parse(raw) as Session;
    if (value?.version !== 2 || typeof value.id !== 'string' || !value.id
      || (value.userId !== null && typeof value.userId !== 'string')) throw new StorageCorruptionError();
    return value;
  } catch { throw new StorageCorruptionError(); }
}
function validateChanges(changes: Changes) {
  if (!isMap(changes) || Object.keys(changes).some(key => [STORAGE_JOURNAL_KEY, STORAGE_GENERATION_KEY, STORAGE_PROTOCOL_KEY, STORAGE_SESSION_KEY].includes(key))) throw new StorageCorruptionError();
}
export const hasStorageTransaction = (storage: Pick<Storage, 'getItem'>) => storage.getItem(STORAGE_JOURNAL_KEY) !== null
  || parseProtocol(storage.getItem(STORAGE_PROTOCOL_KEY))?.state === 'prepared';
export const readStorageGeneration = (storage: Pick<Storage, 'getItem'>) => parseProtocol(storage.getItem(STORAGE_PROTOCOL_KEY))?.generation ?? storage.getItem(STORAGE_GENERATION_KEY);

/** Pure readers never recover. Both journal formats expose their whole before-image. */
export function readStorageSnapshot(storage: StorageReader): StorageSnapshot {
  for (let attempt = 0; attempt < 3; attempt++) {
    const generation = storage.getItem(STORAGE_GENERATION_KEY);
    const protocolRaw = storage.getItem(STORAGE_PROTOCOL_KEY);
    const journal = storage.getItem(STORAGE_JOURNAL_KEY);
    const protocol = parseProtocol(protocolRaw);
    if (journal !== null && protocol?.state === 'prepared') throw new StorageCorruptionError();
    const before = journal !== null ? parseLegacy(journal) : protocol?.state === 'prepared' ? protocol.before : {};
    const values: Record<string, string> = Object.create(null);
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key === null || [STORAGE_JOURNAL_KEY, STORAGE_GENERATION_KEY, STORAGE_PROTOCOL_KEY].includes(key)) continue;
      const value = storage.getItem(key);
      if (value !== null) values[key] = value;
    }
    for (const [key, value] of Object.entries(before)) {
      if (value === null) delete values[key];
      else values[key] = value;
    }
    const afterJournal = storage.getItem(STORAGE_JOURNAL_KEY);
    const afterProtocol = storage.getItem(STORAGE_PROTOCOL_KEY);
    const afterGeneration = storage.getItem(STORAGE_GENERATION_KEY);
    if (journal !== afterJournal || protocolRaw !== afterProtocol || generation !== afterGeneration) continue;
    const keys = Object.keys(values);
    return { generation: protocol?.generation ?? generation, pending: journal !== null || protocol?.state === 'prepared', length: keys.length,
      key: (index: number) => keys[index] ?? null,
      getItem: (key: string): string | null => Object.hasOwn(values, key) ? values[key] : null };
  }
  throw new StorageSnapshotBusyError();
}

export function requireStorageLocks(): LockManager {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') throw new StorageLocksUnavailableError();
  return locks;
}
export function readDesiredStorageOwner(storage: Pick<Storage, 'getItem'>): StorageOwnerToken | null {
  if (failedInvalidations.has(storage)) return null;
  const epoch = storage.getItem(STORAGE_SESSION_KEY);
  const session = parseSession(epoch);
  return session ? { userId: session.userId, epoch } : null;
}
export function captureStorageOwner(storage: Pick<Storage, 'getItem'> = window.localStorage): StorageOwnerToken {
  const epoch = storage.getItem(STORAGE_SESSION_KEY);
  const session = parseSession(epoch);
  const owner = { userId: session ? session.userId : storage.getItem(STORAGE_OWNER_KEY), epoch };
  assertCurrentStorageOwner(storage, owner);
  return owner;
}
function assertOwner(storage: Pick<Storage, 'getItem'>, owner: StorageOwnerToken, preparing = false) {
  const epoch = storage.getItem(STORAGE_SESSION_KEY);
  if (epoch !== owner.epoch) throw new StorageSessionChangedError();
  const session = parseSession(epoch);
  if (preparing) {
    if (failedInvalidations.has(storage) || !session || session.userId !== owner.userId) throw new StorageSessionChangedError();
  } else if (!session || locallyFenced.has(storage) || storage.getItem(STORAGE_OWNER_KEY) !== owner.userId
    || (session && (storage.getItem(STORAGE_READY_KEY) !== JSON.stringify({ epoch: epoch!, userId: owner.userId } satisfies Ready) || session.userId !== owner.userId || session.userId === null))) throw new StorageSessionChangedError();
  if (storage.getItem(STORAGE_SESSION_KEY) !== epoch) throw new StorageSessionChangedError();
}
function assertCurrentStorageOwner(storage: Pick<Storage, 'getItem'>, owner: StorageOwnerToken) {
  if (locallyFenced.has(storage)) throw new StorageSessionChangedError();
  const epoch = storage.getItem(STORAGE_SESSION_KEY);
  const source = 'length' in storage && 'key' in storage ? readStorageSnapshot(storage as StorageReader) : storage;
  assertOwner(source, owner);
  if (epoch !== storage.getItem(STORAGE_SESSION_KEY) || epoch !== owner.epoch) throw new StorageSessionChangedError();
}
export function isStorageOwnerCurrent(storage: Pick<Storage, 'getItem'>, owner: StorageOwnerToken) {
  try { assertCurrentStorageOwner(storage, owner); return true; } catch { return false; }
}
function sessionChanged() {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(CLOUD_SESSION_CHANGED_EVENT));
}
/** Synchronous, irreversible fence. It is deliberately never included in a journal. */
export function invalidateStorageOwner(storage: TransactionStorage, userId: string | null): StorageOwnerToken {
  locallyFenced.add(storage);
  sessionChanged();
  try { requireStorageLocks(); } catch (error) { failedInvalidations.add(storage); throw error; }
  const epoch = JSON.stringify({ version: 2, id: crypto.randomUUID(), userId } satisfies Session);
  try { storage.setItem(STORAGE_SESSION_KEY, epoch); } catch (error) { failedInvalidations.add(storage); throw error; }
  failedInvalidations.delete(storage);
  sessionChanged();
  return { userId, epoch };
}
function markCommitted(storage: TransactionStorage) {
  const generation = crypto.randomUUID();
  storage.setItem(STORAGE_PROTOCOL_KEY, JSON.stringify({ version: 2, state: 'committed', generation } satisfies Protocol));
  return generation;
}
/** Only called while owning STORAGE_LOCK_NAME. An old v1 writer never owned it. */
function recoverLocked(storage: TransactionStorage) {
  if (storage.getItem(STORAGE_JOURNAL_KEY) !== null) throw new StorageLegacyMigrationRequiredError();
  const protocol = parseProtocol(storage.getItem(STORAGE_PROTOCOL_KEY));
  if (protocol?.state !== 'prepared') return;
  // Free replacement bytes first. On any failure the durable before-image stays.
  for (const key of Object.keys(protocol.before)) storage.removeItem(key);
  for (const [key, value] of Object.entries(protocol.before)) if (value !== null) storage.setItem(key, value);
  markCommitted(storage);
  notifyRecordsChanged();
}
type StorageAttempt = { outcome: 'not-committed' | 'unknown' | 'committed' };
export class StorageWriteAttemptError extends Error {
  readonly outcome: 'not-committed' | 'unknown';
  readonly originalError: unknown;
  constructor(error: unknown, outcome: 'not-committed' | 'unknown') { super(error instanceof Error ? error.message : String(error)); this.name = 'StorageWriteAttemptError'; this.originalError = error; this.outcome = outcome; }
}
function commitLocked(storage: TransactionStorage, changes: Changes, owner: StorageOwnerToken, preparing: boolean, attempt?: StorageAttempt) {
  validateChanges(changes);
  if (!preparing && (Object.hasOwn(changes, STORAGE_OWNER_KEY) || Object.hasOwn(changes, STORAGE_READY_KEY))) throw new StorageCorruptionError();
  assertOwner(storage, owner, preparing);
  const effective = Object.fromEntries(Object.entries(changes).filter(([key, value]) => storage.getItem(key) !== value));
  if (!Object.keys(effective).length) return { changed: false, generation: readStorageGeneration(storage) };
  let committedGeneration: string | null = null;
  const before = Object.fromEntries(Object.keys(effective).map(key => [key, storage.getItem(key)]));
  const protocol: Protocol = { version: 2, state: 'prepared', generation: readStorageGeneration(storage) ?? crypto.randomUUID(), transactionId: crypto.randomUUID(), before };
  storage.setItem(STORAGE_PROTOCOL_KEY, JSON.stringify(protocol));
  if (attempt) attempt.outcome = 'unknown';
  try {
    for (const [key, value] of Object.entries(effective)) {
      if (value === null) storage.removeItem(key); else storage.setItem(key, value);
    }
    assertOwner(storage, owner, preparing);
    committedGeneration = markCommitted(storage);
    if (attempt) attempt.outcome = 'committed';
  } catch (error) {
    // Never restore the synchronous owner fence. A failed rollback retains v2.
    try {
      recoverLocked(storage);
      // A host could write the committed marker and then throw. Recovery sees
      // committed state in that case and does not roll it back. Only an exact
      // restored before-image proves this attempt never remained committed.
      if (attempt) {
        const restored = readStorageSnapshot(storage);
        if (!restored.pending && Object.entries(before).every(([key, value]) => restored.getItem(key) === value)) attempt.outcome = 'not-committed';
      }
    } catch (recoveryError) { throw new AggregateError([error, recoveryError], '기록 저장과 복구를 마치지 못했습니다. 복구 정보를 보존했습니다.'); }
    throw error;
  }
  return { changed: Object.keys(effective).some(key => !key.startsWith('fitness-cloud-sync-')), generation: committedGeneration };
}
/** Immutable application-record after-image and durable marker generation. Like
 * readStorageSnapshot, reserved journal/protocol/generation keys are omitted.
 * This is not a fresh raw-control/owner snapshot or renewed read authority. */
export interface StorageCommitReceipt { readonly snapshot: StorageSnapshot; readonly ownerCurrent: boolean; readonly notificationError?: unknown }
function updateWithOwnerReceipt(storage: TransactionStorage, transform: (snapshot: StorageSnapshot) => Changes, owner: StorageOwnerToken, preparing: boolean, attempt?: StorageAttempt): Promise<StorageCommitReceipt> {
  if (insideTransform.has(storage)) throw new Error('A storage transform cannot acquire a nested storage lock.');
  const locks = requireStorageLocks();
  return locks.request(STORAGE_LOCK_NAME, { mode: 'exclusive' }, () => {
    assertOwner(storage, owner, preparing);
    recoverLocked(storage);
    assertOwner(storage, owner, preparing);
    const snapshot = readStorageSnapshot(storage);
    let changes: Changes;
    insideTransform.add(storage);
    try {
      changes = transform(snapshot);
      if (changes && typeof (changes as unknown as { then?: unknown }).then === 'function') throw new Error('Storage transforms must be synchronous; never hold the lock over network work.');
    } finally { insideTransform.delete(storage); }
    const committed = commitLocked(storage, changes, owner, preparing, attempt);
    if (attempt) attempt.outcome = 'committed';
    // The exact after-image derives from the checked before-image and successful
    // writes. Never add a fallible storage reread after the durable marker.
    const values = new Map<string, string>();
    for (let index = 0; index < snapshot.length; index++) { const key = snapshot.key(index); if (key !== null) { const value = snapshot.getItem(key); if (value !== null) values.set(key, value); } }
    for (const [key, value] of Object.entries(changes)) { if (value === null) values.delete(key); else values.set(key, value); }
    const keys = [...values.keys()];
    const snapshotAfterCommit: StorageSnapshot = Object.freeze({ generation: committed.generation, pending: false, length: keys.length, key: (index: number) => keys[index] ?? null, getItem: (key: string) => values.get(key) ?? null });
    let ownerCurrent = true;
    try { assertOwner(storage, owner, preparing); } catch { ownerCurrent = false; }
    let notificationError: unknown;
    if (committed.changed) { try { notifyRecordsChanged(); } catch (error) { notificationError = error; } }
    return Object.freeze({ snapshot: snapshotAfterCommit, ownerCurrent, notificationError });
  });
}
function updateWithOwner(storage: TransactionStorage, transform: (snapshot: StorageSnapshot) => Changes, owner: StorageOwnerToken, preparing: boolean): Promise<void> {
  return updateWithOwnerReceipt(storage, transform, owner, preparing).then(receipt => {
    if (receipt.notificationError) throw receipt.notificationError;
    // Existing API deliberately suppresses UI success after owner revocation.
    assertOwner(storage, owner, preparing);
  });
}
/** Explicit durable receipt API. A false ownerCurrent is not a rollback. */
export async function updateStorageBatchWithReceipt(storage: TransactionStorage, transform: (snapshot: StorageSnapshot) => Changes, options: StorageWriteOptions = {}): Promise<StorageCommitReceipt> {
  const attempt: StorageAttempt = { outcome: 'not-committed' };
  try {
    const owner = options.owner ?? captureStorageOwner(storage);
    const receipt = await updateWithOwnerReceipt(storage, transform, owner, false, attempt);
    return { snapshot: receipt.snapshot, ownerCurrent: receipt.ownerCurrent && isStorageOwnerCurrent(storage, owner), notificationError: receipt.notificationError };
  } catch (error) { throw new StorageWriteAttemptError(error, attempt.outcome === 'not-committed' ? 'not-committed' : 'unknown'); }
}
/** Capture before queueing; compute replacements only from the fresh locked snapshot. */
export function updateStorageBatch(storage: TransactionStorage, transform: (snapshot: StorageSnapshot) => Changes, options: StorageWriteOptions = {}): Promise<void> {
  return updateWithOwner(storage, transform, options.owner ?? captureStorageOwner(storage), false);
}
export function writeStorageBatch(storage: TransactionStorage, changes: Changes, options: StorageWriteOptions = {}): Promise<void> {
  return updateStorageBatch(storage, () => changes, options);
}
export function recoverStorageTransaction(storage: TransactionStorage): Promise<void> {
  return updateStorageBatch(storage, () => ({}));
}
/** Auth-only preparation, using the same private lock primitive rather than nesting public writers. */
export async function completeStorageOwnerTransition(storage: TransactionStorage, owner: StorageOwnerToken, transform: (snapshot: StorageSnapshot) => Changes): Promise<void> {
  await updateWithOwner(storage, snapshot => ({ ...transform(snapshot),
    [STORAGE_READY_KEY]: JSON.stringify({ epoch: owner.epoch!, userId: owner.userId } satisfies Ready),
  }), owner, true);
  // Completion never rewrites the epoch: it cannot race and resurrect an older fence.
  assertOwner(storage, owner, true);
  locallyFenced.delete(storage);
  sessionChanged();
}

export const RECORDS_CHANGED_EVENT = 'yeoni-records-changed';
export const CLOUD_RECORDS_REFRESH_EVENT = 'yeoni-cloud-records-refresh';
export function requestCloudRecordsRefresh(ownerId: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CLOUD_RECORDS_REFRESH_EVENT, { detail: { ownerId } }));
}
let notificationQueued = false;
export function notifyRecordsChanged() {
  if (typeof window === 'undefined' || notificationQueued) return;
  notificationQueued = true;
  try {
    queueMicrotask(() => {
      notificationQueued = false;
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(RECORDS_CHANGED_EVENT));
    });
  } catch (error) { notificationQueued = false; throw error; }
}
