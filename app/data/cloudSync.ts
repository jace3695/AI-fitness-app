import { supabase } from "../lib/supabase.ts";
import { respectRecordResets } from "./appRecordReset.ts";
import { captureStorageOwner, completeStorageOwnerTransition, hasStorageTransaction, invalidateStorageOwner, isStorageOwnerCurrent,
  readDesiredStorageOwner, readStorageSnapshot, StorageCorruptionError, StorageSessionChangedError, StorageSnapshotBusyError,
  updateStorageBatch, STORAGE_OWNER_KEY, STORAGE_SESSION_KEY, STORAGE_READY_KEY,
} from "./storageTransaction.ts";
import type { StorageOwnerToken, StorageReader } from "./storageTransaction.ts";
export { CLOUD_SESSION_CHANGED_EVENT } from "./storageTransaction.ts";

const SYNCED_STORAGE_PREFIX = "ai-fitness-";
const SYNC_BASE_PREFIX = "fitness-cloud-sync-base:";
const SYNC_USER_KEY = STORAGE_OWNER_KEY;
const SYNC_ACK_PREFIX = "fitness-cloud-sync-ack:";
const SYNC_EPOCH_KEY = STORAGE_SESSION_KEY;

export type CloudState = Record<string, unknown>;

function parseStoredValue(raw: string | null) {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const MISSING = Symbol("missing");

function sameValue(left: unknown, right: unknown) {
  return stableState({ value: left }) === stableState({ value: right });
}

function mergeValue(base: unknown, remote: unknown, local: unknown): unknown {
  if (sameValue(local, remote)) return local;
  if (sameValue(local, base)) return remote;
  if (sameValue(remote, base)) return local;

  if (isPlainObject(base) || isPlainObject(remote) || isPlainObject(local)) {
    const baseObject = isPlainObject(base) ? base : {};
    const remoteObject = isPlainObject(remote) ? remote : {};
    const localObject = isPlainObject(local) ? local : {};
    const result: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(baseObject),
      ...Object.keys(remoteObject),
      ...Object.keys(localObject),
    ]);
    keys.forEach((key) => {
      const merged = mergeValue(
        key in baseObject ? baseObject[key] : MISSING,
        key in remoteObject ? remoteObject[key] : MISSING,
        key in localObject ? localObject[key] : MISSING,
      );
      if (merged !== MISSING) result[key] = merged;
    });
    return result;
  }

  if (Array.isArray(remote) && Array.isArray(local)) {
    const result = [...remote];
    local.forEach((item) => {
      if (!result.some((existing) => sameValue(existing, item))) result.push(item);
    });
    return result;
  }

  // A deletion only wins when the other device did not modify the same value.
  if (local === MISSING) return remote;
  if (remote === MISSING) return local;
  return local;
}

export function readLocalCloudState(source?: StorageReader): CloudState {
  if (!source && typeof window === "undefined") return {};
  const storage = source ?? readStorageSnapshot(window.localStorage);
  const keys = Array.from(
    { length: storage.length },
    (_, index) => storage.key(index),
  ).filter(
    (key): key is string =>
      Boolean(key) && key!.startsWith(SYNCED_STORAGE_PREFIX),
  );
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = parseStoredValue(storage.getItem(key));
      return value === undefined ? [] : [[key, value]];
    }),
  );
}

type Preparation = { userId: string | null; epoch: string | null; promise: Promise<void> };
const preparations = new WeakMap<object, Preparation>();

