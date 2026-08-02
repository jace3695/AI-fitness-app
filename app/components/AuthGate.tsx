"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { clearLocalCloudState } from "../data/cloudSync";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") clearLocalCloudState();
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const authenticate = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setSubmitting(true);
    setMessage("");
    const result = mode === "signIn"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    if (result.error) setMessage(result.error.message);
    else if (mode === "signUp" && !result.data.session)
      setMessage("확인 이메일을 보냈습니다. 이메일 인증 후 로그인해 주세요.");
    setSubmitting(false);
  };

  const resetPassword = async () => {
    if (!supabase || !email) {
      setMessage("비밀번호 재설정 이메일을 받을 주소를 먼저 입력해 주세요.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setMessage(error ? error.message : "비밀번호 재설정 이메일을 보냈습니다.");
  };

  if (loading) return <div className="grid min-h-dvh place-items-center bg-[#F6F7FB] text-sm font-semibold text-[#534AB7]">내 운동 불러오는 중…</div>;
  if (!isSupabaseConfigured)
    return <div className="grid min-h-dvh place-items-center bg-[#F6F7FB] p-6"><div className="max-w-md rounded-3xl bg-white p-6 text-center shadow-sm"><h1 className="text-xl font-bold">로그인 설정이 필요합니다</h1><p className="mt-2 text-sm text-gray-600">운동 기록을 안전하게 분리하려면 Supabase 환경변수를 설정해 주세요.</p></div></div>;
  if (user) return <>{children}</>;

  return <main className="grid min-h-dvh place-items-center bg-gradient-to-br from-[#F6F7FB] via-white to-[#EEEDFE] p-4">
    <section className="w-full max-w-md rounded-[28px] border border-white bg-white/95 p-6 shadow-[0_24px_70px_rgba(83,74,183,0.16)] sm:p-8">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#534AB7] text-2xl font-bold text-white">J</div>
      <h1 className="mt-5 text-center text-2xl font-bold text-gray-900">재민님의 운동</h1>
      <p className="mt-2 text-center text-sm text-gray-500">로그인하면 내 루틴과 운동 기록을 안전하게 불러옵니다.</p>
      <div className="mt-6 grid grid-cols-2 rounded-xl bg-gray-100 p-1 text-sm font-bold">
        <button type="button" onClick={() => { setMode("signIn"); setMessage(""); }} className={`rounded-lg py-2 ${mode === "signIn" ? "bg-white text-[#534AB7] shadow-sm" : "text-gray-500"}`}>로그인</button>
        <button type="button" onClick={() => { setMode("signUp"); setMessage(""); }} className={`rounded-lg py-2 ${mode === "signUp" ? "bg-white text-[#534AB7] shadow-sm" : "text-gray-500"}`}>계정 만들기</button>
      </div>
      <form onSubmit={authenticate} className="mt-5 space-y-3">
        <label className="block text-sm font-bold text-gray-700">이메일<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 font-normal outline-none focus:border-[#7F77DD]" placeholder="name@example.com" /></label>
        <label className="block text-sm font-bold text-gray-700">비밀번호<input type="password" autoComplete={mode === "signIn" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 font-normal outline-none focus:border-[#7F77DD]" placeholder="8자 이상" /></label>
        <button disabled={submitting} className="w-full rounded-xl bg-[#534AB7] px-4 py-3.5 font-bold text-white disabled:bg-gray-300">{submitting ? "처리 중…" : mode === "signIn" ? "내 운동 보기" : "계정 만들기"}</button>
      </form>
      {mode === "signIn" && <button type="button" onClick={() => void resetPassword()} className="mt-3 w-full text-xs font-semibold text-gray-500 underline">비밀번호를 잊으셨나요?</button>}
      {message && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p>}
      <p className="mt-5 text-center text-[11px] leading-relaxed text-gray-400">운동 기록과 루틴은 로그인한 계정별로 분리되어 저장됩니다.</p>
    </section>
  </main>;
}
