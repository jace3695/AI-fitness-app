"use client";

import { FormEvent, Fragment, ReactNode, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { isPasswordRecoveryRedirect, isSupabaseConfigured, supabase } from "../lib/supabase";
import { CLOUD_SESSION_CHANGED_EVENT, clearLocalCloudState, isCurrentCloudSession, prepareLocalCloudState, readCloudSyncEpoch } from "../data/cloudSync";
import { AuthenticatedStorageOwnerUnavailableError, revokeAuthenticatedStorageOwner, verifyAuthenticatedStorageOwner, type AuthenticatedStorageOwner } from "../data/authenticatedStorageOwner.ts";
import { AuthenticatedStorageOwnerProvider } from "./AuthenticatedStorageOwner.tsx";
import {
  hasDevicePin,
  isPinSessionUnlocked,
  MAX_PIN_FAILURES,
  PIN_LENGTH,
  reauthenticateDevicePin,
  unlockPinSession,
  verifyDevicePin,
} from "../lib/devicePin";
import { hasDeviceBiometric, removeDeviceBiometric, verifyDeviceBiometric } from "../lib/deviceBiometric";
import { PASSWORD_POLICY_HINT, strongPasswordError } from "../lib/passwordPolicy";
import { AppIcon } from "./AppIdentity";
import HubBottomNav from "./HubBottomNav";

class DevicePinRequiredError extends Error {}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ownerLease, setOwnerLease] = useState<AuthenticatedStorageOwner | null>(null);
  const ownerLeaseRef = useRef<AuthenticatedStorageOwner | null>(null);
  // Only an observed SIGNED_OUT authorizes cleanup, including its explicit retry.
  const confirmedSignOutRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [authCheckError, setAuthCheckError] = useState(false);
  const [authCheckMessage, setAuthCheckMessage] = useState("");
  const [authCheckAttempt, setAuthCheckAttempt] = useState(0);
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
  const [pinRequiresPassword, setPinRequiresPassword] = useState(false);
  const [accountPassword, setAccountPassword] = useState("");
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricSubmitting, setBiometricSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const authClient = supabase;
    let active = true;
    let authVersion = 0;
    let confirming = true;
    let confirmedUserId: string | null = null;
    let confirmedEpoch: string | null = null;
    let controller = new AbortController();
    let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
    const failed = (version: number, signal: AbortSignal, error?: unknown) => {
      if (!active || version !== authVersion || signal.aborted) return;
      confirming = false;
      revoke();
      if (error instanceof DevicePinRequiredError) { setAuthCheckError(false); setLoading(false); return; }
      if (!confirmedSignOutRef.current && (error instanceof AuthenticatedStorageOwnerUnavailableError || (error instanceof Error && error.name === "AuthSessionMissingError"))) {
        setUser(null); setPinRequired(false); setAuthCheckError(false); setLoading(false);
        return;
      }
      setAuthCheckMessage(error instanceof Error ? error.message : "연결 상태를 확인한 후 다시 시도해 주세요.");
      setAuthCheckError(true);
      setLoading(false);
    };
    const revoke = () => {
      revokeAuthenticatedStorageOwner(ownerLeaseRef.current);
      ownerLeaseRef.current = null;
      setOwnerLease(null);
    };
    const current = (version: number, signal: AbortSignal) => active && version === authVersion && !signal.aborted;
    const confirm = async (version: number, signal: AbortSignal, preparation?: Promise<boolean>, code?: string | null) => {
      if (preparation && !await preparation) return;
      if (!current(version, signal)) return;
      let verifiedUser: User | null = null;
      if (confirmedSignOutRef.current) {
        const result = await authClient.auth.getUser();
        if (!current(version, signal)) return;
        if (result.error && result.error.name !== "AuthSessionMissingError") throw result.error;
        if (!result.data.user) {
          await clearLocalCloudState();
          if (!current(version, signal)) return;
          setUser(null); setPinRequired(false); setBiometricEnabled(false);
          confirmedUserId = null; confirmedEpoch = null; confirming = false;
          setAuthCheckError(false); setLoading(false);
          return;
        }
      }
      const lease = await verifyAuthenticatedStorageOwner(window.localStorage, async () => {
        const result = await authClient.auth.getUser();
        if (!current(version, signal)) throw new Error("계정이 변경되었습니다. 로그인 상태를 다시 확인해 주세요.");
        verifiedUser = result.data.user;
        return result;
      }, async id => {
        if (!current(version, signal)) throw new Error("계정이 변경되었습니다. 로그인 상태를 다시 확인해 주세요.");
        await prepareLocalCloudState(id);
        if (!current(version, signal)) throw new Error("계정이 변경되었습니다. 로그인 상태를 다시 확인해 주세요.");
        const preparedEpoch = readCloudSyncEpoch();
        const configured = await hasDevicePin(id, signal);
        if (!current(version, signal) || !isCurrentCloudSession(id, preparedEpoch)) throw new Error("계정이 변경되었습니다. 로그인 상태를 다시 확인해 주세요.");
        if (configured && !isPinSessionUnlocked(id)) {
          setUser(verifiedUser); setPinRequired(true); setBiometricEnabled(hasDeviceBiometric(id));
          // No live lease exists while the PIN gate is locked. Unlock restarts
          // fresh authentication and preparation before authority is issued.
          throw new DevicePinRequiredError();
        }
      });
      if (!current(version, signal)) { revokeAuthenticatedStorageOwner(lease); return; }
      ownerLeaseRef.current = lease;
      const nextUser = verifiedUser as User | null;
      if (!nextUser) throw new Error("로그인 상태를 다시 확인해 주세요.");
      if (isPasswordRecoveryRedirect || code) setRecoveryMode(true);
      if (!lease.isCurrent()) throw new Error("계정이 변경되었습니다. 로그인 상태를 다시 확인해 주세요.");
      setUser(nextUser);
      setPinRequired(false);
      setBiometricEnabled(hasDeviceBiometric(nextUser.id));
      setOwnerLease(lease);
      confirmedSignOutRef.current = false;
      confirmedUserId = nextUser.id; confirmedEpoch = lease.epoch; confirming = false;
      setAuthCheckError(false); setLoading(false);
    };
    const initializeAuth = async () => {
      const version = authVersion, signal = controller.signal;
      try {
        const code = new URLSearchParams(window.location.search).get("code");
        if (code) {
          const { error } = await authClient.auth.exchangeCodeForSession(code);
          if (!current(version, signal)) return;
          if (error) setMessage("재설정 링크가 만료되었거나 이미 사용되었습니다. 새 이메일을 요청해 주세요.");
          else { setRecoveryMode(true); window.history.replaceState({}, "", "/?recovery=1"); }
        }
        await confirm(version, signal, undefined, code);
      } catch (error) { failed(version, signal, error); }
    };
    void initializeAuth();
    const { data } = authClient.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      // A callback is only a wake: it cannot mint authenticated runtime authority.
      let sameOwnerReady = false;
      try { sameOwnerReady = Boolean(session?.user.id === confirmedUserId && ownerLeaseRef.current?.isCurrent()
        && session?.user && isCurrentCloudSession(session.user.id, confirmedEpoch)); } catch { /* Fail closed on unavailable storage. */ }
      if (sameOwnerReady && session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
        setUser(session.user);
        return;
      }
      const version = ++authVersion;
      confirming = true;
      revoke(); // Synchronous, independent of React rendering or deferred auth lookup.
      controller.abort(); controller = new AbortController();
      const signal = controller.signal;
      clearTimeout(confirmationTimer);
      setAuthCheckError(false); setLoading(true);
      if (event === "PASSWORD_RECOVERY" || (session?.user && isPasswordRecoveryRedirect)) setRecoveryMode(true);
      if (event === "SIGNED_OUT") { confirmedSignOutRef.current = true; setRecoveryMode(false); }
      // Owner callbacks immediately invalidate shared work; null/error callbacks do
      // not imply permission to remove records. Only SIGNED_OUT may clear.
      let preparation: Promise<void>;
      try { preparation = session?.user ? prepareLocalCloudState(session.user.id)
        : event === "SIGNED_OUT" ? clearLocalCloudState() : Promise.resolve(); }
      catch (error) { failed(version, signal, error); return; }
      const ready = preparation.then(() => true, error => { failed(version, signal, error); return false; });
      confirmationTimer = setTimeout(() => {
        void confirm(version, signal, ready).catch(error => failed(version, signal, error));
      }, 0);
    });
    const onSessionChange = () => {
      if (confirming || !confirmedUserId) return;
      let ready = false;
      try { ready = Boolean(ownerLeaseRef.current?.isCurrent()) && isCurrentCloudSession(confirmedUserId, confirmedEpoch); } catch { /* Storage access itself can be denied. */ }
      if (!ready) {
        revoke();
        setAuthCheckMessage("다른 창에서 로그인 상태가 변경되었습니다. 다시 확인해 주세요.");
        setAuthCheckError(true);
        setLoading(false);
      }
    };
    window.addEventListener(CLOUD_SESSION_CHANGED_EVENT, onSessionChange);
    window.addEventListener("storage", onSessionChange);
    return () => {
      active = false; revoke(); controller.abort(); clearTimeout(confirmationTimer); data.subscription.unsubscribe();
      window.removeEventListener(CLOUD_SESSION_CHANGED_EVENT, onSessionChange);
      window.removeEventListener("storage", onSessionChange);
    };
  }, [authCheckAttempt]);

  const authenticate = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    if (mode === "signUp") {
      const passwordError = strongPasswordError(password);
      if (passwordError) {
        setMessage(passwordError);
        return;
      }
    }
    setSubmitting(true);
    setMessage("");
    const result = mode === "signIn"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    if (result.error) setMessage(result.error.message);
    else if (mode === "signUp" && !result.data.session)
      setMessage("가입 가능한 새 이메일이면 확인 메일이 발송됩니다. 메일이 오지 않으면 이미 가입된 주소일 수 있으니 로그인하거나 비밀번호를 재설정해 주세요.");
    setSubmitting(false);
  };

  const unlockWithBiometric = async () => {
    if (!user || biometricSubmitting) return;
    setBiometricSubmitting(true);
    setPinMessage("");
    const verified = await verifyDeviceBiometric(user.id);
    if (verified) {
      unlockPinSession(user.id);
      setPinRequired(false); setLoading(true); setAuthCheckAttempt(value => value + 1);
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
      setPinRequired(false); setLoading(true); setAuthCheckAttempt(value => value + 1);
    } else if (result.reason === "locked") {
      setPinRequiresPassword(true);
      setPinMessage("입력 횟수를 초과했습니다. 계정 비밀번호로 잠금을 해제해 주세요.");
    } else {
      setPinMessage(`PIN이 맞지 않습니다. ${result.remaining}회 남았습니다.`);
    }
    setPinSubmitting(false);
  };

  const unlockWithAccountPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || pinSubmitting || !accountPassword) return;
    setPinSubmitting(true);
    setPinMessage("");
    try {
      await reauthenticateDevicePin(user.id, accountPassword);
      setAccountPassword("");
      setPinRequiresPassword(false);
      setPinRequired(false); setLoading(true); setAuthCheckAttempt(value => value + 1);
    } catch (error) {
      setPinMessage(error instanceof Error ? error.message : "계정 비밀번호를 확인하지 못했습니다.");
    }
    setPinSubmitting(false);
  };

  const resetDevicePin = async () => {
    if (!user || !supabase) return;
    removeDeviceBiometric(user.id);
    await supabase.auth.signOut();
  };

  const resetPassword = () => {
    window.location.assign("/forgot-password");
  };

  const updateRecoveredPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setMessage("");
    const passwordError = strongPasswordError(newPassword);
    if (passwordError) {
      setMessage(passwordError);
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

  if (loading) return <div className="grid min-h-dvh place-items-center bg-yeoni-bg"><div className="flex flex-col items-center gap-3 text-sm font-semibold text-[#534AB7]"><AppIcon kind="assistant" className="h-16 w-16" />AI 연이를 불러오는 중…</div></div>;
  if (authCheckError) return <main className="grid min-h-dvh place-items-center bg-yeoni-bg p-6"><section className="max-w-md rounded-3xl bg-white p-6 text-center shadow-sm"><h1 className="text-xl font-bold">로그인 확인을 완료하지 못했어요</h1><p role="alert" className="mt-3 text-sm text-gray-600">{authCheckMessage || "연결 상태를 확인한 후 다시 시도해 주세요."}</p><button type="button" className="mt-5 min-h-11 rounded-xl bg-[#534AB7] px-5 font-bold text-white" onClick={() => { setLoading(true); setAuthCheckError(false); setAuthCheckAttempt(value => value + 1); }}>다시 확인</button></section></main>;
  if (!isSupabaseConfigured)
    return <div className="grid min-h-dvh place-items-center bg-yeoni-bg p-6"><div className="max-w-md rounded-3xl bg-white p-6 text-center shadow-sm"><h1 className="text-xl font-bold">로그인 설정이 필요합니다</h1><p className="mt-2 text-sm text-gray-600">운동 기록을 안전하게 분리하려면 Supabase 환경변수를 설정해 주세요.</p></div></div>;
  if (user && recoveryMode) return <main className="grid min-h-dvh place-items-center bg-gradient-to-br from-[#F6F7FB] via-white to-[#EEEDFE] p-4">
    <section className="w-full max-w-sm rounded-[28px] bg-white p-6 shadow-[0_24px_70px_rgba(83,74,183,0.16)] sm:p-8">
      <div className="flex justify-center"><AppIcon kind="assistant" className="h-14 w-14" /></div>
      <h1 className="mt-5 text-center text-xl font-bold text-gray-900">새 비밀번호 설정</h1>
      <p className="mt-2 text-center text-sm text-gray-500">AI 연이의 모든 기능에서 함께 사용할 비밀번호를 입력하세요.</p>
      <form onSubmit={updateRecoveredPassword} className="mt-6 space-y-3">
        <label className="block text-sm font-bold text-gray-700">새 비밀번호<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 font-normal outline-none focus:border-[#7F77DD]" placeholder={PASSWORD_POLICY_HINT} /></label>
        <label className="block text-sm font-bold text-gray-700">새 비밀번호 확인<input type="password" autoComplete="new-password" minLength={8} required value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 font-normal outline-none focus:border-[#7F77DD]" placeholder="한 번 더 입력" /></label>
        <button disabled={submitting} className="w-full rounded-xl bg-[#534AB7] px-4 py-3.5 font-bold text-white disabled:bg-gray-300">{submitting ? "변경 중…" : "비밀번호 변경"}</button>
      </form>
      {message && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p>}
    </section>
  </main>;
  if (user && pinRequired) return <main className="grid min-h-dvh place-items-center bg-gradient-to-br from-[#F6F7FB] via-white to-[#EEEDFE] p-4">
    <section className="w-full max-w-sm rounded-[28px] bg-white p-6 text-center shadow-[0_24px_70px_rgba(83,74,183,0.16)] sm:p-8">
      <div className="flex justify-center"><AppIcon kind="assistant" className="h-14 w-14" /></div>
      <h1 className="mt-5 text-xl font-bold text-gray-900">간편 PIN 입력</h1>
      <p className="mt-2 text-sm text-gray-500">기존 4~6자리 또는 새 6자리 공통 PIN을 입력하세요.</p>
      {biometricEnabled && <button type="button" disabled={biometricSubmitting} onClick={() => void unlockWithBiometric()} className="mt-5 w-full rounded-xl border border-[#7F77DD] bg-[#F7F6FF] px-4 py-3 font-bold text-[#534AB7] disabled:opacity-50">{biometricSubmitting ? "생체인증 확인 중…" : "얼굴·지문으로 잠금 해제"}</button>}
      {!pinRequiresPassword ? <form onSubmit={unlockWithPin} className="mt-5">
        <label className="sr-only" htmlFor="device-pin">간편 PIN</label>
        <input id="device-pin" autoFocus inputMode="numeric" autoComplete="current-password" type="password" maxLength={PIN_LENGTH} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} className="w-full rounded-xl border border-gray-200 px-4 py-3 text-center text-xl tracking-[0.45em] outline-none focus:border-[#7F77DD]" placeholder="••••••" />
        <button disabled={pinSubmitting || pin.length < 4 || pin.length > PIN_LENGTH} className="mt-3 w-full rounded-xl bg-[#534AB7] px-4 py-3 font-bold text-white disabled:bg-gray-300">{pinSubmitting ? "확인 중…" : "잠금 해제"}</button>
      </form> : <form onSubmit={unlockWithAccountPassword} className="mt-5">
        <label className="block text-left text-sm font-bold text-gray-700">계정 비밀번호<input autoFocus type="password" autoComplete="current-password" required value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 font-normal outline-none focus:border-[#7F77DD]" placeholder="공통 계정 비밀번호" /></label>
        <button disabled={pinSubmitting || !accountPassword} className="mt-3 w-full rounded-xl bg-[#534AB7] px-4 py-3 font-bold text-white disabled:bg-gray-300">{pinSubmitting ? "확인 중…" : "PIN 잠금 해제"}</button>
      </form>}
      {pinMessage && <p role="alert" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{pinMessage}</p>}
      <p className="mt-4 text-[11px] leading-relaxed text-gray-400">PIN을 {MAX_PIN_FAILURES}회 틀리면 계정 비밀번호 확인이 필요합니다.</p>
      <button type="button" onClick={() => void resetDevicePin()} className="mt-3 text-xs font-semibold text-gray-500 underline">다른 계정으로 로그인</button>
    </section>
  </main>;
  if (user && ownerLease) return <Fragment key={user.id}><AuthenticatedStorageOwnerProvider lease={ownerLease}>{children}<HubBottomNav /></AuthenticatedStorageOwnerProvider></Fragment>;

  return <main className="grid min-h-dvh place-items-center bg-gradient-to-br from-[#F6F7FB] via-white to-[#EEEDFE] p-4">
    <section className="w-full max-w-md rounded-[28px] border border-white bg-white/95 p-6 shadow-[0_24px_70px_rgba(83,74,183,0.16)] sm:p-8">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#534AB7] text-2xl font-bold text-white">J</div>
      <h1 className="mt-5 text-center text-2xl font-bold text-gray-900">AI 연이</h1>
      <p className="mt-2 text-center text-sm text-gray-500">한 번 로그인하고 나의 모든 앱을 안전하게 사용하세요.</p>
      <div className="mt-6 grid grid-cols-2 rounded-xl bg-gray-100 p-1 text-sm font-bold">
        <button type="button" onClick={() => { setMode("signIn"); setMessage(""); }} className={`rounded-lg py-2 ${mode === "signIn" ? "bg-white text-[#534AB7] shadow-sm" : "text-gray-500"}`}>로그인</button>
        <button type="button" onClick={() => { setMode("signUp"); setMessage(""); }} className={`rounded-lg py-2 ${mode === "signUp" ? "bg-white text-[#534AB7] shadow-sm" : "text-gray-500"}`}>계정 만들기</button>
      </div>
      <form onSubmit={authenticate} className="mt-5 space-y-3">
        <label className="block text-sm font-bold text-gray-700">이메일<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 font-normal outline-none focus:border-[#7F77DD]" placeholder="name@example.com" /></label>
        <label className="block text-sm font-bold text-gray-700">비밀번호<input type="password" autoComplete={mode === "signIn" ? "current-password" : "new-password"} minLength={mode === "signUp" ? 8 : 6} required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 font-normal outline-none focus:border-[#7F77DD]" placeholder={mode === "signUp" ? PASSWORD_POLICY_HINT : "공통 계정 비밀번호"} /></label>
        <button disabled={submitting} className="w-full rounded-xl bg-[#534AB7] px-4 py-3.5 font-bold text-white disabled:bg-gray-300">{submitting ? "처리 중…" : mode === "signIn" ? "AI 연이 시작" : "계정 만들기"}</button>
      </form>
      {mode === "signIn" && <button type="button" onClick={() => void resetPassword()} className="mt-3 w-full text-xs font-semibold text-gray-500 underline">비밀번호를 잊으셨나요?</button>}
      {message && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p>}
      <p className="mt-5 text-center text-[11px] leading-relaxed text-gray-400">가계부·운동·언어 앱이 하나의 공통 계정을 사용합니다.</p>
    </section>
  </main>;
}