function prepareOwner(userId: string | null): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const storage = window.localStorage;
  const existing = preparations.get(storage);
  const currentEpoch = storage.getItem(SYNC_EPOCH_KEY);
  if (existing?.userId === userId && existing.epoch === currentEpoch) return existing.promise;
  if (userId && isStorageOwnerCurrent(storage, { userId, epoch: currentEpoch }) && !hasStorageTransaction(storage)) return Promise.resolve();
  // Repeated signed-out callbacks are idempotent; pending cleanup is shared above.
  if (userId === null && currentEpoch !== null) {
    try {
      const snapshot = readStorageSnapshot(storage);
      if (!snapshot.pending && snapshot.getItem(SYNC_USER_KEY) === null
        && snapshot.getItem(STORAGE_READY_KEY) === JSON.stringify({ epoch: currentEpoch, userId: null })
        && storage.getItem(SYNC_EPOCH_KEY) === currentEpoch) return Promise.resolve();
    } catch { /* Fence the session before the guarded cleanup reports corruption. */ }
  }
  let owner: StorageOwnerToken;
  try {
    const desired = readDesiredStorageOwner(storage);
    // Authenticated same-owner tabs join one immutable desired generation.
    owner = desired?.userId === userId ? desired : invalidateStorageOwner(storage, userId);
  } catch (error) { return Promise.reject(error); }
  const promise = completeStorageOwnerTransition(storage, owner, snapshot => {
    const previousUser = snapshot.getItem(SYNC_USER_KEY);
    const changes: Record<string, string | null> = {};
    if (userId === null || (previousUser !== null && previousUser !== userId)) {
      for (let index = 0; index < snapshot.length; index++) {
        const key = snapshot.key(index)!;
        if (key.startsWith(SYNCED_STORAGE_PREFIX) || key.startsWith(SYNC_BASE_PREFIX) || key.startsWith(SYNC_ACK_PREFIX)) changes[key] = null;
      }
    } else if (!previousUser && Object.keys(readLocalCloudState(snapshot)).length === 0) {
      // Empty unowned legacy caches cannot prove a remote deletion.
      changes[`${SYNC_BASE_PREFIX}${userId}`] = null;
      changes[`${SYNC_ACK_PREFIX}${userId}`] = null;
    }
    changes[SYNC_USER_KEY] = userId;
    return changes;
  }).catch(error => {
    // Two initial documents can race before either publishes its first fence.
    // Join the winning generation only if it still targets this authenticated owner.
    const desired = readDesiredStorageOwner(storage);
    if (error instanceof StorageSessionChangedError && desired?.userId === userId && desired.epoch !== owner.epoch) return prepareOwner(userId);
    throw error;
  });
  const entry: Preparation = { userId, epoch: owner.epoch, promise };
  preparations.set(storage, entry);
  void promise.finally(() => { if (preparations.get(storage) === entry) preparations.delete(storage); }).catch(() => {});
  return promise;
}

/** Fences old work synchronously, then waits for the shared short storage lock. */
export function clearLocalCloudState(): Promise<void> { return prepareOwner(null); }
export function prepareLocalCloudState(userId: string): Promise<void> {
  if (!userId) return Promise.reject(new StorageSessionChangedError());
  return prepareOwner(userId);
}
export function readCloudSyncEpoch() {
  return typeof window === "undefined" ? null : window.localStorage.getItem(SYNC_EPOCH_KEY);
}
export function isCurrentCloudSession(userId: string, epoch: string | null) {
  return typeof window !== "undefined" && isStorageOwnerCurrent(window.localStorage, { userId, epoch });
}

export function mergeCloudState(remote: CloudState, local: CloudState) {
  const merged: CloudState = { ...remote };
  Object.entries(local).forEach(([key, localValue]) => {
    const remoteValue = remote[key];
    merged[key] =
      isPlainObject(remoteValue) && isPlainObject(localValue)
        ? { ...remoteValue, ...localValue }
        : localValue;
  });
  return respectRecordResets(remote, local, merged);
}

export function mergeCloudStateFromBase(
  base: CloudState,
  remote: CloudState,
  local: CloudState,
) {
  return respectRecordResets(remote, local, mergeValue(base, remote, local) as CloudState);
}

