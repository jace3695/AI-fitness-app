"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { isPasswordRecoveryRedirect, isSupabaseConfigured, supabase } from "../lib/supabase";
import { clearLocalCloudState } from "../data/cloudSync";
import {
  hasDevicePin,
  isPinSessionUnlocked,
  MAX_PIN_FAILURES,
  PIN_LENGTH,
  PIN_LOCK_MS,
  unlockPinSession,
  verifyDevicePin,
} from "../lib/devicePin";
import { hasDeviceBiometric, removeDeviceBiometric, verifyDeviceBiometric } from "../lib/deviceBiometric";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(isPasswordRecoveryRedirect);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [pinRequired, setPinRequired] = useState(false);
  const [pin, setPin] = useState("");
  const [pinMessage, setPinMessage] = useState("");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricSubmitting, setBiometricSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getUser().then(async ({ data }) => {
      setUser(data.user);
      if (data.user && isPasswordRecoveryRedirect) {
        setRecoveryMode(true);
      }
      const configured = data.user ? await hasDevicePin(data.user.id) : false;
      setPinRequired(Boolean(data.user && configured && !isPinSessionUnlocked(data.user.id)));
      setBiometricEnabled(Boolean(data.user && hasDeviceBiometric(data.user.id)));
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session?.user && isPasswordRecoveryRedirect)) {
        setRecoveryMode(true);
      }
      if (event === "SIGNED_OUT") {
        clearLocalCloudState();
        setRecoveryMode(false);
      }
      setUser(session?.user ?? null);
      if (session?.user) {
        void hasDevicePin(session.user.id).then((configured) => {
          setPinRequired(configured && !isPinSessionUnlocked(session.user.id));
        });
      } else {
        setPinRequired(false);
      }
      setBiometricEnabled(Boolean(session?.user && hasDeviceBiometric(session.user.id)));
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

  const unlockWithBiometric = async () => {
    if (!user || biometricSubmitting) return;
    setBiometricSubmitting(true);
    setPinMessage("");
    const verified = await verifyDeviceBiometric(user.id);
    if (verified) {
      unlockPinSession(user.id);
      setPinRequired(false);
    } else {
      setPinMessage("생체인증을 확인하지 못했습니다. 다시 시도하거나 PIN을 입력해 주세요.");
    }
    setBiometricSubmitting(false);
  };

  const unlockWithPin = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || pinSubmitting) return;
    setPinSubmitting(true);
    const result = await verifyDevicePin(user.id, pin);
    if (result.ok) {
      setPin("");
      setPinMessage("");
      setPinRequired(false);
    } else if (result.reason === "locked") {
      setPinMessage(`입력 횟수를 초과했습니다. ${Math.ceil((result.retryAt - Date.now()) / 1000)}초 후 다시 시도해 주세요.`);
    } else {
      setPinMessage(`PIN이 맞지 않습니다. ${result.remaining}회 남았습니다.`);
    }
    setPinSubmitting(false);
  };

  const resetDevicePin = async () => {
    if (!user || !supabase) return;
    removeDeviceBiometric(user.id);
    await supabase.auth.signOut();
  };

  const resetPassword = async () => {
    if (!supabase || !email) {
      setMessage("비밀번호 재설정 이메일을 받을 주소를 먼저 입력해 주세요.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/?recovery=1`,
    });
    setMessage(error ? error.message : "비밀번호 재설정 이메일을 보냈습니다.");
  };

  const updateRecoveredPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setMessage("");
    if (newPassword.length < 8) {
      setMessage("새 비밀번호는 8자 이상으로 입력해 주세요.");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setMessage("새 비밀번호와 확인 입력이 일치하지 않습니다.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setMessage(error.message);
      setSubmitting(false);
      return;
    }
    await supabase.auth.signOut();
    setNewPassword("");
    setNewPasswordConfirm("");
    setRecoveryMode(false);
    setMessage("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.");
    window.history.replaceState({}, "", "/");
    setSubmitting(false);
  };

  if (loading) return <div className="grid min-h-dvh place-items-center bg-[#F6F7FB] text-sm font-semibold text-[#534AB7]">내 운동 불러오는 중…</div>;
  if (!isSupabaseConfigured)
    return <div className="grid min-h-dvh place-items-center bg-[#F6F7FB] p-6"><div className="max-w-md rounded-3xl bg-white p-6 text-center shadow-sm"><h1 className="text-xl font-bold">로그인 설정이 필요합니다</h1><p className="mt-2 text-sm text-gray-600">운동 기록을 안전하게 분리하려면 Supabase 환경변수를 설정해 주세요.</p></div></div>;
  if (user && recoveryMode) return <main className="grid min-h-dvh place-items-center bg-gradient-to-br from-[#F6F7FB] via-white to-[#EEEDFE] p-4">
    <section className="w-full max-w-sm rounded-[28px] bg-white p-6 shadow-[0_24px_70px_rgba(83,74,183,0.16)] sm:p-8">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#534AB7] text-2xl font-bold text-white">J</div>
      <h1 className="mt-5 text-center text-xl font-bold text-gray-900">새 비밀번호 설정</h1>
      <p className="mt-2 text-center text-sm text-gray-500">운동앱과 가계부에서 함께 사용할 비밀번호를 입력하세요.</p>
      <form onSubmit={updateRecoveredPassword} className="mt-6 space-y-3">
        <label className="block text-sm font-bold text-gray-700">새 비밀번호<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 font-normal outline-none focus:border-[#7F77DD]" placeholder="8자 이상" /></label>
        <label className="block text-sm font-bold text-gray-700">새 비밀번호 확인<input type="password" autoComplete="new-password" minLength={8} required value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 font-normal outline-none focus:border-[#7F77DD]" placeholder="한 번 더 입력" /></label>
        <button disabled={submitting} className="w-full rounded-xl bg-[#534AB7] px-4 py-3.5 font-bold text-white disabled:bg-gray-300">{submitting ? "변경 중…" : "비밀번호 변경"}</button>
      </form>
      {message && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p>}
    </section>
  </main>;
  if (user && pinRequired) return <main className="grid min-h-dvh place-items-center bg-gradient-to-br from-[#F6F7FB] via-white to-[#EEEDFE] p-4">
    <section className="w-full max-w-sm rounded-[28px] bg-white p-6 text-center shadow-[0_24px_70px_rgba(83,74,183,0.16)] sm:p-8">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#534AB7] text-2xl font-bold text-white">J</div>
      <h1 className="mt-5 text-xl font-bold text-gray-900">간편 PIN 입력</h1>
      <p className="mt-2 text-sm text-gray-500">기존 4~6자리 또는 새 6자리 공통 PIN을 입력하세요.</p>
      {biometricEnabled && <button type="button" disabled={biometricSubmitting} onClick={() => void unlockWithBiometric()} className="mt-5 w-full rounded-xl border border-[#7F77DD] bg-[#F7F6FF] px-4 py-3 font-bold text-[#534AB7] disabled:opacity-50">{biometricSubmitting ? "생체인증 확인 중…" : "얼굴·지문으로 잠금 해제"}</button>}
      <form onSubmit={unlockWithPin} className="mt-5">
        <label className="sr-only" htmlFor="device-pin">간편 PIN</label>
        <input id="device-pin" autoFocus inputMode="numeric" autoComplete="current-password" type="password" maxLength={PIN_LENGTH} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} className="w-full rounded-xl border border-gray-200 px-4 py-3 text-center text-xl tracking-[0.45em] outline-none focus:border-[#7F77DD]" placeholder="••••••" />
        <button disabled={pinSubmitting || pin.length < 4 || pin.length > PIN_LENGTH} className="mt-3 w-full rounded-xl bg-[#534AB7] px-4 py-3 font-bold text-white disabled:bg-gray-300">{pinSubmitting ? "확인 중…" : "잠금 해제"}</button>
      </form>
      {pinMessage && <p role="alert" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{pinMessage}</p>}
      <p className="mt-4 text-[11px] leading-relaxed text-gray-400">PIN을 {MAX_PIN_FAILURES}회 틀리면 {PIN_LOCK_MS / 1000}초 동안 입력이 제한됩니다.</p>
      <button type="button" onClick={() => void resetDevicePin()} className="mt-3 text-xs font-semibold text-gray-500 underline">PIN을 잊으셨나요? 이메일로 다시 로그인</button>
    </section>
  </main>;
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
        <label className="block text-sm font-bold text-gray-700">비밀번호<input type="password" autoComplete={mode === "signIn" ? "current-password" : "new-password"} minLength={mode === "signUp" ? 8 : 6} required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 font-normal outline-none focus:border-[#7F77DD]" placeholder="8자 이상" /></label>
        <button disabled={submitting} className="w-full rounded-xl bg-[#534AB7] px-4 py-3.5 font-bold text-white disabled:bg-gray-300">{submitting ? "처리 중…" : mode === "signIn" ? "내 운동 보기" : "계정 만들기"}</button>
      </form>
      {mode === "signIn" && <button type="button" onClick={() => void resetPassword()} className="mt-3 w-full text-xs font-semibold text-gray-500 underline">비밀번호를 잊으셨나요?</button>}
      {message && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p>}
      <p className="mt-5 text-center text-[11px] leading-relaxed text-gray-400">운동 기록과 루틴은 로그인한 계정별로 분리되어 저장됩니다.</p>
    </section>
  </main>;
}
