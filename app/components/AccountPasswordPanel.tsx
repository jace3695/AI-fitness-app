"use client";

import { FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";
import { PASSWORD_POLICY_HINT, strongPasswordError } from "../lib/passwordPolicy";

export default function AccountPasswordPanel() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const policyError = strongPasswordError(password);
    if (policyError) return setMessage(policyError);
    if (password !== confirm) return setMessage("새 비밀번호가 서로 일치하지 않습니다.");
    if (!supabase) return setMessage("로그인 설정을 확인하지 못했습니다.");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return setMessage(error.message || "비밀번호를 변경하지 못했습니다.");
    setPassword(""); setConfirm("");
    setMessage("AI 연이 공통 비밀번호를 변경했습니다.");
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="rounded-3xl border border-white bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-bold text-gray-900">공통 계정 비밀번호</h2>
      <p className="mt-1 text-xs leading-5 text-gray-500">모든 앱이 같은 계정 비밀번호를 사용합니다. 최근 로그인 확인이 필요할 수 있습니다.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-gray-700">새 비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={PASSWORD_POLICY_HINT} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" required /></label>
        <label className="text-xs font-bold text-gray-700">새 비밀번호 확인<input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="한 번 더 입력" className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" required /></label>
      </div>
      <button disabled={saving} className="mt-4 rounded-xl bg-[#534AB7] px-4 py-2.5 text-sm font-bold text-white disabled:bg-gray-300">{saving ? "변경 중…" : "비밀번호 변경"}</button>
      {message && <p className="mt-3 text-xs font-semibold text-[#534AB7]" role="status">{message}</p>}
    </form>
  );
}
