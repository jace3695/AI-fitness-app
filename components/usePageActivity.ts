"use client";

import { useSyncExternalStore } from "react";

let active = false;
const listeners = new Set<() => void>();

function update() {
  const element = document.activeElement;
  const editing = element instanceof HTMLElement && (element.matches("input, textarea, select") || element.isContentEditable);
  const next = !document.hidden && !editing;
  if (next === active) return;
  active = next;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    update();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      document.removeEventListener("visibilitychange", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    }
  };
}

const getSnapshot = () => active;
const getInactive = () => false;
const noSubscription = () => () => {};

export function usePageActivity(enabled: boolean) {
  return useSyncExternalStore(enabled ? subscribe : noSubscription, enabled ? getSnapshot : getInactive, getInactive);
}
