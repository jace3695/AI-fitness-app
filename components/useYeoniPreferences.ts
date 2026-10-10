"use client";

import { useSyncExternalStore } from "react";
import { readGuardedLanguageProjection } from "../app/data/languageStorageBoundary.ts";
import { CLOUD_SESSION_CHANGED_EVENT, RECORDS_CHANGED_EVENT } from "../app/data/storageTransaction.ts";
import { RECORD_RESET_EVENT } from "../app/data/appRecordReset.ts";
import { DEFAULT_YEONI_PREFERENCES, parseYeoniPreferences, YEONI_PREFERENCES_KEY, type YeoniPreferences } from "../utils/yeoniPreferences.ts";

let snapshot = DEFAULT_YEONI_PREFERENCES;
const listeners = new Set<() => void>();

function notify(next: YeoniPreferences) {
  if (snapshot.visible === next.visible && snapshot.motion === next.motion) return;
  snapshot = next;
  listeners.forEach(listener => listener());
}

function refresh() {
  let deviceRaw: string | null = null;
  let legacyRaw: string | null = null;
  try {
    const storage = window.localStorage;
    deviceRaw = storage.getItem(YEONI_PREFERENCES_KEY);
    const projection = readGuardedLanguageProjection(storage);
    if (projection.status === 'ready') legacyRaw = projection.records.integratedLearningSettingsV1 ?? null;
  } catch { /* Even acquiring localStorage can fail; never retain a borrowed fallback. */ }
  notify(parseYeoniPreferences(deviceRaw, legacyRaw));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    for (const event of ['storage', 'focus', 'pageshow', CLOUD_SESSION_CHANGED_EVENT, RECORDS_CHANGED_EVENT, RECORD_RESET_EVENT]) window.addEventListener(event, refresh);
    // A guarded fallback can never survive invalidation in this module cache.
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      for (const event of ['storage', 'focus', 'pageshow', CLOUD_SESSION_CHANGED_EVENT, RECORDS_CHANGED_EVENT, RECORD_RESET_EVENT]) window.removeEventListener(event, refresh);
      // No listener remains to observe account changes. Do not let a borrowed
      // language fallback survive until another component's first render.
      snapshot = DEFAULT_YEONI_PREFERENCES;
    }
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => DEFAULT_YEONI_PREFERENCES;

export function useYeoniPreferences() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function updateYeoniPreferences(change: Partial<YeoniPreferences>) {
  const next = { ...snapshot, ...change };
  // Pause/hide still works in this tab when saving is denied or storage is full.
  notify(next);
  localStorage.setItem(YEONI_PREFERENCES_KEY, JSON.stringify(next));
}
