"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabase";
import { mergeCloudState, mergeCloudStateFromBase, stableState } from "@/app/data/cloudSync";
import { applyLanguageState, prepareLanguageLocalState, readLanguageState, readLanguageSyncBase, saveLanguageSyncBase } from "@/app/data/languageCloudSync";

export default function LanguageCloudSync() {
  const [status, setStatus] = useState<"loading" | "synced" | "error">("loading");

  useEffect(() => {
    if (!supabase) return;
    const authClient = supabase;
    let active = true;
    let syncing = false;
    let lastSnapshot = "";
    let interval: ReturnType<typeof setInterval> | undefined;
    let syncVisibleChanges: (() => void) | undefined;

    const initialize = async () => {
      const { data: auth } = await authClient.auth.getUser();
      if (!auth.user || !active) return;
      prepareLanguageLocalState(auth.user.id);

      const sync = async (initial = false) => {
        if (syncing || !active || document.visibilityState !== "visible") return;
        syncing = true;
        setStatus("loading");
        try {
          const local = readLanguageState();
          const { data, error } = await authClient.from("language_user_state")
            .select("state, updated_at").eq("user_id", auth.user.id).maybeSingle();
          if (error) throw error;

          const remote = data?.state && typeof data.state === "object" ? data.state : {};
          const localHash = stableState(local);
          const remoteHash = stableState(remote);

          if (!data) {
            const { error: saveError } = await authClient.from("language_user_state").insert({
              user_id: auth.user.id, state: local, updated_at: new Date().toISOString(),
            });
            if (saveError) throw saveError;
            lastSnapshot = localHash;
            saveLanguageSyncBase(auth.user.id, local);
          } else if (!lastSnapshot || initial) {
            const base = readLanguageSyncBase(auth.user.id);
            const merged = base ? mergeCloudStateFromBase(base, remote, local) : mergeCloudState(remote, local);
            const mergedHash = stableState(merged);
            if (mergedHash !== remoteHash) {
              const { data: saved, error: saveError } = await authClient.from("language_user_state")
                .update({ state: merged, updated_at: new Date().toISOString() })
                .eq("user_id", auth.user.id).eq("updated_at", data.updated_at)
                .select("updated_at").maybeSingle();
              if (saveError) throw saveError;
              if (!saved) throw new Error("다른 기기의 변경을 확인했습니다. 다시 동기화해 주세요.");
            }
            applyLanguageState(merged);
            lastSnapshot = mergedHash;
            saveLanguageSyncBase(auth.user.id, merged);
          } else {
            const localChanged = localHash !== lastSnapshot;
            const remoteChanged = remoteHash !== lastSnapshot;
            if (localChanged || remoteChanged) {
              const base = readLanguageSyncBase(auth.user.id) ?? {};
              const merged = localChanged && remoteChanged
                ? mergeCloudStateFromBase(base, remote, local)
                : localChanged ? local : remote;
              const mergedHash = stableState(merged);
              if (localChanged) {
                const { data: saved, error: saveError } = await authClient.from("language_user_state")
                  .update({ state: merged, updated_at: new Date().toISOString() })
                  .eq("user_id", auth.user.id).eq("updated_at", data.updated_at)
                  .select("updated_at").maybeSingle();
                if (saveError) throw saveError;
                if (!saved) throw new Error("다른 기기의 변경을 확인했습니다. 다시 동기화해 주세요.");
              }
              if (remoteChanged) applyLanguageState(merged);
              lastSnapshot = mergedHash;
              saveLanguageSyncBase(auth.user.id, merged);
            }
          }
          if (active) setStatus("synced");
        } catch {
          if (active) setStatus("error");
        } finally {
          syncing = false;
        }
      };

      await sync(true);
      syncVisibleChanges = () => void sync();
      interval = setInterval(syncVisibleChanges, 30_000);
      document.addEventListener("visibilitychange", syncVisibleChanges);
      window.addEventListener("focus", syncVisibleChanges);
      window.addEventListener("online", syncVisibleChanges);
    };

    void initialize();
    return () => {
      active = false;
      if (interval) clearInterval(interval);
      if (syncVisibleChanges) {
        document.removeEventListener("visibilitychange", syncVisibleChanges);
        window.removeEventListener("focus", syncVisibleChanges);
        window.removeEventListener("online", syncVisibleChanges);
      }
    };
  }, []);

  return <div role="status" className="fixed bottom-3 right-3 z-[100] rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-bold text-gray-500 shadow-md ring-1 ring-black/5 backdrop-blur">
    {status === "loading" ? "학습 기록 연결 중…" : status === "synced" ? "학습 기록 동기화됨" : "학습 기록 동기화 확인 필요"}
  </div>;
}
