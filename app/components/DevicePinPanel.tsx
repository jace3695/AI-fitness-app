"use client";

import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import {
  hasDevicePin,
  isValidPin,
  PIN_LENGTH,
  removeDevicePin,
  setDevicePin,
  verifyDevicePin,
} from "../lib/devicePin";

export default function DevicePinPanel() {
  const [user, setUser] = useState<User | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setEnabled(Boolean(data.user && hasDevicePin(data.user.id)));
    });
  }, []);

  const savePin = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || saving) return;
    setMessage("");
    if (!isValidPin(newPin)) return setMessage(`${PIN_LENGTH}자리 숫자를 입력해 주세요.`);
    if (newPin !== confirmPin) return setMessage("새 PIN이 서로 일치하지 않습니다.");
    setSaving(true);
    if (enabled) {
      const verified = await verifyDevicePin(user.id, currentPin);
      if (!verified.ok) {
        setMessage(verified.reason === "locked" ? "입력 제한 중입니다. 잠시 후 다시 시도해 주세요." : `현재 PIN이 맞지 않습니다. ${verified.remaining}회 남았습니다.`);
        setSaving(false);
        return;
      }
    }
    await setDevicePin(user.id, newPin);
    setEnabled(true);
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setMessage(enabled ? "간편 PIN을 변경했습니다." : "이 기기에 간편 PIN을 설정했습니다.");
    setSaving(false);
  };

  const disablePin = async () => {
    if (!user || saving) return;
    setMessage("");
    setSaving(true);
    const verified = await verifyDevicePin(user.id, currentPin);
    if (!verified.ok) {
      setMessage(verified.reason === "locked" ? "입력 제한 중입니다. 잠시 후 다시 시도해 주세요." : `현재 PIN이 맞지 않습니다. ${verified.remaining}회 남았습니다.`);
      setSaving(false);
      return;
    }
    removeDevicePin(user.id);
    setEnabled(false);
    setCurrentPin("");
    setMessage("이 기기의 간편 PIN을 해제했습니다.");
    setSaving(false);
  };

  if (!user) return null;
  return <section className="mb-4 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
    <p className="text-[12px] font-bold text-[#534AB7]">로그인 보안</p>
    <div className="mt-1 flex items-start justify-between gap-3">
      <div><h2 className="text-lg font-bold text-gray-900">간편 PIN</h2><p className="mt-1 text-xs leading-relaxed text-gray-500">이 기기에서만 사용하는 6자리 잠금입니다. PIN 원문은 저장하거나 클라우드로 전송하지 않습니다.</p></div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${enabled ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{enabled ? "사용 중" : "미설정"}</span>
    </div>
    <form onSubmit={savePin} className="mt-4 grid gap-3 sm:grid-cols-3">
      {enabled && <label className="text-xs font-bold text-gray-700">현재 PIN<input inputMode="numeric" autoComplete="current-password" maxLength={PIN_LENGTH} value={currentPin} onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, ""))} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-center tracking-[0.3em]" type="password" required /></label>}
      <label className="text-xs font-bold text-gray-700">새 PIN<input inputMode="numeric" autoComplete="new-password" maxLength={PIN_LENGTH} value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ""))} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-center tracking-[0.3em]" type="password" required /></label>
      <label className="text-xs font-bold text-gray-700">새 PIN 확인<input inputMode="numeric" autoComplete="new-password" maxLength={PIN_LENGTH} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ""))} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-center tracking-[0.3em]" type="password" required /></label>
      <div className="flex items-end gap-2 sm:col-span-3">
        <button disabled={saving} className="rounded-xl bg-[#534AB7] px-4 py-2.5 text-sm font-bold text-white disabled:bg-gray-300">{enabled ? "PIN 변경" : "PIN 설정"}</button>
        {enabled && <button type="button" disabled={saving || currentPin.length !== PIN_LENGTH} onClick={() => void disablePin()} className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-bold text-red-600 disabled:opacity-40">PIN 해제</button>}
      </div>
    </form>
    {message && <p role="status" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{message}</p>}
  </section>;
}
