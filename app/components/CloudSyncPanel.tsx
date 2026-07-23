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

    void sync(true);
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
  }, [user]);

  if (!isSupabaseConfigured)
    return (
      <div className="mx-auto mt-3 max-w-3xl px-4">
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
      <div className="mx-auto mt-3 max-w-3xl px-4">
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
    <div className="mx-auto mt-3 max-w-3xl px-4">
      <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
        <span>
          {status === "syncing"
            ? "기록 동기화 중…"
            : status === "error"
              ? `동기화 오류: ${message}`
              : `기록 동기화 완료 · ${user.email}`}
        </span>
        <button
          onClick={() => void supabase?.auth.signOut()}
          className="font-bold text-emerald-900"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
