"use client";

import { useEffect, useId, useRef, useState } from "react";
import { APP_RESET_INFO, setRecordResetRunning, type RecordResetApp } from "../data/appRecordReset";
import { resetAppRecords } from "../lib/resetAppRecords";
import { supabase } from "../lib/supabase";
import { readPendingLanguageReset } from "../data/languageResetFence.ts";
import { LANGUAGE_RESET_FENCE_KEY } from "../data/languageStorageBoundary.ts";
import { captureStorageOwner, isStorageOwnerCurrent, RECORDS_CHANGED_EVENT } from "../data/storageTransaction.ts";

export default function RecordResetPanel({ app }: { app: RecordResetApp }) {
  const info = APP_RESET_INFO[app];
  const id = useId();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const requestId = useRef("");
  const submitting = useRef(false);
  const ownerId = useRef("");
  const ownerRevision = useRef(0);
  const mounted = useRef(false);
  const [accountEmail, setAccountEmail] = useState("");

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const inspectIncomplete = () => {
      if (!active || app !== "language" || !ownerId.current) return;
      try {
        const pending = readPendingLanguageReset(ownerId.current);
        setIncomplete(!!pending);
        if (pending) {
          requestId.current = pending.requestId;
          setMessage("완료되지 않은 일본어 기록 초기화가 있어요. 같은 요청으로 서버 결과를 확인해 주세요. 새 초기화는 자동으로 실행되지 않습니다.");
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "학습 초기화 상태를 확인하지 못했어요. 기록은 보존했습니다.");
      }
    };
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user.id ?? "";
      if (ownerId.current !== nextId) ownerRevision.current += 1;
      if (ownerId.current && ownerId.current !== nextId) {
        setOpen(false);
        setConfirmation("");
        setAcknowledged(false);
        requestId.current = "";
        setIncomplete(false);
        setMessage("");
      }
      ownerId.current = nextId;
      setAccountEmail(session?.user.email ?? "");
      inspectIncomplete();
    });
    const revision = ownerRevision.current;
    void supabase?.auth.getUser().then(({ data }) => {
      if (!active || !data.user || revision !== ownerRevision.current) return;
      ownerId.current = data.user.id;
      setAccountEmail(data.user.email ?? "");
      try {
        const key = `record-reset-receipt:${data.user.id}:${app}`;
        if (window.sessionStorage.getItem(key)) {
          setMessage(`${info.label} 기록을 초기화했어요. 유지되는 항목은 아래에서 확인해 주세요.`);
          window.sessionStorage.removeItem(key);
        }
      } catch { setMessage("이 기기의 초기화 안내를 읽지 못했어요. 초기화 상태를 다시 확인해 주세요."); }
      inspectIncomplete();
    }).catch(() => { if (active) setMessage("로그인 상태를 다시 확인해 주세요."); });
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === LANGUAGE_RESET_FENCE_KEY) inspectIncomplete(); };
    if (app === "language") {
      window.addEventListener("storage", onStorage);
      window.addEventListener(RECORDS_CHANGED_EVENT, inspectIncomplete);
    }
    return () => {
      active = false; mounted.current = false; subscription?.data.subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(RECORDS_CHANGED_EVENT, inspectIncomplete);
    };
  }, [app, info.label]);

  const reset = async () => {
    if (submitting.current || confirmation !== "초기화" || !acknowledged) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    setRecordResetRunning(true);
    requestId.current ||= crypto.randomUUID();
    try {
      const expectedOwner = ownerId.current;
      const revision = ownerRevision.current;
      const owner = captureStorageOwner();
      await resetAppRecords(app, requestId.current, expectedOwner);
      if (!mounted.current || ownerId.current !== expectedOwner || ownerRevision.current !== revision || !isStorageOwnerCurrent(window.localStorage, owner)) {
        setRecordResetRunning(false);
        submitting.current = false;
        if (mounted.current) setBusy(false);
        return;
      }
      window.location.reload();
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "초기화 결과를 확인하지 못했어요.");
      setRecordResetRunning(false);
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return <section className="rounded-2xl border border-red-200 bg-white p-5 text-gray-900 shadow-sm" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="text-lg font-bold">{info.label} 기록 초기화</h2>
    <p className="mt-2 break-all text-sm font-bold text-gray-700">대상 계정: {accountEmail || "계정 확인 중…"}</p>
    <p className="mt-2 text-sm leading-6"><b className="text-red-700">지워지는 기록:</b> {info.removes}</p>
    <p className="mt-2 text-sm leading-6 text-gray-600"><b>유지되는 항목:</b> {info.keeps}. 로그인·비밀번호·기기 잠금은 유지됩니다.</p>
    <p className="mt-2 text-sm leading-6 text-gray-600">이 계정의 전체 기간 기록을 클라우드와 연결된 기기에서 지웁니다. 되돌릴 수 없으니 필요한 기록은 먼저 보관하고, 다른 기기와 탭에서 진행 중인 작업을 끝내 주세요.</p>
    {message && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    {!open ? <button type="button" onClick={() => { setOpen(true); if (!incomplete) setMessage(""); }} className="mt-4 min-h-12 rounded-xl border border-red-300 px-4 font-bold text-red-700">{incomplete ? "진행 중인 초기화 결과 확인하기" : `${info.label} 기록 초기화하기`}</button> : <div className="mt-4 space-y-3 rounded-xl bg-red-50 p-4">
      <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" />위의 {info.label} 기록이 영구 삭제되는 것을 확인했어요.</label>
      <label htmlFor={`${id}-confirmation`} className="block text-sm font-bold">확인을 위해 ‘초기화’를 입력해 주세요.</label>
      <input id={`${id}-confirmation`} autoComplete="off" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} className="min-h-12 w-full rounded-xl border border-red-200 bg-white px-3 text-base" />
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => { setOpen(false); setConfirmation(""); setAcknowledged(false); }} className="min-h-12 flex-1 rounded-xl border border-gray-300 bg-white px-4 font-bold">취소</button><button type="button" disabled={busy || confirmation !== "초기화" || !acknowledged} onClick={() => void reset()} className="min-h-12 flex-1 rounded-xl bg-red-700 px-4 font-bold text-white disabled:bg-gray-300 disabled:text-gray-700">{busy ? "초기화 중…" : incomplete ? "같은 초기화 요청 확인" : `${info.label} 기록 영구 삭제`}</button></div>
    </div>}
  </section>;
}
