"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_YEONI_PREFERENCES, parseYeoniPreferences, YEONI_PREFERENCES_KEY, type YeoniPreferences } from "@/utils/yeoniPreferences";

let snapshot = DEFAULT_YEONI_PREFERENCES;
const listeners = new Set<() => void>();

function notify(next: YeoniPreferences) {
  if (snapshot.visible === next.visible && snapshot.motion === next.motion) return;
  snapshot = next;
  listeners.forEach(listener => listener());
}

function refresh() {
  try { notify(parseYeoniPreferences(localStorage.getItem(YEONI_PREFERENCES_KEY), localStorage.getItem("integratedLearningSettingsV1"))); }
  catch { /* Keep the in-memory preference if storage is unavailable. */ }
}

function onStorage(event: StorageEvent) {
  if (event.key === YEONI_PREFERENCES_KEY || event.key === null) refresh();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage);
    // Read once on mount/resubscribe; never poll or read storage on each render.
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
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
