import { supabase } from "../lib/supabase";

const SYNCED_STORAGE_PREFIX = "ai-fitness-";

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
