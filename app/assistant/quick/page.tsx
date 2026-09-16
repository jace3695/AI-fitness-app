"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/app/lib/supabase";
import ZephyrReadButton from '@/components/ZephyrReadButton';
import { AssistantCommandReview } from '@/components/AssistantCommandReview';
import type { AssistantCommandProposal } from '@/lib/assistant-command-drafts';
import { useTaskCommandDrafts } from '@/hooks/useTaskCommandDrafts';

type ShortcutResponse = { reply?: string; error?: string; action?: { label: string; href: string }; proposal?: AssistantCommandProposal };

const samples = ["오늘 브리핑 보여줘", "오늘 운동 계획 보여줘", "일본어 복습 시작해줘", "오늘 단어 학습 완료했어", "오늘 할 일에 우유 사기 추가해줘", "가계부 오늘 편의점 지출 금액을 5,000원으로 수정해줘"];

function isIncompleteVoiceCommand(value: string) {
  const compact = value.replace(/\s/g, "");
  return compact.length < 4 || /^(오늘|내일|모레|브리핑|운동|가계부|일본어|할일|일정)$/.test(compact);
}

function QuickCommandContent() {
  const searchParams = useSearchParams();
  const pending = useTaskCommandDrafts();
  const { add: saveProposal, ready: draftsReady } = pending;
  const initialCommand = searchParams.get("command")?.slice(0, 500) ?? "";
  // URL 명령은 자동 해석한다. 할 일 추가·수정은 확인 버튼을 눌러야 저장한다.
  // 브라우저에서 수동 확인이 필요할 때만 `autorun=0`으로 명시적으로 끈다.
  const shouldAutoRun = initialCommand.trim().length > 0 && searchParams.get("autorun") !== "0";
  const [command, setCommand] = useState(initialCommand);
  const [result, setResult] = useState<ShortcutResponse | null>(null);
  const [sending, setSending] = useState(false);
  const autoRunAttempted = useRef(false);

  const run = useCallback(async (requestedCommand?: string) => {
    const value = (requestedCommand ?? command).trim();
    if (!value || !supabase || sending || !draftsReady) return;
    if (isIncompleteVoiceCommand(value)) {
      const failure = { error: `‘${value}’까지만 들렸어요. 예: ‘오늘 브리핑 보여줘’처럼 명령을 끝까지 다시 말해 주세요.` };
      setResult(failure);
      return;
    }
    // Consume the URL once, so reload cannot silently create a different request ID.
    const url = new URL(window.location.href);
    url.searchParams.delete('command'); url.searchParams.delete('autorun');
    window.history.replaceState(null, '', url.pathname + url.search);
    setSending(true);
    setResult(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: value }),
      });
      const body = await response.json() as ShortcutResponse;
      if (!response.ok) throw new Error(body.error || "명령을 처리하지 못했습니다.");
      if (body.proposal) await saveProposal(body.proposal, data.session!.user.id);
      setResult(body);
    } catch (error) {
      const failure = { error: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요." };
      setResult(failure);
    } finally {
      setSending(false);
    }
  }, [command, sending, draftsReady, saveProposal]);

  useEffect(() => {
    if (!draftsReady || !shouldAutoRun || !initialCommand.trim() || autoRunAttempted.current) return;
    autoRunAttempted.current = true;
    void run(initialCommand);
  }, [initialCommand, run, shouldAutoRun, draftsReady]);

  return (
    <main className="min-h-dvh bg-yeoni-bg px-4 pb-28 pt-6 text-[#242231] sm:px-6 sm:pt-10">
      <div className="mx-auto max-w-2xl">
        <header className="flex items-center justify-between gap-3">
          <Link href="/assistant" className="text-sm font-bold text-[#5146A6]">← 연이</Link>
          <span className="rounded-full bg-[#EEEDFE] px-3 py-1.5 text-xs font-bold text-[#5146A6]">iPhone 빠른 명령</span>
        </header>

        <section className="mt-5 rounded-[30px] bg-gradient-to-br from-[#5146A6] to-[#766DCE] p-6 text-white shadow-[0_22px_55px_rgba(81,70,166,0.22)] sm:p-8">
          <p className="text-sm font-semibold text-white/70">SIRI SHORTCUT</p>
          <h1 className="mt-2 text-3xl font-bold">연이에게 명령하기</h1>
          <p className="mt-3 text-sm leading-6 text-white/80">Siri 호출 화면을 닫은 뒤 명령을 전달합니다. 할 일 추가·수정, 가계부 금액 수정, 일본어 학습 완료는 내용을 확인한 뒤 저장해요.</p>
        </section>

        <section className="mt-5 rounded-[28px] bg-white p-5 shadow-sm sm:p-6">
          <label htmlFor="quick-command" className="text-sm font-bold">실행할 명령</label>
          <textarea id="quick-command" value={command} onChange={(event) => setCommand(event.target.value)} maxLength={500} rows={3} placeholder="예: 오늘 할 일에 거래처 전화 추가해줘" className="mt-2 w-full resize-none rounded-2xl border-0 bg-yeoni-bg px-4 py-3 text-base outline-none ring-1 ring-gray-100 focus:ring-[#7F77DD]" />
          <div className="mt-3 flex flex-wrap gap-2">
            {samples.map((sample) => <button key={sample} type="button" onClick={() => setCommand(sample)} className="rounded-full bg-[#F1EFFF] px-3 py-2 text-xs font-bold text-[#5146A6]">{sample}</button>)}
          </div>
          <div role="note" className="mt-4 rounded-2xl bg-[#F7F6FF] px-4 py-3 text-sm leading-6 text-[#5146A6]"><b>Zephyr 음성</b><p>답변의 ‘답변 읽기’를 누르면 음성을 준비해요. 자동으로 읽거나 생성하지 않아요.</p></div>
          <button type="button" onClick={() => void run()} disabled={sending || !command.trim() || !draftsReady} className="mt-4 w-full rounded-2xl bg-[#5146A6] px-5 py-3.5 text-sm font-bold text-white disabled:bg-gray-300">{sending ? "처리 중…" : shouldAutoRun && !result ? "자동 실행 준비 중…" : "명령 실행"}</button>
          {result && <div role="status" aria-live="polite" className={`mt-4 rounded-2xl p-4 text-sm leading-6 ${result.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-900"}`}><p>{result.error || result.reply}</p><div className="mt-3 flex flex-wrap gap-2">{result.action && <Link href={result.action.href} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-[#5146A6] ring-1 ring-[#D9D5F2]">{result.action.label} →</Link>}</div></div>}
          {result?.reply && !result.error && <ZephyrReadButton text={result.reply} />}
          {pending.error && <p role="alert" className="mt-3 text-red-700">{pending.error}</p>}
          {pending.drafts.map(draft => <AssistantCommandReview key={`${pending.ownerId}:${draft.proposal.requestId}`} proposal={draft.proposal} ownerId={pending.ownerId ?? undefined} initiallyAttempted={draft.attempted} onAttempt={() => pending.markAttempted(draft.proposal.requestId)} onSettled={() => pending.remove(draft.proposal.requestId)} />)}
          <Link href="/assistant/history" className="mt-4 inline-block text-sm font-bold text-violet-700">실행 이력 보기 →</Link>
        </section>

        <section className="mt-5 rounded-[28px] bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold">아이폰 단축어 설정</h2>
          <ol className="mt-3 space-y-3 text-sm leading-6 text-gray-600">
            <li><b className="text-[#242231]">1.</b> 맨 위에 ‘Siri 닫기 및 계속’ 동작을 추가합니다. 동작 검색에서 ‘Siri’를 검색하면 찾을 수 있습니다.</li>
            <li><b className="text-[#242231]">2.</b> 그 아래에 ‘텍스트 받아쓰기’를 추가합니다. 이 동작이 Siri 화면을 닫은 다음 실제 명령을 듣습니다.</li>
            <li><b className="text-[#242231]">3.</b> ‘URL 인코딩’을 추가하고 ‘받아쓰기한 텍스트’를 입력으로 지정합니다.</li>
            <li><b className="text-[#242231]">4.</b> ‘텍스트’ 동작에 <code className="break-all rounded bg-gray-100 px-1.5 py-1 text-xs">https://ai-fitness-app-ten.vercel.app/assistant/quick?autorun=1&amp;speak=1&amp;command=</code>를 입력한 뒤, 같은 줄 맨 끝에 ‘URL 인코딩된 텍스트’ 변수를 붙입니다.</li>
            <li><b className="text-[#242231]">5.</b> ‘URL 열기’에 바로 앞의 ‘텍스트’를 지정하고 단축어 이름을 ‘연이’로 저장합니다. “Siri야, 연이”라고 말하면 명령이 자동으로 전달됩니다. 할 일 추가·수정은 화면의 확인 버튼을 누른 뒤 저장됩니다. 기존 단축어 주소도 계속 사용할 수 있어요.</li>
          </ol>
          <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900"><b>문제 해결</b><br />단축어 실행 후 말한 명령을 Siri가 자기 질문으로 처리하면 맨 위에 ‘Siri 닫기 및 계속’이 빠진 것입니다. ‘유효하지 않은 URL: %EC…’가 나오면 ‘URL’ 동작 대신 위 4번처럼 ‘텍스트’ 동작으로 전체 주소를 한 줄에 만드세요.</div>
        </section>
      </div>
    </main>
  );
}

export default function QuickCommandPage() {
  return <Suspense fallback={<main className="grid min-h-dvh place-items-center bg-yeoni-bg text-sm text-gray-500">빠른 명령 준비 중…</main>}><QuickCommandContent /></Suspense>;
}
