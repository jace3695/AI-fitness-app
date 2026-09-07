"use client";

import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/app/lib/supabase";
import { mergeCloudState, mergeCloudStateFromBase, stableState } from "@/app/data/cloudSync";
import { applyLanguageState, prepareLanguageLocalState, readLanguageState, readLanguageSyncBase, saveLanguageSyncBase } from "@/app/data/languageCloudSync";
import { isRecordResetRunning, RECORD_RESET_EVENT } from "@/app/data/appRecordReset";

export default function LanguageCloudSync({ children }: { children?: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "synced" | "error">("loading");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!supabase) { setStatus("error"); return; }
    const authClient = supabase;
    let active = true;
    let resetVersion = 0;
    const onReset = () => { resetVersion += 1; };
    window.addEventListener(RECORD_RESET_EVENT, onReset);
    let syncing = false;
    let lastSnapshot = "";
    let interval: ReturnType<typeof setInterval> | undefined;
    let syncVisibleChanges: (() => void) | undefined;

    const initialize = async () => {
      const { data: auth } = await authClient.auth.getUser();
      if (!active) return;
      if (!auth.user) { setStatus("error"); return; }
      prepareLanguageLocalState(auth.user.id);

      const sync = async (initial = false) => {
        if (syncing || !active || isRecordResetRunning() || (!initial && document.visibilityState !== "visible")) return;
        const version = resetVersion;
        const cancelled = () => !active || version !== resetVersion || isRecordResetRunning();
        syncing = true;
        setStatus("loading");
        try {
          const { data, error } = await authClient.from("language_user_state")
            .select("state, updated_at").eq("user_id", auth.user.id).maybeSingle();
          if (cancelled()) return;
          if (error) throw error;
          // Include answers entered while the network read was pending.
          const local = readLanguageState();

          const remote = data?.state && typeof data.state === "object" ? data.state : {};
          const localHash = stableState(local);
          const remoteHash = stableState(remote);

          if (!data) {
            const { error: saveError } = await authClient.from("language_user_state").insert({
              user_id: auth.user.id, state: local, updated_at: new Date().toISOString(),
            });
            if (saveError) throw saveError;
            if (cancelled()) return;
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
            if (cancelled()) return;
            applyLanguageState(mergeCloudStateFromBase(local, merged, readLanguageState()));
            lastSnapshot = mergedHash;
            saveLanguageSyncBase(auth.user.id, merged);
            if (local.languageRecordResetV1 !== merged.languageRecordResetV1) window.location.reload();
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
              if (cancelled()) return;
              if (remoteChanged) applyLanguageState(mergeCloudStateFromBase(local, merged, readLanguageState()));
              lastSnapshot = mergedHash;
              saveLanguageSyncBase(auth.user.id, merged);
              if (local.languageRecordResetV1 !== merged.languageRecordResetV1) window.location.reload();
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
      if (!active) return;
      setInitialized(true);
      syncVisibleChanges = () => void sync();
      interval = setInterval(syncVisibleChanges, 30_000);
      document.addEventListener("visibilitychange", syncVisibleChanges);
      window.addEventListener("focus", syncVisibleChanges);
      window.addEventListener("online", syncVisibleChanges);
    };

    void initialize().catch(() => { if (active) setStatus("error"); });
    const slowTimer = setTimeout(() => { if (active) setStatus((current) => current === "loading" ? "error" : current); }, 15_000);
    return () => {
      active = false;
      window.removeEventListener(RECORD_RESET_EVENT, onReset);
      clearTimeout(slowTimer);
      if (interval) clearInterval(interval);
      if (syncVisibleChanges) {
        document.removeEventListener("visibilitychange", syncVisibleChanges);
        window.removeEventListener("focus", syncVisibleChanges);
        window.removeEventListener("online", syncVisibleChanges);
      }
    };
  }, []);

  return <>
    {initialized ? children : <section style={{ padding: 24 }} aria-live="polite"><p>{status === "error" ? "학습 기록 연결을 확인하지 못했어요. 잠시 후 다시 열어 주세요." : "이 계정의 학습 기록을 준비하고 있어요."}</p>{status === "error" && <button type="button" className="btn" onClick={() => window.location.reload()}>다시 연결하기</button>}</section>}
    <div role="status" className="fixed bottom-3 right-3 z-[100] rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-bold text-gray-500 shadow-md ring-1 ring-black/5 backdrop-blur">
    {status === "loading" ? "학습 기록 연결 중…" : status === "synced" ? "최근 학습 기록 동기화됨" : "학습 기록 동기화 확인 필요"}
    </div>
  </>;
}
