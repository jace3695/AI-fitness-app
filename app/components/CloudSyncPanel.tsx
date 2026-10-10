"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  commitCloudSyncResponse,
  CloudSyncAcknowledgementStaleError,
  CloudSyncResponseConflictError,
  clearLocalCloudState,
  CLOUD_SESSION_CHANGED_EVENT,
  getRemoteState,
  isCurrentCloudSession,
  assertCloudSyncRequestCurrent,
  commitCloudSyncResolutionResponse,
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
import { classifyCloudSyncConflicts, createCloudSyncConflictReview, resolveCloudSyncConflictReview, CloudSyncConflictStaleError } from "../data/cloudSyncConflicts";
import type { CloudSyncConflictReview as ConflictReview, CloudSyncConflictChoice } from "../data/cloudSyncConflicts";
import type { CloudState } from "../data/cloudSync";
import CloudSyncConflictReview, { cloudSyncFieldLabel } from "./CloudSyncConflictReview";

function pendingCloudKeys(base: CloudState | null, local: CloudState) {
  return [...new Set([...Object.keys(base ?? {}), ...Object.keys(local)])]
    .filter(key => stableState({ value: base?.[key], present: base !== null && key in base }) !== stableState({ value: local[key], present: key in local }));
}
type ConflictSubmission = { review: ConflictReview; choices: CloudSyncConflictChoice[] };
type SyncIssue = { phase: "read" | "write" | "local"; message: string };
type AuthBinding = { userId: string | null; epoch: string | null };

type SyncStatus = "idle" | "pending" | "syncing" | "synced" | "conflict" | "error";

