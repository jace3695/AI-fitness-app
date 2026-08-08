import { supabase } from "../lib/supabase";

const SYNCED_STORAGE_PREFIX = "ai-fitness-";
const SYNC_BASE_PREFIX = "fitness-cloud-sync-base:";

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
  const keys = Array.from(
    { length: window.localStorage.length },
    (_, index) => window.localStorage.key(index),
  ).filter((key): key is string => Boolean(key) && key!.startsWith(SYNCED_STORAGE_PREFIX));
  keys.forEach((key) => window.localStorage.removeItem(key));
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
  return merged;
}

export function mergeCloudStateFromBase(
  base: CloudState,
  remote: CloudState,
  local: CloudState,
) {
  return mergeValue(base, remote, local) as CloudState;
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
  Object.entries(state).forEach(([key, value]) => {
    window.localStorage.setItem(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  });
}

export function stableState(state: CloudState) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(state)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [
          key,
          isPlainObject(value)
            ? Object.fromEntries(
                Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
              )
            : value,
        ]),
    ),
  );
}

export async function getRemoteState(userId: string) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("user_app_state")
    .select("state, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as { state: CloudState; updated_at: string } | null;
}

export async function saveRemoteState(userId: string, state: CloudState) {
  if (!supabase) return;
  const { error } = await supabase.from("user_app_state").upsert({
    user_id: userId,
    state,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function saveRemoteStateIfUnchanged(
  userId: string,
  state: CloudState,
  expectedUpdatedAt: string,
) {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("user_app_state")
    .update({ state, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("updated_at", expectedUpdatedAt)
    .select("updated_at")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
