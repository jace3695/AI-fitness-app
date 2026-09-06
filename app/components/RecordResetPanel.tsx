"use client";

import { useEffect, useId, useRef, useState } from "react";
import { APP_RESET_INFO, setRecordResetRunning, type RecordResetApp } from "../data/appRecordReset";
import { resetAppRecords } from "../lib/resetAppRecords";
import { supabase } from "../lib/supabase";

export default function RecordResetPanel({ app }: { app: RecordResetApp }) {
  const info = APP_RESET_INFO[app];
  const id = useId();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const requestId = useRef("");
  const submitting = useRef(false);
  const ownerId = useRef("");
  const [accountEmail, setAccountEmail] = useState("");

  useEffect(() => {
    let active = true;
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user.id ?? "";
      if (ownerId.current && ownerId.current !== nextId) {
        setOpen(false);
        setConfirmation("");
        setAcknowledged(false);
        requestId.current = "";
      }
      ownerId.current = nextId;
      setAccountEmail(session?.user.email ?? "");
    });
    void supabase?.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return;
      ownerId.current = data.user.id;
      setAccountEmail(data.user.email ?? "");
      const key = `record-reset-receipt:${data.user.id}:${app}`;
      if (window.sessionStorage.getItem(key)) {
        setMessage(`${info.label} 기록을 초기화했어요. 유지되는 항목은 아래에서 확인해 주세요.`);
        window.sessionStorage.removeItem(key);
      }
    });
    return () => { active = false; subscription?.data.subscription.unsubscribe(); };
  }, [app, info.label]);

  const reset = async () => {
    if (submitting.current || confirmation !== "초기화" || !acknowledged) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    setRecordResetRunning(true);
    requestId.current ||= crypto.randomUUID();
    try {
      await resetAppRecords(app, requestId.current, ownerId.current);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "초기화 결과를 확인하지 못했어요.");
      setRecordResetRunning(false);
      submitting.current = false;
      setBusy(false);
    }
  };

  return <section className="rounded-2xl border border-red-200 bg-white p-5 text-gray-900 shadow-sm" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="text-lg font-bold">{info.label} 기록 초기화</h2>
    <p className="mt-2 break-all text-sm font-bold text-gray-700">대상 계정: {accountEmail || "계정 확인 중…"}</p>
    <p className="mt-2 text-sm leading-6"><b className="text-red-700">지워지는 기록:</b> {info.removes}</p>
    <p className="mt-2 text-sm leading-6 text-gray-600"><b>유지되는 항목:</b> {info.keeps}. 로그인·비밀번호·기기 잠금은 유지됩니다.</p>
    <p className="mt-2 text-sm leading-6 text-gray-600">이 계정의 전체 기간 기록을 클라우드와 연결된 기기에서 지웁니다. 되돌릴 수 없으니 필요한 기록은 먼저 보관하고, 다른 기기와 탭에서 진행 중인 작업을 끝내 주세요.</p>
    {message && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    {!open ? <button type="button" onClick={() => { setOpen(true); setMessage(""); }} className="mt-4 min-h-12 rounded-xl border border-red-300 px-4 font-bold text-red-700">{info.label} 기록 초기화하기</button> : <div className="mt-4 space-y-3 rounded-xl bg-red-50 p-4">
      <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" />위의 {info.label} 기록이 영구 삭제되는 것을 확인했어요.</label>
      <label htmlFor={`${id}-confirmation`} className="block text-sm font-bold">확인을 위해 ‘초기화’를 입력해 주세요.</label>
      <input id={`${id}-confirmation`} autoComplete="off" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} className="min-h-12 w-full rounded-xl border border-red-200 bg-white px-3 text-base" />
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => { setOpen(false); setConfirmation(""); setAcknowledged(false); }} className="min-h-12 flex-1 rounded-xl border border-gray-300 bg-white px-4 font-bold">취소</button><button type="button" disabled={busy || confirmation !== "초기화" || !acknowledged} onClick={() => void reset()} className="min-h-12 flex-1 rounded-xl bg-red-700 px-4 font-bold text-white disabled:bg-gray-300 disabled:text-gray-700">{busy ? "초기화 중…" : `${info.label} 기록 영구 삭제`}</button></div>
    </div>}
  </section>;
}
