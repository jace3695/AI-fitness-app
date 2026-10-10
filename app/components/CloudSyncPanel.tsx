"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  commitCloudSyncResponse,
  CloudSyncAcknowledgementStaleError,
  clearLocalCloudState,
  CLOUD_SESSION_CHANGED_EVENT,
  getRemoteState,
  isCurrentCloudSession,
  mergeCloudState,
  mergeCloudStateFromBase,
  readLocalCloudState,
  prepareLocalCloudState,
  readCloudSyncEpoch,
  readCloudSyncRequest,
  saveRemoteState,
  saveRemoteStateIfUnchanged,
  stableState,
} from "../data/cloudSync";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { strongPasswordError } from "../lib/passwordPolicy";
import { isRecordResetRunning, RECORD_RESET_EVENT, RECORD_RESET_APPS, resetMarkerKey } from "../data/appRecordReset";

import { CLOUD_RECORDS_REFRESH_EVENT, RECORDS_CHANGED_EVENT, hasStorageTransaction, STORAGE_JOURNAL_KEY, StorageSnapshotBusyError } from "../data/storageTransaction";
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
  const retryAuth = useRef<(() => void) | null>(null);
  const cancelSync = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let authVersion = 0;
    const applyUser = async (nextUser: User | null, version: number) => {
      if (!active) return;
      const nextId = nextUser?.id ?? null;
      const alreadyReady = nextId !== null && authUserId.current === nextId
        && isCurrentCloudSession(nextId, authEpoch.current);
      if (alreadyReady) { setUser(nextUser); return; }
      // Cancellation and shared owner fencing happen before either awaits.
      cancelSync.current?.();
      authUserId.current = nextId;
      setUser(null);
      setAuthRevision(revision => revision + 1);
      lastSynced.current = "";
      setStatus("idle");
      setLastSyncedAt(null);
      setMessage("");
      try {
        if (nextUser) await prepareLocalCloudState(nextUser.id);
        else await clearLocalCloudState();
        if (!active || version !== authVersion) return;
        const preparedEpoch = readCloudSyncEpoch();
        if (nextUser && !isCurrentCloudSession(nextUser.id, preparedEpoch)) throw new Error("계정이 변경되었습니다. 로그인 상태를 다시 확인해 주세요.");
        authEpoch.current = preparedEpoch;
        setStatus("idle");
        setMessage("");
        setUser(nextUser);
      } catch (error) {
        if (!active || version !== authVersion) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "기기 기록을 안전하게 준비하지 못했습니다. 다시 로그인해 주세요.");
      }
    };
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const version = ++authVersion;
      void applyUser(session?.user ?? null, version);
    });
    retryAuth.current = () => {
      const version = ++authVersion;
      void supabase!.auth.getUser().then(({ data, error }) => {
        if (error && error.name !== "AuthSessionMissingError") throw error;
        if (active && version === authVersion) return applyUser(data.user, version);
      }).catch(error => {
        if (!active || version !== authVersion) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "로그인 상태를 확인하지 못했습니다.");
      });
    };
    // A delayed initial lookup cannot undo a subsequent sign-out/sign-in event.
    const initialVersion = authVersion;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (error && error.name !== "AuthSessionMissingError") throw error;
      if (authVersion === initialVersion) return applyUser(data.user, initialVersion);
    }).catch(error => {
      if (!active || authVersion !== initialVersion) return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "로그인 상태를 확인하지 못했습니다.");
    });
    return () => { active = false; retryAuth.current = null; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!userId || !supabase) return;
    let active = true;
    let syncing = false;
    let refreshRequested = false;
    let remoteRefreshRequested = false;
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
    const onSessionChange = () => {
      if (!active || isCurrentCloudSession(userId, epoch)) return;
      stop();
      setStatus("error");
      setMessage("다른 창에서 로그인 상태가 변경되었습니다. 다시 시도하여 계정을 확인해 주세요.");
    };
    window.addEventListener(CLOUD_SESSION_CHANGED_EVENT, onSessionChange);
    const onReset = () => { resetVersion += 1; };
    window.addEventListener(RECORD_RESET_EVENT, onReset);

    const transactionPending = () => {
      try { return hasStorageTransaction(window.localStorage); }
      catch { return false; } // The guarded snapshot below reports corrupt metadata.
    };
    const deferTransaction = () => {
      refreshRequested = true;
      setStatus("pending");
      setMessage(window.localStorage.getItem(STORAGE_JOURNAL_KEY) !== null
        ? "이전 버전의 저장 복구 정보가 남아 있습니다. 이전 창을 모두 닫고 별도 복구 절차를 확인해 주세요. 기록은 그대로 보존했습니다."
        : "다른 창의 기록 저장이 끝나면 다시 동기화합니다.");
    };
    const sync = async () => {
      if (syncing || !active || !isCurrentCloudSession(userId, epoch) || isRecordResetRunning()) return;
      if (transactionPending()) {
        deferTransaction();
        return;
      }
      const version = resetVersion;
      const cancelled = () => !active || !isCurrentCloudSession(userId, epoch)
        || version !== resetVersion || isRecordResetRunning();
      const interrupted = () => {
        if (cancelled()) return true;
        if (transactionPending()) {
          deferTransaction();
          return true;
        }
        return false;
      };
      syncing = true;
      refreshRequested = false;
      remoteRefreshRequested = false;
      setStatus("syncing");
      try {
        // One owner-scoped coherent snapshot supplies both records and base.
        // Network never runs in the origin-wide local-storage lock.
        const request = readCloudSyncRequest(userId, epoch);
        const local = request.local;
        if (interrupted()) return;
        let remoteRow = await getRemoteState(userId, signal);
        if (interrupted()) return;
        let acknowledged = local;
        if (!remoteRow) {
          await saveRemoteState(userId, local, signal);
          if (interrupted()) return;
        } else {
          acknowledged = request.base
            ? mergeCloudStateFromBase(request.base, remoteRow.state, local)
            : mergeCloudState(remoteRow.state, local);
          if (stableState(acknowledged) !== stableState(remoteRow.state)) {
            let saved = false;
            // Keep a lost local-only CAS visible. A merge that already observed
            // changes on both sides may reread/retry its conditional update.
            const attempts = request.base && stableState(remoteRow.state) === stableState(request.base) ? 1 : 4;
            for (let attempt = 0; attempt < attempts && !saved; attempt += 1) {
              if (interrupted()) return;
              saved = await saveRemoteStateIfUnchanged(userId, acknowledged, remoteRow.updated_at, signal);
              if (interrupted()) return;
              if (!saved && attempt + 1 < attempts) {
                remoteRow = await getRemoteState(userId, signal);
                if (interrupted()) return;
                if (!remoteRow) break;
                acknowledged = request.base
                  ? mergeCloudStateFromBase(request.base, remoteRow.state, local)
                  : mergeCloudState(remoteRow.state, local);
              }
            }
            if (!saved) throw new Error("다른 기기의 변경을 확인했습니다. 다시 동기화해 주세요.");
          }
        }
        if (interrupted()) return;
        // Reconcile fresh local edits and advance the acknowledged base in the
        // same guarded transaction, including the remote-only/initial branches.
        const committed = await commitCloudSyncResponse(request, acknowledged);
        if (cancelled()) return;
        lastSynced.current = stableState(acknowledged);
        if (RECORD_RESET_APPS.some(app => local[resetMarkerKey(app)] !== committed.local[resetMarkerKey(app)])) requestSafeReload();
        const pending = committed.pending || transactionPending()
          || stableState(readLocalCloudState()) !== lastSynced.current;
        // The commit's own record event arrives before its Promise resolves.
        // Consume only that satisfied local wake; explicit remote wakes survive.
        if (!pending && !remoteRefreshRequested) refreshRequested = false;
        setStatus(pending ? "pending" : "synced");
        if (pending) followUpTimer = window.setTimeout(() => void sync(), 500);
        setMessage("");
        setLastSyncedAt(new Date());
      } catch (error) {
        if (!cancelled()) {
          if (error instanceof StorageSnapshotBusyError || error instanceof CloudSyncAcknowledgementStaleError || transactionPending()) {
            refreshRequested = true;
            setStatus("pending");
            return;
          }
          setStatus("error");
          setMessage(
            error instanceof Error ? error.message : "동기화에 실패했습니다.",
          );
        }
      } finally {
        syncing = false;
        // A server command may finish while an older GET is in flight. Read again
        // after that response settles, even if local storage has not changed.
        if (refreshRequested && !cancelled() && !transactionPending()) {
          window.clearTimeout(followUpTimer);
          followUpTimer = window.setTimeout(() => void sync(), 0);
        }
      }
    };

    void sync();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, 30000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void sync();
    };
    const onOnline = () => void sync();
    const onFocus = () => void sync();
    const onRemoteRecordsChanged = (event: Event) => {
      if ((event as CustomEvent<{ ownerId?: string }>).detail?.ownerId !== userId || !active || !isCurrentCloudSession(userId, epoch)) return;
      refreshRequested = true;
      remoteRefreshRequested = true;
      void sync();
    };
    const onRecordsChanged = () => {
      if (!isCurrentCloudSession(userId, epoch)) { onSessionChange(); return; }
      if (!active) return;
      if (transactionPending()) {
        deferTransaction();
        return;
      }
      // Retain a commit/removal event arriving during a GET/PATCH. Its finally
      // block starts a fresh read; a live journal is never recovered here.
      if (syncing) { refreshRequested = true; return; }
      try {
        if (!refreshRequested && stableState(readLocalCloudState()) === lastSynced.current) return;
      } catch {
        refreshRequested = true;
      }
      setStatus("pending");
      window.clearTimeout(followUpTimer);
      followUpTimer = window.setTimeout(() => void sync(), 500);
    };
    window.addEventListener(RECORDS_CHANGED_EVENT, onRecordsChanged);
    window.addEventListener(CLOUD_RECORDS_REFRESH_EVENT, onRemoteRecordsChanged);
    window.addEventListener("storage", onRecordsChanged);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      if (cancelSync.current === stop) cancelSync.current = null;
      window.removeEventListener(CLOUD_SESSION_CHANGED_EVENT, onSessionChange);
      window.removeEventListener(RECORD_RESET_EVENT, onReset);
      window.clearInterval(interval);
      window.clearTimeout(followUpTimer);
      window.removeEventListener(RECORDS_CHANGED_EVENT, onRecordsChanged);
      window.removeEventListener(CLOUD_RECORDS_REFRESH_EVENT, onRemoteRecordsChanged);
      window.removeEventListener("storage", onRecordsChanged);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
    };
  }, [syncRequest, userId, authRevision]);

  if (hideSignedOut && (!user || !isSupabaseConfigured)) {
    if (status === "error") return <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{message}</p>;
    return null;
  }
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
            {message ? (
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
            onClick={() => {
              if (!isCurrentCloudSession(userId!, authEpoch.current)) retryAuth.current?.();
              else setSyncRequest((current) => current + 1);
            }}
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