/** An explicit backup restore is a new user action in the current reset generation. */
export function mergeExplicitCloudBackup(current: CloudState, backup: CloudState) {
  const records = { ...backup };
  for (const key of new Set([...Object.keys(current), ...Object.keys(records)])) {
    if (!key.startsWith("ai-fitness-record-reset-")) continue;
    if (key in current) records[key] = current[key];
    else delete records[key];
  }
  return mergeCloudState(current, records);
}

function parseSyncBase(raw: string | null): CloudState | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isPlainObject(value)) throw new StorageCorruptionError();
    return value;
  } catch { throw new StorageCorruptionError(); }
}
export function readSyncBase(userId: string): CloudState | null {
  if (typeof window === "undefined") return null;
  return parseSyncBase(readStorageSnapshot(window.localStorage).getItem(`${SYNC_BASE_PREFIX}${userId}`));
}
export async function saveSyncBase(userId: string, state: CloudState): Promise<void> {
  if (typeof window === "undefined") return;
  const owner = captureStorageOwner();
  if (owner.userId !== userId) throw new StorageSessionChangedError();
  await updateStorageBatch(window.localStorage, () => ({
    [`${SYNC_BASE_PREFIX}${userId}`]: JSON.stringify(state),
    [`${SYNC_ACK_PREFIX}${userId}`]: crypto.randomUUID(),
  }), { owner });
}
function cloudChanges(snapshot: StorageReader, state: CloudState): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  for (const key of Object.keys(readLocalCloudState(snapshot))) if (!(key in state)) changes[key] = null;
  for (const [key, value] of Object.entries(state)) {
    if (!key.startsWith(SYNCED_STORAGE_PREFIX)) throw new StorageCorruptionError();
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (serialized === undefined) throw new StorageCorruptionError();
    changes[key] = serialized;
  }
  return changes;
}
export async function applyCloudState(state: CloudState, owner?: StorageOwnerToken): Promise<void> {
  if (typeof window === "undefined") return;
  await updateStorageBatch(window.localStorage, snapshot => cloudChanges(snapshot, state), { owner });
}
export async function restoreCloudBackup(backup: CloudState, owner?: StorageOwnerToken): Promise<CloudState> {
  if (typeof window === "undefined") throw new StorageSessionChangedError();
  let result: CloudState = {};
  await updateStorageBatch(window.localStorage, snapshot => {
    result = mergeExplicitCloudBackup(readLocalCloudState(snapshot), backup);
    return cloudChanges(snapshot, result);
  }, { owner });
  return result;
}
export interface CloudSyncRequest {
  userId: string;
  epoch: string | null;
  local: CloudState;
  base: CloudState | null;
  acknowledgementToken: string | null;
}
export class CloudSyncAcknowledgementStaleError extends Error {
  constructor() { super('다른 동기화가 먼저 완료되었습니다. 최신 기록으로 다시 동기화합니다.'); this.name = 'CloudSyncAcknowledgementStaleError'; }
}
export function readCloudSyncRequest(userId: string, epoch: string | null): CloudSyncRequest {
  const owner = captureStorageOwner();
  if (owner.userId !== userId || owner.epoch !== epoch) throw new StorageSessionChangedError();
  const snapshot = readStorageSnapshot(window.localStorage);
  if (snapshot.pending) throw new StorageSnapshotBusyError();
  if (snapshot.getItem(SYNC_EPOCH_KEY) !== epoch || snapshot.getItem(SYNC_USER_KEY) !== userId || !isCurrentCloudSession(userId, epoch)) throw new StorageSessionChangedError();
  return { userId, epoch, local: readLocalCloudState(snapshot), base: parseSyncBase(snapshot.getItem(`${SYNC_BASE_PREFIX}${userId}`)),
    acknowledgementToken: snapshot.getItem(`${SYNC_ACK_PREFIX}${userId}`) };
}
/** Acknowledge the request, preserving fresh local edits, in one owner-guarded commit. */
export async function commitCloudSyncResponse(request: CloudSyncRequest, acknowledgedState: CloudState): Promise<{ local: CloudState; pending: boolean }> {
  let result = { local: {} as CloudState, pending: false };
  await updateStorageBatch(window.localStorage, snapshot => {
    if (snapshot.getItem(`${SYNC_ACK_PREFIX}${request.userId}`) !== request.acknowledgementToken) throw new CloudSyncAcknowledgementStaleError();
    const latest = readLocalCloudState(snapshot);
    const local = reconcileSyncResponse(request.local, acknowledgedState, latest);
    result = { local, pending: stableState(local) !== stableState(acknowledgedState) };
    if (stableState(latest) === stableState(local)
      && stableState(parseSyncBase(snapshot.getItem(`${SYNC_BASE_PREFIX}${request.userId}`)) ?? {}) === stableState(acknowledgedState)
      && snapshot.getItem(`${SYNC_BASE_PREFIX}${request.userId}`) !== null) return {};
    return { ...cloudChanges(snapshot, local),
      [`${SYNC_BASE_PREFIX}${request.userId}`]: JSON.stringify(acknowledgedState),
      [`${SYNC_ACK_PREFIX}${request.userId}`]: crypto.randomUUID(),
    };
  }, { owner: { userId: request.userId, epoch: request.epoch } });
  return result;
}