export default function CloudSyncPanel({ hideSignedOut = false }: { hideSignedOut?: boolean }) {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncRequest, setSyncRequest] = useState(0);
  const [authBinding, setAuthBinding] = useState<AuthBinding>({ userId: null, epoch: null });
  const [conflictReview, setConflictReview] = useState<ConflictReview | null>(null);
  const [reviewVersion, setReviewVersion] = useState(0);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [syncIssue, setSyncIssue] = useState<SyncIssue | null>(null);
  const heldReview = useRef<ConflictReview | null>(null);
  const submitConflicts = useRef<((submission: ConflictSubmission) => void) | null>(null);
  const userId = user?.id;
  const lastSynced = useRef("");
  const authUserId = useRef<string | null>(null);
  const authEpoch = useRef<string | null>(null);
  const retryAuth = useRef<(() => void) | null>(null);
  const cancelAuth = useRef<(() => void) | null>(null);
  const cancelSync = useRef<(() => void) | null>(null);
  const completedBinding = useRef<AuthBinding | null>(null);
  const liveSync = useRef<{ userId: string; epoch: string | null; active: boolean } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let authVersion = 0;
    const applyUser = async (nextUser: User | null, version: number) => {
      if (!active || version !== authVersion) return;
      const nextId = nextUser?.id ?? null;
      const alreadyReady = nextId !== null && authUserId.current === nextId
        && isCurrentCloudSession(nextId, authEpoch.current);
      const existing = liveSync.current;
      if (alreadyReady && existing?.active && existing.userId === nextId && existing.epoch === authEpoch.current) { setUser(nextUser); return; }
      // Fence even a published binding whose effect has not mounted yet.
      // Both pending activation and an existing loop retire before any await.
      completedBinding.current = null;
      cancelSync.current?.();
      if (alreadyReady) {
        // Restored shared readiness does not revive a retired sync closure.
        // A fresh owner check must precede a replacement effect generation.
        try {
          const verified = await supabase!.auth.getUser();
          if (!active || version !== authVersion) return;
          if (verified.error || verified.data.user?.id !== nextId) throw new Error("로그인 상태를 확인하지 못했습니다. 다시 시도하여 계정을 확인해 주세요.");
        } catch (error) {
          if (!active || version !== authVersion) return;
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "로그인 상태를 확인하지 못했습니다.");
          return;
        }
      }
      heldReview.current = null;
      setConflictReview(null);
      setPendingKeys([]);
      setSyncIssue(null);
      authUserId.current = nextId;
      setUser(null);
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
        // Publish one completed generation; object identity also fences any
        // superseded effect still waiting to mount.
        const binding = { userId: nextId, epoch: preparedEpoch };
        completedBinding.current = binding;
        setAuthBinding(binding);
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
    cancelAuth.current = () => {
      authVersion += 1;
      completedBinding.current = null;
      cancelSync.current?.();
    };
    retryAuth.current = () => {
      const version = ++authVersion;
      completedBinding.current = null;
      cancelSync.current?.();
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
    return () => { active = false; completedBinding.current = null; cancelAuth.current = null; retryAuth.current = null; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!userId || !supabase || authBinding.userId !== userId || completedBinding.current !== authBinding) return;
    let active = true;
    let syncing = false;
    let refreshRequested = false;
    let remoteRefreshRequested = false;
    let resetVersion = 0;
    let reviewInvalidatedByWrite = false;
    let followUpTimer: number | undefined;
    const controller = new AbortController();
    const signal = controller.signal;
    const epoch = authBinding.epoch;
    const registration = { userId, epoch, active: true };
    liveSync.current = registration;
    const stop = () => {
      active = false;
      registration.active = false;
      controller.abort();
      window.clearTimeout(followUpTimer);
      heldReview.current = null;
      setConflictReview(null);
      submitConflicts.current = null;
    };
    cancelSync.current = stop;
    const onSessionChange = () => {
      if (!active || isCurrentCloudSession(userId, epoch)) return;
      stop();
      setStatus("error");
      setMessage("다른 창에서 로그인 상태가 변경되었습니다. 다시 시도하여 계정을 확인해 주세요.");
    };
    window.addEventListener(CLOUD_SESSION_CHANGED_EVENT, onSessionChange);
    const clearReview = () => { heldReview.current = null; setConflictReview(null); };
    const onReset = () => { resetVersion += 1; clearReview(); setPendingKeys([]); setSyncIssue(null); };
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
    const showReview = (review: ConflictReview) => {
      if (stableState({ request: heldReview.current?.request, remote: heldReview.current?.remote }) !== stableState({ request: review.request, remote: review.remote })) {
        heldReview.current = review;
        setConflictReview(review);
        setReviewVersion(current => current + 1);
      }
      setStatus("conflict");
      setSyncIssue(null);
      setMessage(reviewInvalidatedByWrite
        ? "새로운 기기 저장 작업으로 이전 선택을 초기화했습니다. 저장이 계속되면 선택이 다시 초기화될 수 있습니다. 진행 중인 입력을 저장하고 해당 편집 화면을 닫은 뒤 최신 내용을 선택해 주세요. 다른 탭의 저장도 확인해 주세요."
        : "같은 항목의 변경을 선택할 때까지 서버 반영을 보류합니다.");
    };
    const sync = async (submission?: ConflictSubmission) => {
      if (syncing || !active || !isCurrentCloudSession(userId, epoch) || isRecordResetRunning()) return;
      if (submission && heldReview.current !== submission.review) return;
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
      let phase: SyncIssue["phase"] = "local";
      try {
        // One owner-scoped coherent snapshot supplies both records and base.
        // Network never runs in the origin-wide local-storage lock.
        const request = readCloudSyncRequest(userId, epoch);
        const local = request.local;
        setPendingKeys(pendingCloudKeys(request.base, local));
        if (interrupted()) return;
        phase = "read";
        let remoteRow = await getRemoteState(userId, signal);
        if (interrupted()) return;
        phase = "local";
        let acknowledged = local;
        let explicitResolution = false;
        if (!remoteRow) {
          if (submission) throw new CloudSyncConflictStaleError();
          if (request.base !== null) throw new Error("이전에 확인한 서버 기록을 찾을 수 없습니다. 기기 기록은 보존했으며 자동으로 다시 만들지 않습니다.");
          clearReview();
          // First insert uses the same narrow legacy normalization as updates;
          // the raw request remains unchanged for guarded acknowledgment.
          acknowledged = classifyCloudSyncConflicts(null, {}, local).merged!;
          phase = "write";
          await saveRemoteState(userId, acknowledged, signal);
          if (interrupted()) return;
        } else {
          if (submission) {
            acknowledged = resolveCloudSyncConflictReview(submission.review, submission.choices, request, remoteRow);
            // The short local guard validates the shown snapshot again. It never
            // encloses the following network request in a local storage lock.
            await assertCloudSyncRequestCurrent(submission.review.request);
            if (interrupted() || heldReview.current !== submission.review) return;
            explicitResolution = true;
          } else {
            const classified = classifyCloudSyncConflicts(request.base, remoteRow.state, local);
            if (classified.conflicts.length) { showReview(createCloudSyncConflictReview(request, remoteRow)); return; }
            acknowledged = classified.merged!;
            clearReview();
          }
          if (explicitResolution || stableState(acknowledged) !== stableState(remoteRow.state)) {
            let saved = false;
            const attempts = explicitResolution || request.base && stableState(remoteRow.state) === stableState(request.base) ? 1 : 4;
            for (let attempt = 0; attempt < attempts && !saved; attempt += 1) {
              if (interrupted()) return;
              phase = "write";
              saved = await saveRemoteStateIfUnchanged(userId, acknowledged, remoteRow.updated_at, signal, remoteRow.state);
              if (interrupted()) return;
              if (!saved && explicitResolution) throw new CloudSyncConflictStaleError();
              if (!saved && attempt + 1 < attempts) {
                phase = "read";
                remoteRow = await getRemoteState(userId, signal);
                if (interrupted()) return;
                if (!remoteRow) break;
                const classified = classifyCloudSyncConflicts(request.base, remoteRow.state, local);
                if (classified.conflicts.length) { showReview(createCloudSyncConflictReview(request, remoteRow)); return; }
                acknowledged = classified.merged!;
              }
            }
            if (!saved) throw new Error("다른 기기의 변경을 확인했습니다. 다시 동기화해 주세요.");
          }
        }
        if (interrupted()) return;
        // Reconcile fresh local edits and advance the acknowledged base in the
        // same guarded transaction, including the remote-only/initial branches.
        phase = "local";
        const committed = explicitResolution
          ? await commitCloudSyncResolutionResponse(request, acknowledged)
          : await commitCloudSyncResponse(request, acknowledged);
        if (cancelled()) return;
        clearReview();
        reviewInvalidatedByWrite = false;
        setSyncIssue(null);
        setPendingKeys(pendingCloudKeys(acknowledged, committed.local));
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
          if (error instanceof CloudSyncConflictStaleError) {
            clearReview();
            refreshRequested = true;
            setStatus("pending");
            setMessage("기록이 바뀌었습니다. 이전 선택은 적용하지 않고 최신 내용을 다시 확인합니다.");
            return;
          }
          if (error instanceof StorageSnapshotBusyError || error instanceof CloudSyncAcknowledgementStaleError || error instanceof CloudSyncResponseConflictError || transactionPending()) {
            refreshRequested = true;
            setStatus("pending");
            return;
          }
          setStatus("error");
          setSyncIssue({ phase, message: phase === "read" ? "서버 기록을 확인하지 못했습니다. 저장 여부를 판단하지 않았습니다." : phase === "write" ? "서버 저장 결과를 확인하지 못했습니다. 이미 반영되었을 수 있어 다시 조회합니다." : "기기 기록의 안전한 반영을 확인하지 못했습니다." });
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

    submitConflicts.current = submission => { void sync(submission); };
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
      clearReview();
      refreshRequested = true;
      remoteRefreshRequested = true;
      void sync();
    };
    const onRecordsChanged = () => {
      if (!isCurrentCloudSession(userId, epoch)) { onSessionChange(); return; }
      if (!active) return;
      if (heldReview.current) {
        try {
          const fresh = readCloudSyncRequest(userId, epoch);
          if (stableState({ request: fresh }) !== stableState({ request: heldReview.current.request })) { clearReview(); reviewInvalidatedByWrite = true; refreshRequested = true; }
        } catch { clearReview(); refreshRequested = true; }
      }
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
      if (liveSync.current === registration) liveSync.current = null;
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
  }, [syncRequest, userId, authBinding]);

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
      <div className={`rounded-2xl border p-3 text-[11px] ${status === "error" ? "border-red-100 bg-red-50 text-red-800" : status === "conflict" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-100 bg-emerald-50 text-emerald-800"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold">
              {status === "syncing"
                ? "기록 동기화 중…"
                : status === "error"
                  ? "기록 동기화 실패"
                  : status === "conflict" ? "기록 충돌 · 선택 필요" : status === "synced" ? "서버 반영 완료" : "기기 기록 · 서버 반영 대기"}
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
          <span className={`shrink-0 rounded-full px-2.5 py-1 font-bold ${status === "error" ? "bg-red-100 text-red-700" : status === "syncing" || status === "conflict" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
            {status === "error" ? "확인 필요" : status === "conflict" ? "선택 대기" : status === "syncing" ? "동기화 중" : status === "synced" ? "서버 저장 확인" : "반영 대기"}
          </span>
        </div>
        {syncIssue && <ul aria-label="동기화 확인 실패 목록" aria-live="polite" className="mt-3 list-inside list-disc rounded-lg bg-white p-2 text-red-800"><li>{syncIssue.message}</li></ul>}
        {pendingKeys.length > 0 && <details className="mt-3 rounded-lg bg-white p-2 text-gray-700">
          <summary className="cursor-pointer py-1 font-bold">서버 반영 대기 목록 {pendingKeys.length}개</summary>
          <p className="mt-1">아래 항목은 반영 대기 중입니다. 각각의 저장 실패가 확인된 것은 아닙니다.</p>
          <ul className="mt-2 max-h-40 list-inside list-disc overflow-y-auto">{pendingKeys.map(key => <li key={key} className="break-all">{cloudSyncFieldLabel([key])} · 반영 대기</li>)}</ul>
        </details>}
        {conflictReview && <CloudSyncConflictReview key={reviewVersion} review={conflictReview} busy={status === "syncing"}
          onResolve={choices => submitConflicts.current?.({ review: conflictReview, choices })} />}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={status === "syncing"}
            onClick={() => {
              if (!isCurrentCloudSession(userId!, authEpoch.current) || completedBinding.current !== authBinding
                || !liveSync.current?.active || liveSync.current.userId !== userId || liveSync.current.epoch !== authBinding.epoch) retryAuth.current?.();
              else setSyncRequest((current) => current + 1);
            }}
            className="flex-1 rounded-xl bg-white px-3 py-2 font-bold text-[#3C3489] shadow-sm disabled:cursor-wait disabled:opacity-50"
          >
            {status === "error" ? "다시 시도" : "지금 동기화"}
          </button>
          <button
            type="button"
            onClick={() => {
              // Retire pending authentication, activation and prompts before
              // signOut performs any asynchronous work.
              cancelAuth.current?.();
              heldReview.current = null;
              setConflictReview(null);
              setPendingKeys([]);
              setSyncIssue(null);
              setStatus("idle");
              void supabase?.auth.signOut().then(({ error }) => {
                if (error) { setStatus("error"); setMessage("로그아웃을 확인하지 못했습니다. 다시 시도하여 로그인 상태를 확인해 주세요."); }
              });
            }}
            className="rounded-xl bg-white px-3 py-2 font-bold text-gray-600 shadow-sm"
          >
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}
