"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  applyCloudState,
  getRemoteState,
  mergeCloudState,
  readLocalCloudState,
  saveRemoteState,
  stableState,
} from "../data/cloudSync";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

type SyncStatus = "idle" | "syncing" | "synced" | "error";

export default function CloudSyncPanel() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncRequest, setSyncRequest] = useState(0);
  const lastSynced = useRef("");
  const syncing = useRef(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      lastSynced.current = "";
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !supabase) return;
    let active = true;

    const sync = async (initial = false) => {
      if (syncing.current || !active) return;
      syncing.current = true;
      setStatus("syncing");
      try {
        const local = readLocalCloudState();
        const remoteRow = await getRemoteState(user.id);
        const remote = remoteRow?.state ?? {};
        const localHash = stableState(local);
        const remoteHash = stableState(remote);

        if (!remoteRow) {
          await saveRemoteState(user.id, local);
          lastSynced.current = localHash;
        } else if (!lastSynced.current || initial) {
          const merged = mergeCloudState(remote, local);
          const mergedHash = stableState(merged);
          applyCloudState(merged);
          if (mergedHash !== remoteHash) await saveRemoteState(user.id, merged);
          lastSynced.current = mergedHash;
          if (mergedHash !== localHash) window.location.reload();
        } else {
          const localChanged = localHash !== lastSynced.current;
          const remoteChanged = remoteHash !== lastSynced.current;
          if (localChanged && remoteChanged) {
            const merged = mergeCloudState(remote, local);
            applyCloudState(merged);
            await saveRemoteState(user.id, merged);
            lastSynced.current = stableState(merged);
          } else if (localChanged) {
            await saveRemoteState(user.id, local);
            lastSynced.current = localHash;
          } else if (remoteChanged) {
            applyCloudState(remote);
            lastSynced.current = remoteHash;
            window.location.reload();
          }
        }
        if (active) {
          setStatus("synced");
          setMessage("");
          setLastSyncedAt(new Date());
        }
      } catch (error) {
        if (active) {
          setStatus("error");
          setMessage(
            error instanceof Error ? error.message : "동기화에 실패했습니다.",
          );
        }
      } finally {
        syncing.current = false;
      }
    };

    void sync(!lastSynced.current);
    const interval = window.setInterval(() => void sync(), 3000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [syncRequest, user]);

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
              placeholder="비밀번호(6자 이상)"
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
                  : "기록 동기화 완료"}
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
            {status === "error" ? "확인 필요" : status === "syncing" ? "동기화 중" : "안전하게 저장됨"}
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
