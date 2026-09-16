"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  applyCloudState,
  clearLocalCloudState,
  CLOUD_SESSION_CHANGED_EVENT,
  getRemoteState,
  isCurrentCloudSession,
  mergeCloudState,
  mergeCloudStateFromBase,
  readLocalCloudState,
  prepareLocalCloudState,
  readCloudSyncEpoch,
  readSyncBase,
  reconcileSyncResponse,
  saveRemoteState,
  saveRemoteStateIfUnchanged,
  saveSyncBase,
  stableState,
} from "../data/cloudSync";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { strongPasswordError } from "../lib/passwordPolicy";
import { isRecordResetRunning, RECORD_RESET_EVENT, RECORD_RESET_APPS, resetMarkerKey } from "../data/appRecordReset";

import { RECORDS_CHANGED_EVENT } from "../data/storageTransaction";
import { requestSafeReload } from "../lib/unsavedChanges";

type SyncStatus = "idle" | "pending" | "syncing" | "synced" | "error";

export default function CloudSyncPanel({ hideSignedOut = false }: { hideSignedOut?: boolean }) {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncRequest, setSyncRequest] = useState(0);
  const [authRevision, setAuthRevision] = useState(0);
  const userId = user?.id;
  const lastSynced = useRef("");
  const authUserId = useRef<string | null>(null);
  const authEpoch = useRef<string | null>(null);
  const cancelSync = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let authVersion = 0;
    const applyUser = (nextUser: User | null) => {
      if (!active) return;
      const nextId = nextUser?.id ?? null;
      if (authUserId.current !== nextId || authEpoch.current !== readCloudSyncEpoch()) {
        // Cancel synchronously, before React cleans up the previous effect.
        cancelSync.current?.();
        authUserId.current = nextId;
        // React can batch sign-out and same-user sign-in into one render.
        // The identity string alone cannot restart the cancelled owner then.
        setAuthRevision(revision => revision + 1);
        lastSynced.current = "";
        setStatus("idle");
        setLastSyncedAt(null);
        setMessage("");
      }
      if (nextUser) prepareLocalCloudState(nextUser.id);
      authEpoch.current = readCloudSyncEpoch();
      setUser(nextUser);
    };
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      authVersion += 1;
      if (event === "SIGNED_OUT") {
        applyUser(null);
        clearLocalCloudState();
      } else applyUser(session?.user ?? null);
    });
    // A delayed initial lookup cannot undo a subsequent sign-out/sign-in event.
    const initialVersion = authVersion;
    void supabase.auth.getUser().then(({ data }) => {
      if (authVersion === initialVersion) applyUser(data.user);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!userId || !supabase) return;
    let active = true;
    let syncing = false;
    let resetVersion = 0;
    let followUpTimer: number | undefined;
    const controller = new AbortController();
    const signal = controller.signal;
    const epoch = readCloudSyncEpoch();
    const stop = () => {
      active = false;
      controller.abort();
      window.clearTimeout(followUpTimer);
    };
    cancelSync.current = stop;
    window.addEventListener(CLOUD_SESSION_CHANGED_EVENT, stop);
    const onReset = () => { resetVersion += 1; };
    window.addEventListener(RECORD_RESET_EVENT, onReset);

    const sync = async (initial = false) => {
      if (syncing || !active || !isCurrentCloudSession(userId, epoch) || isRecordResetRunning()) return;
      const version = resetVersion;
      const cancelled = () => !active || !isCurrentCloudSession(userId, epoch)
        || version !== resetVersion || isRecordResetRunning();
      syncing = true;
      setStatus("syncing");
      try {
        let local = readLocalCloudState();
        let remoteRow = await getRemoteState(userId, signal);
        if (cancelled()) return;
        local = readLocalCloudState();
        let remote = remoteRow?.state ?? {};
        const localHash = stableState(local);
        const remoteHash = stableState(remote);

        if (!remoteRow) {
          await saveRemoteState(userId, local, signal);
          if (cancelled()) return;
          lastSynced.current = localHash;
          saveSyncBase(userId, local);
        } else if (!lastSynced.current || initial) {
          const base = readSyncBase(userId);
          let merged = base
            ? mergeCloudStateFromBase(base, remote, local)
            : mergeCloudState(remote, local);
          let mergedHash = stableState(merged);
          if (mergedHash !== remoteHash) {
            let saved = false;
            for (let attempt = 0; attempt < 4 && !saved; attempt += 1) {
              if (cancelled()) return;
              saved = await saveRemoteStateIfUnchanged(
                userId,
                merged,
                remoteRow.updated_at,
                signal,
              );
              if (cancelled()) return;
              if (!saved) {
                remoteRow = await getRemoteState(userId, signal);
                if (cancelled()) return;
                if (!remoteRow) break;
                remote = remoteRow.state;
                merged = mergeCloudStateFromBase(base ?? {}, remote, local);
                mergedHash = stableState(merged);
              }
            }
            if (!saved) throw new Error("다른 기기의 변경을 확인했습니다. 다시 동기화해 주세요.");
          }
          if (cancelled()) return;
          applyCloudState(reconcileSyncResponse(local, merged, readLocalCloudState()));
          lastSynced.current = mergedHash;
          saveSyncBase(userId, merged);
          if (RECORD_RESET_APPS.some(app => local[resetMarkerKey(app)] !== merged[resetMarkerKey(app)])) requestSafeReload();
        } else {
          const localChanged = localHash !== lastSynced.current;
          const remoteChanged = remoteHash !== lastSynced.current;
          if (localChanged && remoteChanged) {
            const base = readSyncBase(userId) ?? {};
            let merged = mergeCloudStateFromBase(base, remote, local);
            let saved = false;
            for (let attempt = 0; attempt < 4 && !saved; attempt += 1) {
              if (cancelled()) return;
              saved = await saveRemoteStateIfUnchanged(userId, merged, remoteRow.updated_at, signal);
              if (cancelled()) return;
              if (!saved) {
                remoteRow = await getRemoteState(userId, signal);
                if (cancelled()) return;
                if (!remoteRow) break;
                merged = mergeCloudStateFromBase(base, remoteRow.state, local);
              }
            }
            if (!saved) throw new Error("다른 기기의 변경을 확인했습니다. 다시 동기화해 주세요.");
            if (cancelled()) return;
            applyCloudState(reconcileSyncResponse(local, merged, readLocalCloudState()));
            lastSynced.current = stableState(merged);
            saveSyncBase(userId, merged);
            if (RECORD_RESET_APPS.some(app => local[resetMarkerKey(app)] !== merged[resetMarkerKey(app)])) requestSafeReload();
          } else if (localChanged) {
            const saved = await saveRemoteStateIfUnchanged(userId, local, remoteRow.updated_at, signal);
            if (!saved) throw new Error("다른 기기의 변경을 확인했습니다. 다시 동기화해 주세요.");
            if (cancelled()) return;
            lastSynced.current = localHash;
            saveSyncBase(userId, local);
          } else if (remoteChanged) {
            applyCloudState(remote);
            lastSynced.current = remoteHash;
            saveSyncBase(userId, remote);
            if (RECORD_RESET_APPS.some(app => local[resetMarkerKey(app)] !== remote[resetMarkerKey(app)])) requestSafeReload();
          }
        }
        if (!cancelled()) {
          const pending = stableState(readLocalCloudState()) !== lastSynced.current;
          setStatus(pending ? "pending" : "synced");
          if (pending) followUpTimer = window.setTimeout(() => void sync(), 500);
          setMessage("");
          setLastSyncedAt(new Date());
        }
      } catch (error) {
        if (!cancelled()) {
          setStatus("error");
          setMessage(
            error instanceof Error ? error.message : "동기화에 실패했습니다.",
          );
        }
      } finally {
        syncing = false;
      }
    };

    void sync(!lastSynced.current);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, 30000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void sync();
    };
    const onOnline = () => void sync();
    const onFocus = () => void sync();
    const onRecordsChanged = () => {
      if (!isCurrentCloudSession(userId, epoch)) { stop(); return; }
      if (syncing || !active) return;
      if (stableState(readLocalCloudState()) === lastSynced.current) return;
      setStatus("pending");
      window.clearTimeout(followUpTimer);
      followUpTimer = window.setTimeout(() => void sync(), 500);
    };
    window.addEventListener(RECORDS_CHANGED_EVENT, onRecordsChanged);
    window.addEventListener("storage", onRecordsChanged);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      if (cancelSync.current === stop) cancelSync.current = null;
      window.removeEventListener(CLOUD_SESSION_CHANGED_EVENT, stop);
      window.removeEventListener(RECORD_RESET_EVENT, onReset);
      window.clearInterval(interval);
      window.clearTimeout(followUpTimer);
      window.removeEventListener(RECORDS_CHANGED_EVENT, onRecordsChanged);
      window.removeEventListener("storage", onRecordsChanged);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
    };
  }, [syncRequest, userId, authRevision]);

  if (hideSignedOut && (!user || !isSupabaseConfigured)) return null;
  if (!isSupabaseConfigured)
    return (
      <div className="mt-3 w-full">
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          기기 동기화 환경변수가 아직 설정되지 않았습니다.
        </div>
      </div>
    );

  const authenticate = async (
    event: FormEvent,
    mode: "signIn" | "signUp",
  ) => {
    event.preventDefault();
    if (!supabase) return;
    setMessage("");
    if (mode === "signUp") {
      const passwordError = strongPasswordError(password);
      if (passwordError) {
        setMessage(passwordError);
        return;
      }
    }
    const result =
      mode === "signIn"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    if (result.error) setMessage(result.error.message);
    else if (mode === "signUp" && !result.data.session)
      setMessage("확인 이메일을 보냈습니다. 인증 후 로그인해 주세요.");
  };

  if (!user)
    return (
      <div className="mt-3 w-full">
        <form className="rounded-2xl border border-[#D9D6FE] bg-white p-3 shadow-sm">
          <p className="text-[13px] font-bold text-gray-800">
            아이패드·컴퓨터 기록 동기화
          </p>
          <p className="mt-1 text-[11px] text-gray-500">
            두 기기에서 같은 이메일 계정으로 로그인하세요. 기존 기록은 자동으로
            합쳐집니다.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="이메일"
              className="rounded-xl border border-gray-200 px-3 py-2 text-[13px]"
              required
            />
            <input
              type="password"
              autoComplete="current-password"
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="로그인 비밀번호"
              className="rounded-xl border border-gray-200 px-3 py-2 text-[13px]"
              required
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={(event) => void authenticate(event, "signIn")}
              className="flex-1 rounded-xl bg-[#534AB7] px-3 py-2 text-[12px] font-bold text-white"
            >
              로그인
            </button>
            <button
              onClick={(event) => void authenticate(event, "signUp")}
              className="rounded-xl bg-[#EEEDFE] px-3 py-2 text-[12px] font-bold text-[#534AB7]"
            >
              계정 만들기
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-gray-400">새 계정은 8자 이상이며 영문 대문자·소문자·숫자·특수문자를 모두 포함해야 합니다.</p>
          {message && (
            <p className="mt-2 text-[11px] text-amber-700">{message}</p>
          )}
        </form>
      </div>
    );

  return (
    <div className="mt-3 w-full">
      <div className={`rounded-2xl border p-3 text-[11px] ${status === "error" ? "border-red-100 bg-red-50 text-red-800" : "border-emerald-100 bg-emerald-50 text-emerald-800"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold">
              {status === "syncing"
                ? "기록 동기화 중…"
                : status === "error"
                  ? "기록 동기화 실패"
                  : status === "synced" ? "서버 반영 완료" : "기기 기록 · 서버 반영 대기"}
            </p>
            <p className="mt-0.5 truncate opacity-80">{user.email}</p>
            {status === "error" ? (
              <p className="mt-1 break-words">{message}</p>
            ) : lastSyncedAt ? (
              <p className="mt-1 opacity-80">
                마지막 확인 {lastSyncedAt.toLocaleTimeString("ko-KR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </p>
            ) : null}
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 font-bold ${status === "error" ? "bg-red-100 text-red-700" : status === "syncing" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
            {status === "error" ? "확인 필요" : status === "syncing" ? "동기화 중" : status === "synced" ? "서버 저장 확인" : "반영 대기"}
          </span>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={status === "syncing"}
            onClick={() => setSyncRequest((current) => current + 1)}
            className="flex-1 rounded-xl bg-white px-3 py-2 font-bold text-[#3C3489] shadow-sm disabled:cursor-wait disabled:opacity-50"
          >
            {status === "error" ? "다시 시도" : "지금 동기화"}
          </button>
          <button
            type="button"
            onClick={() => void supabase?.auth.signOut()}
            className="rounded-xl bg-white px-3 py-2 font-bold text-gray-600 shadow-sm"
          >
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}
