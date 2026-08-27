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
import {
  hasDeviceBiometric,
  isPlatformBiometricAvailable,
  registerDeviceBiometric,
  removeDeviceBiometric,
} from "../lib/deviceBiometric";

export default function DevicePinPanel() {
  const [user, setUser] = useState<User | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(async ({ data }) => {
      setUser(data.user);
      setEnabled(Boolean(data.user && await hasDevicePin(data.user.id)));
      setBiometricEnabled(Boolean(data.user && hasDeviceBiometric(data.user.id)));
    });
    void isPlatformBiometricAvailable().then(setBiometricAvailable);
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
    await setDevicePin(user.id, newPin, currentPin);
    setEnabled(true);
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setMessage(enabled ? "공통 PIN을 변경했습니다." : "Jace AI Hub 공통 PIN을 설정했습니다.");
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
    await removeDevicePin(user.id, currentPin);
    removeDeviceBiometric(user.id);
    setEnabled(false);
    setBiometricEnabled(false);
    setCurrentPin("");
    setMessage("Jace AI Hub 공통 PIN을 해제했습니다.");
    setSaving(false);
  };

  const enableBiometric = async () => {
    if (!user || saving || !enabled) return;
    setSaving(true);
    setMessage("");
    try {
      await registerDeviceBiometric(user.id, user.email || "운동 앱 사용자");
      setBiometricEnabled(true);
      setMessage("이 기기의 생체인증 잠금 해제를 설정했습니다.");
    } catch (error) {
      setMessage(error instanceof Error && error.name !== "NotAllowedError" ? error.message : "생체인증이 취소되었거나 완료되지 않았습니다.");
    } finally {
      setSaving(false);
    }
  };

  const disableBiometric = () => {
    if (!user || saving) return;
    removeDeviceBiometric(user.id);
    setBiometricEnabled(false);
    setMessage("이 기기의 생체인증 잠금 해제를 해제했습니다.");
  };

  if (!user) return null;
  return <section className="mb-4 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
    <p className="text-[12px] font-bold text-[#534AB7]">로그인 보안</p>
    <div className="mt-1 flex items-start justify-between gap-3">
      <div><h2 className="text-lg font-bold text-gray-900">Jace AI Hub 공통 PIN</h2><p className="mt-1 text-xs leading-relaxed text-gray-500">가계부·운동·식단·언어 앱에서 함께 사용하는 6자리 잠금입니다. PIN 원문은 저장하지 않습니다.</p></div>
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
    <div className="mt-5 border-t border-gray-100 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="text-sm font-bold text-gray-900">얼굴·지문으로 잠금 해제</h3><p className="mt-1 text-xs leading-relaxed text-gray-500">Windows Hello, Face ID 또는 기기 지문인식을 사용합니다. 생체정보는 앱에 저장되지 않습니다.</p></div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${biometricEnabled ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{biometricEnabled ? "사용 중" : "미설정"}</span>
      </div>
      {!biometricAvailable && <p className="mt-3 text-xs text-gray-400">현재 브라우저 또는 기기에서는 생체인증을 지원하지 않습니다.</p>}
      {biometricAvailable && <div className="mt-3 flex gap-2">
        {!biometricEnabled ? <button type="button" disabled={saving || !enabled} onClick={() => void enableBiometric()} className="rounded-xl border border-[#7F77DD] px-4 py-2.5 text-sm font-bold text-[#534AB7] disabled:opacity-40">생체인증 설정</button>
          : <button type="button" disabled={saving} onClick={disableBiometric} className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-bold text-red-600 disabled:opacity-40">생체인증 해제</button>}
      </div>}
      {biometricAvailable && !enabled && <p className="mt-2 text-[11px] text-gray-400">먼저 복구 수단으로 간편 PIN을 설정해 주세요.</p>}
    </div>
  </section>;
}