/** A remote response acknowledges sentState, not edits made while it was pending. */
export function reconcileSyncResponse(localAtRequest: CloudState, sentState: CloudState, latestLocal: CloudState) {
  return mergeCloudStateFromBase(localAtRequest, sentState, latestLocal);
}

export function stableState(state: CloudState) {
  // JSONB can reorder object keys at every depth, including sets inside exercise
  // arrays. Compare JSON content rather than key order so unchanged records do
  // not look like competing edits and get appended a second time by mergeValue.
  // Only object keys are sorted: exercise/set order and repeated entries matter.
  return JSON.stringify(state, (_key, value: unknown) =>
    isPlainObject(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
}

export async function getRemoteState(userId: string, signal?: AbortSignal) {
  if (!supabase) return null;
  signal?.throwIfAborted();
  const query = supabase
    .from("user_app_state")
    .select("state, updated_at")
    .eq("user_id", userId);
  if (signal) query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  signal?.throwIfAborted();
  if (error) throw error;
  return data as { state: CloudState; updated_at: string } | null;
}

export async function saveRemoteState(userId: string, state: CloudState, signal?: AbortSignal) {
  if (!supabase) return;
  signal?.throwIfAborted();
  // A competing first sync or reset may have created the row after our read.
  // Insert must fail in that case; upsert would overwrite that newer state.
  const query = supabase.from("user_app_state").insert({
    user_id: userId,
    state,
    updated_at: new Date().toISOString(),
  });
  if (signal) query.abortSignal(signal);
  const { error } = await query;
  signal?.throwIfAborted();
  if (error) throw error;
  await verifyRemoteState(userId, state, signal);
}

/** A successful write response is not proof that another client kept the value. */
async function verifyRemoteState(userId: string, expected: CloudState, signal?: AbortSignal) {
  const confirmed = await getRemoteState(userId, signal);
  if (!confirmed || stableState(confirmed.state) !== stableState(expected)) {
    // Do not advance the sync base or apply this response. The caller retains
    // local edits and can merge them against the last confirmed base on retry.
    throw new Error("저장 후 서버 기록이 달라졌습니다. 기기 기록을 보존했으니 다시 동기화해 주세요.");
  }
}

export async function saveRemoteStateIfUnchanged(
  userId: string,
  state: CloudState,
  expectedUpdatedAt: string,
  signal?: AbortSignal,
) {
  if (!supabase) return false;
  signal?.throwIfAborted();
  const query = supabase
    .from("user_app_state")
    .update({ state, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("updated_at", expectedUpdatedAt)
    .select("updated_at");
  if (signal) query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  signal?.throwIfAborted();
  if (error) throw error;
  if (!data) return false;
  await verifyRemoteState(userId, state, signal);
  return true;
}
