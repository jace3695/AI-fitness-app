"use client";

import { useEffect, useId, useRef, useState } from "react";
import { authenticatedFetch, createClient } from "@/lib/supabase";
import { FREE_ADVICE_LABELS, type FreeAdviceContext, type FreeAdviceScope } from "@/lib/free-advice-context";
import type { FreeAdvice } from "@/lib/free-advice";
import ZephyrReadButton from './ZephyrReadButton';

type Preview = { context: FreeAdviceContext; fingerprint: string; configured: boolean };
type ApiBody = Partial<Preview> & { advice?: FreeAdvice; error?: string; code?: string };

export default function FreeAdvicePanel({ scope }: { scope: FreeAdviceScope }) {
  const id = useId();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [question, setQuestion] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [advice, setAdvice] = useState<FreeAdvice | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const requestNumber = useRef(0);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const identity = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (identity.current !== undefined && identity.current !== next) {
        requestNumber.current += 1;
        controller.current?.abort(); inFlight.current = false;
        setPreview(null); setAdvice(null); setQuestion(""); setAcknowledged(false); setNotice(""); setBusy(false);
      }
      identity.current = next;
    });
    return () => { subscription.unsubscribe(); requestNumber.current += 1; controller.current?.abort(); inFlight.current = false; };
  }, [scope]);

  async function requestAdvice(action: "preview" | "analyze", recordSource: FreeAdviceContext["recordSource"] = "user-records") {
    if (inFlight.current || action === "analyze" && (!preview || !acknowledged || !preview.configured)) return;
    inFlight.current = true; setBusy(true); setNotice(""); setAdvice(null);
    const currentRequest = ++requestNumber.current;
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort("timeout"), 45_000);
    if (action === "preview") { setPreview(null); setAcknowledged(false); }
    try {
      const response = await authenticatedFetch("/api/ai/free-advice", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({ scope, action, question, recordSource: action === "analyze" ? preview!.context.recordSource : recordSource, ...(action === "analyze" ? { fingerprint: preview!.fingerprint, freeDataUseAcknowledged: acknowledged } : {}) }),
      });
      const body: ApiBody = await response.json().catch(() => ({}));
      if (currentRequest !== requestNumber.current) return;
      if (!response.ok) {
        if (body.code === "FREE_ADVICE_RECORDS_CHANGED") { setPreview(null); setAcknowledged(false); }
        throw new Error(body.error || "조언을 준비하지 못했어요. 나중에 다시 이용해 주세요.");
      }
      if (action === "preview") {
        if (!body.context || typeof body.fingerprint !== "string" || typeof body.configured !== "boolean") throw new Error("기록 요약을 확인하지 못했어요.");
        setPreview({ context: body.context, fingerprint: body.fingerprint, configured: body.configured });
      } else {
        if (!body.advice) throw new Error("조언을 확인하지 못했어요.");
        setAdvice(body.advice);
      }
    } catch (error) {
      if (currentRequest === requestNumber.current) setNotice(abort.signal.reason === "timeout" ? "기록 확인에 시간이 오래 걸려 중단했어요. 나중에 다시 요청해 주세요." : error instanceof Error ? error.message : "연결을 확인한 뒤 다시 이용해 주세요.");
    } finally {
      window.clearTimeout(timeout);
      if (currentRequest === requestNumber.current) { inFlight.current = false; setBusy(false); }
    }
  }

  const areas = scope === "assistant" ? "운동·식단·학습·가계부" : scope === "fitness" ? "운동·식단" : FREE_ADVICE_LABELS[scope];
  return <section aria-label={`${FREE_ADVICE_LABELS[scope]} 무료 AI 조언`} className="my-5 rounded-3xl border border-violet-100 bg-white p-4 text-[#353052] shadow-sm sm:p-5">
    <p className="text-xs font-bold text-[#766DB8]">무료 AI 조언</p>
    <h2 className="mt-2 text-lg font-extrabold">기록을 보고 연이가 조언해요</h2>
    <p className="mt-2 text-sm leading-6 text-gray-600">{areas} 기록의 숫자를 함께 보고 오늘 할 일을 제안해요. 보낼 요약을 먼저 확인할 수 있어요.</p>
    <button type="button" disabled={busy} onClick={() => void requestAdvice("preview")} className="mt-4 min-h-11 rounded-2xl bg-[#F1EFFF] px-4 py-2 text-sm font-bold text-[#5146A6] disabled:opacity-50">{busy && !preview ? "기록 확인 중…" : preview ? "최신 기록 다시 확인" : "조언받을 기록 확인"}</button>
    <button type="button" disabled={busy} onClick={() => void requestAdvice("preview", "example")} className="mt-2 min-h-11 px-3 py-2 text-sm font-semibold text-[#665CC0] underline underline-offset-4 disabled:opacity-50">예시 기록으로 먼저 보기</button>
    {preview && <div className="mt-4 space-y-4">
      <div className="rounded-2xl bg-[#F8F7FC] p-4">
        <p className="text-sm font-bold">{preview.context.recordSource === "example" ? "가상의 예시 기록" : "보낼 기록 요약"}</p>
        <p className="mt-1 text-xs text-gray-600">{preview.context.startDate} ~ {preview.context.endDate} · {preview.context.recordSource === "example" ? "실제 내 기록을 사용하지 않는 예시" : "서버에 저장된 기록 기준"}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{preview.context.metrics.map(metric => <div key={metric.id} className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1 rounded-xl bg-white px-3 py-2"><dt className="break-keep text-gray-600">{metric.label}</dt><dd className="max-w-full break-all font-bold">{metric.value.toLocaleString("ko-KR")}{metric.unit}</dd></div>)}</dl>
        {preview.context.notes.map(note => <p key={note} className="mt-2 text-xs leading-5 text-gray-500">{note}</p>)}
      </div>
      {preview.context.recordCount === 0 ? <p role="status" className="text-sm leading-6 text-gray-600">아직 분석할 기록이 없어요. 기록을 서버에 저장한 뒤 다시 확인해 주세요.</p> : <>
        <label htmlFor={`${id}-question`} className="block text-sm font-bold">궁금한 점 <span className="font-normal text-gray-500">(선택)</span></label>
        <textarea id={`${id}-question`} value={question} maxLength={500} disabled={busy} onChange={event => setQuestion(event.target.value)} rows={3} placeholder="이 기록에서 오늘 한 가지만 바꾼다면 무엇이 좋을까?" className="w-full rounded-2xl border border-violet-200 bg-white p-3 text-sm text-gray-900" />
        <p className="text-xs leading-5 text-gray-500">위 집계 수치와 질문을 Google에 보냅니다. 이름·이메일·거래처·개인 메모는 기록 요약에 포함하지 않아요. 질문에도 비밀번호나 개인 식별정보를 적지 마세요.</p>
        <label className="flex items-start gap-2 text-xs leading-5 text-gray-600"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#665CC0]" /><span>요약과 질문이 Google에 전송되고 서비스 개선에 사용될 수 있음을 확인했어요.</span></label>
        <button type="button" disabled={busy || !acknowledged || !preview.configured} onClick={() => void requestAdvice("analyze")} className="min-h-11 w-full rounded-2xl bg-[#665CC0] px-4 py-3 text-sm font-bold text-white disabled:opacity-40">{busy ? "연이가 기록을 살펴보는 중…" : "무료 AI 조언받기"}</button>
        {!preview.configured && <p role="status" className="text-sm leading-6 text-gray-600">무료 AI 연결을 준비 중이에요. 기본 기록과 통계는 계속 사용할 수 있어요.</p>}
      </>}
    </div>}
    {notice && <p role="status" className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">{notice}</p>}
    {advice && <div aria-label="연이의 AI 조언" aria-live="polite" className="mt-5 space-y-3 border-t border-violet-100 pt-4">
      <p className="whitespace-pre-wrap text-sm font-semibold leading-6">{advice.summary}</p>
      <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">{advice.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ol>
      <p className="text-xs leading-5 text-gray-600"><b>기록 근거</b> · {advice.basis}</p>
      <p className="text-xs leading-5 text-gray-500">{advice.limitations}</p>
      <ZephyrReadButton text={[advice.summary, ...advice.nextSteps, advice.basis, advice.limitations].join('\n')} />
      <p className="text-xs leading-5 text-gray-500">{preview?.context.recordSource === "example" ? "가상의 예시로 만든 AI 조언이며, 실제 내 기록을 분석한 결과가 아니에요." : "무료 AI가 만든 조언이에요. 기록이나 계획을 자동으로 바꾸지 않아요."}</p>
    </div>}
  </section>;
}
