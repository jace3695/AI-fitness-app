"use client";

import { FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || loading) return;
    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setMessage(
      error
        ? error.message
        : "재설정 메일을 보냈습니다. 가장 최근에 받은 메일의 버튼을 한 번만 눌러주세요.",
    );
    setLoading(false);
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-[#F4F3FA] p-4 text-[#252331]">
      <section className="w-full max-w-sm rounded-[28px] border border-white bg-white p-7 shadow-[0_24px_70px_rgba(63,55,112,0.14)] sm:p-8">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#5146A6] text-2xl font-bold text-white">J</div>
        <p className="mt-4 text-center text-xs font-bold tracking-[0.16em] text-[#6E65B8]">AI YEONI</p>
        <h1 className="mt-2 text-center text-2xl font-bold">비밀번호 찾기</h1>
        <p className="mt-2 text-center text-sm leading-6 text-gray-500">운동·가계부·언어 앱에서 함께 사용하는 계정입니다.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-bold text-gray-700">
            이메일
            <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3.5 font-normal outline-none focus:border-[#6E65B8]" placeholder="name@example.com" />
          </label>
          <button disabled={loading} className="w-full rounded-xl bg-[#5146A6] px-4 py-3.5 font-bold text-white disabled:bg-gray-300">{loading ? "메일 보내는 중…" : "재설정 메일 받기"}</button>
        </form>
        {message && <p role="status" className="mt-4 rounded-xl bg-[#F0EEFF] px-3 py-3 text-sm leading-5 text-[#433A8F]">{message}</p>}
      </section>
    </main>
  );
}
