"use client";

import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/app/lib/supabase";
import { mergeCloudState, mergeCloudStateFromBase, stableState } from "@/app/data/cloudSync";
import {
  applyLanguageState,
  prepareLanguageLocalState,
  readLanguageState,
  readLanguageSyncBase,
  saveLanguageSyncBase,
} from "@/app/data/languageCloudSync";
import { requestSafeReload } from "@/app/lib/unsavedChanges";
import { isRecordResetRunning, RECORD_RESET_EVENT } from "@/app/data/appRecordReset";

type SyncStatus = "pending" | "syncing" | "synced" | "error";
type RemoteRow = { state: Record<string, unknown>; updated_at: string };

export default function LanguageCloudSync({ children }: { children?: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>("syncing");
  const [initialized, setInitialized] = useState(false);
  const [message, setMessage] = useState("");
  const [syncRequest, setSyncRequest] = useState(0);

  useEffect(() => {
    if (!supabase) { setStatus("error"); setMessage("학습 기록 연결 설정을 확인해 주세요."); return; }
    const authClient = supabase;
    let active = true;
    let resetVersion = 0;
    let syncing = false;
    let lastSnapshot = "";
    let observedLocal = "";
    let followUpTimer: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    let localWatch: ReturnType<typeof setInterval> | undefined;
    let syncVisibleChanges: (() => void) | undefined;
    const onReset = () => { resetVersion += 1; };
    window.addEventListener(RECORD_RESET_EVENT, onReset);

    const initialize = async () => {
      const { data: auth } = await authClient.auth.getUser();
      if (!active) return;
      if (!auth.user) {
        setStatus("error");
        setMessage("로그인 상태를 확인하지 못했습니다.");
        return;
      }
      const userId = auth.user.id;
      prepareLanguageLocalState(userId);
      observedLocal = stableState(readLanguageState());

      const getRemote = async (): Promise<RemoteRow | null> => {
        const { data, error } = await authClient.from("language_user_state")
          .select("state, updated_at").eq("user_id", userId).maybeSingle();
        if (error) throw error;
        return data as RemoteRow | null;
      };

      const verifyRemote = async (expected: Record<string, unknown>) => {
        const confirmed = await getRemote();
        if (!confirmed || stableState(confirmed.state) !== stableState(expected)) {
          throw new Error("저장 후 서버 학습 기록이 달라졌습니다. 기기 기록은 보존했으니 다시 시도해 주세요.");
        }
      };

      const insertRemote = async (state: Record<string, unknown>) => {
        const { error } = await authClient.from("language_user_state").insert({
          user_id: userId,
          state,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        await verifyRemote(state);
      };

      const updateRemote = async (state: Record<string, unknown>, expectedUpdatedAt: string) => {
        const { data, error } = await authClient.from("language_user_state")
          .update({ state, updated_at: new Date().toISOString() })
          .eq("user_id", userId).eq("updated_at", expectedUpdatedAt)
          .select("updated_at").maybeSingle();
        if (error) throw error;
        if (!data) return false;
        await verifyRemote(state);
        return true;
      };

      const scheduleFollowUp = (delay = 250) => {
        if (!active || isRecordResetRunning()) return;
        setStatus("pending");
        clearTimeout(followUpTimer);
        followUpTimer = setTimeout(() => void sync(), delay);
      };

      const sync = async (initial = false) => {
        if (syncing || !active || isRecordResetRunning()) return;
        const version = resetVersion;
        const cancelled = () => !active || version !== resetVersion || isRecordResetRunning();
        syncing = true;
        setStatus("syncing");
        setMessage("");
        try {
          let local = readLanguageState();
          let remoteRow = await getRemote();
          if (cancelled()) return;
          local = readLanguageState();
          let remote = remoteRow?.state ?? {};
          const localHash = stableState(local);
          const remoteHash = stableState(remote);

          if (!remoteRow) {
            await insertRemote(local);
            if (cancelled()) return;
            lastSnapshot = localHash;
            saveLanguageSyncBase(userId, local);
          } else if (!lastSnapshot || initial) {
            const base = readLanguageSyncBase(userId);
            let merged = base ? mergeCloudStateFromBase(base, remote, local) : mergeCloudState(remote, local);
            let saved = stableState(merged) === remoteHash;
            for (let attempt = 0; attempt < 4 && !saved; attempt += 1) {
              saved = await updateRemote(merged, remoteRow.updated_at);
              if (cancelled()) return;
              if (!saved) {
                remoteRow = await getRemote();
                if (!remoteRow) break;
                remote = remoteRow.state;
                merged = mergeCloudStateFromBase(base ?? {}, remote, local);
              }
            }
            if (!saved) throw new Error("다른 기기의 학습 기록이 변경됐습니다. 다시 동기화해 주세요.");
            if (cancelled()) return;
            const latest = readLanguageState();
            applyLanguageState(mergeCloudStateFromBase(local, merged, latest));
            lastSnapshot = stableState(merged);
            saveLanguageSyncBase(userId, merged);
            if (local.languageRecordResetV1 !== merged.languageRecordResetV1) requestSafeReload();
          } else {
            const localChanged = localHash !== lastSnapshot;
            const remoteChanged = remoteHash !== lastSnapshot;
            if (localChanged && remoteChanged) {
              const base = readLanguageSyncBase(userId) ?? {};
              let merged = mergeCloudStateFromBase(base, remote, local);
              let saved = false;
              for (let attempt = 0; attempt < 4 && !saved; attempt += 1) {
                saved = await updateRemote(merged, remoteRow.updated_at);
                if (cancelled()) return;
                if (!saved) {
                  remoteRow = await getRemote();
                  if (!remoteRow) break;
                  merged = mergeCloudStateFromBase(base, remoteRow.state, local);
                }
              }
              if (!saved) throw new Error("다른 기기의 학습 기록이 변경됐습니다. 다시 동기화해 주세요.");
              if (cancelled()) return;
              applyLanguageState(mergeCloudStateFromBase(local, merged, readLanguageState()));
              lastSnapshot = stableState(merged);
              saveLanguageSyncBase(userId, merged);
              if (local.languageRecordResetV1 !== merged.languageRecordResetV1) requestSafeReload();
            } else if (localChanged) {
              const saved = await updateRemote(local, remoteRow.updated_at);
              if (!saved) throw new Error("다른 기기의 학습 기록이 변경됐습니다. 다시 동기화해 주세요.");
              if (cancelled()) return;
              lastSnapshot = localHash;
              saveLanguageSyncBase(userId, local);
            } else if (remoteChanged) {
              applyLanguageState(mergeCloudStateFromBase(local, remote, readLanguageState()));
              lastSnapshot = remoteHash;
              saveLanguageSyncBase(userId, remote);
              if (local.languageRecordResetV1 !== remote.languageRecordResetV1) requestSafeReload();
            }
          }

          if (!cancelled()) {
            const latestHash = stableState(readLanguageState());
            observedLocal = latestHash;
            const pending = latestHash !== lastSnapshot;
            setStatus(pending ? "pending" : "synced");
            if (pending) scheduleFollowUp();
          }
        } catch (error) {
          if (!cancelled()) {
            setStatus("error");
            setMessage(error instanceof Error ? error.message : "학습 기록 동기화에 실패했습니다.");
          }
        } finally {
          syncing = false;
        }
      };

      await sync(true);
      if (!active) return;
      setInitialized(true);
      syncVisibleChanges = () => {
        if (document.visibilityState === "visible") void sync();
      };
      interval = setInterval(syncVisibleChanges, 30_000);
      localWatch = setInterval(() => {
        if (!active || document.visibilityState !== "visible" || isRecordResetRunning()) return;
        const next = stableState(readLanguageState());
        if (next === observedLocal) return;
        observedLocal = next;
        scheduleFollowUp();
      }, 500);
      document.addEventListener("visibilitychange", syncVisibleChanges);
      window.addEventListener("focus", syncVisibleChanges);
      window.addEventListener("online", syncVisibleChanges);
    };

    void initialize().catch((error) => {
      if (!active) return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "학습 기록 연결에 실패했습니다.");
    });
    return () => {
      active = false;
      window.removeEventListener(RECORD_RESET_EVENT, onReset);
      clearTimeout(followUpTimer);
      if (interval) clearInterval(interval);
      if (localWatch) clearInterval(localWatch);
      if (syncVisibleChanges) {
        document.removeEventListener("visibilitychange", syncVisibleChanges);
        window.removeEventListener("focus", syncVisibleChanges);
        window.removeEventListener("online", syncVisibleChanges);
      }
    };
  }, [syncRequest]);

  const label = status === "syncing"
    ? "학습 기록 · 서버 반영 중…"
    : status === "synced"
      ? "학습 기록 · 서버 저장 확인"
      : status === "pending"
        ? "학습 기록 · 기기 저장, 서버 반영 대기"
        : "학습 기록 · 동기화 확인 필요";

  return <>
    {initialized ? children : <section style={{ padding: 24 }} aria-live="polite"><p>{status === "error" ? "학습 기록 연결을 확인하지 못했어요. 잠시 후 다시 열어 주세요." : "이 계정의 학습 기록을 준비하고 있어요."}</p>{status === "error" && <button type="button" className="btn" onClick={() => setSyncRequest((value) => value + 1)}>다시 연결하기</button>}</section>}
    <div role={status === "error" ? "alert" : "status"} className={`yeoni-sync-notice fixed z-[95] flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold shadow-md ring-1 backdrop-blur ${status === "error" ? "bg-red-50/95 text-red-700 ring-red-200" : status === "synced" ? "bg-emerald-50/95 text-emerald-700 ring-emerald-200" : "bg-amber-50/95 text-amber-700 ring-amber-200"}`}>
      <span>{label}</span>
      {status === "error" && <button type="button" onClick={() => setSyncRequest((value) => value + 1)} className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-red-700 shadow-sm">다시 시도</button>}
    </div>
    {status === "error" && message && <span className="sr-only">{message}</span>}
  </>;
}
