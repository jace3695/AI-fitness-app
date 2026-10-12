"use client";
import { useEffect } from "react";
import { RECORD_RESET_EVENT, RECORD_RESET_STORAGE_EVENT } from "../data/appRecordReset";
import { supabase } from "../lib/supabase";
import { LANGUAGE_BINDING_KEY, LANGUAGE_MARKER_KEY, LANGUAGE_OWNER_KEY, LANGUAGE_RESET_FENCE_KEY } from "../data/languageStorageBoundary.ts";
import { captureStorageOwner, isStorageOwnerCurrent, STORAGE_OWNER_KEY, STORAGE_READY_KEY, STORAGE_SESSION_KEY } from "../data/storageTransaction.ts";

export default function RecordResetListener() {
  useEffect(() => {
    let active = true;
    let revision = 0;
    const onReset = (event: StorageEvent) => {
      if (event.key === null || [RECORD_RESET_STORAGE_EVENT, LANGUAGE_BINDING_KEY, LANGUAGE_MARKER_KEY, LANGUAGE_OWNER_KEY,
        LANGUAGE_RESET_FENCE_KEY, STORAGE_OWNER_KEY, STORAGE_SESSION_KEY, STORAGE_READY_KEY].includes(event.key)) {
        revision += 1;
        // Cancellation is synchronous. The auth lookup below only decides
        // whether a later reload is appropriate; it is not the reset fence.
        window.dispatchEvent(new Event(RECORD_RESET_EVENT));
      }
      if (event.key !== RECORD_RESET_STORAGE_EVENT || !event.newValue) return;
      let userId: unknown;
      try { userId = JSON.parse(event.newValue).userId; } catch { return; }
      const expectedRevision = revision;
      let owner;
      try { owner = captureStorageOwner(); } catch { return; }
      if (owner.userId !== userId) return;
      void supabase?.auth.getUser().then(({ data, error }) => {
        if (active && !error && revision === expectedRevision && data.user?.id === userId && isStorageOwnerCurrent(window.localStorage, owner)) window.location.reload();
      }).catch(() => { /* Failed authentication never publishes a reset/reload. */ });
    };
    window.addEventListener("storage", onReset);
    return () => { active = false; revision += 1; window.removeEventListener("storage", onReset); };
  }, []);
  return null;
}
