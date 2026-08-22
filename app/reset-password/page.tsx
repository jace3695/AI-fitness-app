"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("재설정 링크를 확인하고 있습니다.");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setMessage("인증 설정을 불러오지 못했습니다.");
      return;
    }

    let active = true;
    const authClient = supabase;
    const markReady = () => {
      if (!active) return;
      setReady(true);
      setMessage("새 비밀번호를 입력해 주세요.");
    };

    const initialize = async () => {
      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const authError = query.get("error_description") || hash.get("error_description");
      if (authError) {
        if (active) setMessage("링크가 만료되었거나 이미 사용되었습니다. 비밀번호 찾기에서 새 메일을 요청해 주세요.");
        return;
      }

      const code = query.get("code");
      if (code) {
        const { error } = await authClient.auth.exchangeCodeForSession(code);
        if (error) {
          if (active) setMessage("링크가 만료되었거나 이미 사용되었습니다. 비밀번호 찾기에서 새 메일을 요청해 주세요.");
          return;
        }
        window.history.replaceState({}, "", "/reset-password");
      }

      const { data } = await authClient.auth.getSession();
      if (data.session) markReady();
    };

    const { data: listener } = authClient.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) markReady();
    });

    void initialize();
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || loading) return;
    if (password.length < 8) {
      setMessage("새 비밀번호는 8자 이상으로 입력해 주세요.");
      return;
    }
    if (password !== confirm) {
      setMessage("새 비밀번호와 확인 입력이 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    await supabase.auth.signOut();
    setReady(false);
    setMessage("비밀번호가 변경되었습니다. 모든 앱에서 새 비밀번호로 로그인해 주세요.");
    setLoading(false);
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-[#F4F3FA] p-4 text-[#252331]">
      <section className="w-full max-w-sm rounded-[28px] border border-white bg-white p-7 shadow-[0_24px_70px_rgba(63,55,112,0.14)] sm:p-8">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#5146A6] text-2xl font-bold text-white">J</div>
        <p className="mt-4 text-center text-xs font-bold tracking-[0.16em] text-[#6E65B8]">JACE AI HUB</p>
        <h1 className="mt-2 text-center text-2xl font-bold">새 비밀번호 설정</h1>
        <p role="status" className="mt-2 text-center text-sm leading-6 text-gray-500">{message}</p>
        {ready && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-sm font-bold text-gray-700">새 비밀번호<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3.5 font-normal outline-none focus:border-[#6E65B8]" placeholder="8자 이상" /></label>
            <label className="block text-sm font-bold text-gray-700">새 비밀번호 확인<input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(event) => setConfirm(event.target.value)} className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3.5 font-normal outline-none focus:border-[#6E65B8]" placeholder="한 번 더 입력" /></label>
            <button disabled={loading} className="w-full rounded-xl bg-[#5146A6] px-4 py-3.5 font-bold text-white disabled:bg-gray-300">{loading ? "변경 중…" : "공통 비밀번호 변경"}</button>
          </form>
        )}
        {!ready && <a href="/forgot-password" className="mt-5 block text-center text-sm font-bold text-[#5146A6] underline">새 재설정 메일 요청하기</a>}
      </section>
    </main>
  );
}
