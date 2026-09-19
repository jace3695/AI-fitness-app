import { supabase } from "../lib/supabase.ts";
import { respectRecordResets } from "./appRecordReset.ts";
import { notifyRecordsChanged, recoverStorageTransaction, writeStorageBatch } from "./storageTransaction.ts";

const SYNCED_STORAGE_PREFIX = "ai-fitness-";
const SYNC_BASE_PREFIX = "fitness-cloud-sync-base:";
const SYNC_USER_KEY = "fitness-cloud-sync-user";
const SYNC_EPOCH_KEY = "fitness-cloud-sync-epoch";
export const CLOUD_SESSION_CHANGED_EVENT = "yeoni-cloud-session-changed";

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

export function readLocalCloudState(): CloudState {
  if (typeof window === "undefined") return {};
  recoverStorageTransaction(window.localStorage);
  const keys = Array.from(
    { length: window.localStorage.length },
    (_, index) => window.localStorage.key(index),
  ).filter(
    (key): key is string =>
      Boolean(key) && key!.startsWith(SYNCED_STORAGE_PREFIX),
  );
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = parseStoredValue(window.localStorage.getItem(key));
      return value === undefined ? [] : [[key, value]];
    }),
  );
}

export function clearLocalCloudState() {
  if (typeof window === "undefined") return;
  const storage = window.localStorage;
  recoverStorageTransaction(storage);
  // Invalidate pending work before removing records. Logout is not a record
  // deletion, and a late response must not recreate the old user's sync base.
  storage.setItem(SYNC_EPOCH_KEY, String(Number(storage.getItem(SYNC_EPOCH_KEY) || 0) + 1));
  window.dispatchEvent(new Event(CLOUD_SESSION_CHANGED_EVENT));
  const keys = Array.from(
    { length: storage.length },
    (_, index) => storage.key(index),
  ).filter((key): key is string => Boolean(key) && (
    key!.startsWith(SYNCED_STORAGE_PREFIX) || key!.startsWith(SYNC_BASE_PREFIX) || key === SYNC_USER_KEY
  ));
  // Keep the records and their deletion baseline together, including recovery
  // of an interrupted storage transaction. Unrelated browser data is untouched.
  writeStorageBatch(storage, Object.fromEntries(keys.map(key => [key, null])));
}

export function prepareLocalCloudState(userId: string) {
  if (typeof window === "undefined") return;
  const storage = window.localStorage;
  const previousUser = storage.getItem(SYNC_USER_KEY);
  if (previousUser && previousUser !== userId) clearLocalCloudState();
  // Older versions left a baseline after logout without any ownership marker.
  // An empty legacy cache cannot prove that the user deleted the remote data.
  if (!previousUser && Object.keys(readLocalCloudState()).length === 0) {
    storage.removeItem(`${SYNC_BASE_PREFIX}${userId}`);
  }
  storage.setItem(SYNC_USER_KEY, userId);
}

export function readCloudSyncEpoch() {
  return typeof window === "undefined" ? null : window.localStorage.getItem(SYNC_EPOCH_KEY);
}

export function isCurrentCloudSession(userId: string, epoch: string | null) {
  return typeof window !== "undefined" && window.localStorage.getItem(SYNC_USER_KEY) === userId
    && readCloudSyncEpoch() === epoch;
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

export function readSyncBase(userId: string): CloudState | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(`${SYNC_BASE_PREFIX}${userId}`) || "null") as CloudState | null;
  } catch {
    window.localStorage.removeItem(`${SYNC_BASE_PREFIX}${userId}`);
    return null;
  }
}

export function saveSyncBase(userId: string, state: CloudState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${SYNC_BASE_PREFIX}${userId}`, JSON.stringify(state));
}

export function applyCloudState(state: CloudState) {
  if (typeof window === "undefined") return;
  const changes: Record<string, string | null> = {};
  for (const key of Object.keys(readLocalCloudState())) if (!(key in state)) changes[key] = null;
  for (const [key, value] of Object.entries(state)) changes[key] = typeof value === "string" ? value : JSON.stringify(value);
  writeStorageBatch(window.localStorage, changes);
  notifyRecordsChanged();
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
