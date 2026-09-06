"use client";
import { useEffect } from "react";
import { RECORD_RESET_STORAGE_EVENT } from "../data/appRecordReset";
import { supabase } from "../lib/supabase";

export default function RecordResetListener() {
  useEffect(() => {
    const onReset = (event: StorageEvent) => {
      if (event.key !== RECORD_RESET_STORAGE_EVENT || !event.newValue) return;
      let userId: unknown;
      try { userId = JSON.parse(event.newValue).userId; } catch { return; }
      void supabase?.auth.getUser().then(({ data }) => { if (data.user?.id === userId) window.location.reload(); });
    };
    window.addEventListener("storage", onReset);
    return () => window.removeEventListener("storage", onReset);
  }, []);
  return null;
}
