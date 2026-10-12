"use client";

import AppCompanion from "@/components/AppCompanion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppIdentity from "../../components/AppIdentity";
import { calculateTypingMetrics } from "../../data/growthPlatform";
import { getLocalDateKey } from "@/utils/dateKey";
import { useGrowthData } from "../useGrowthData";
import { typingMistakes, typingTrend } from "../../data/practiceEvidence";
import { useUnsavedChanges } from "@/components/useUnsavedChanges";
import { supabase } from "@/app/lib/supabase";
import { TYPING_PASSAGES } from "@/lib/sentence-typing-draft";
import { useSentenceTypingPractice } from "./useSentenceTypingPractice";

export default function GrowthTypingPage() {
  const [owner, setOwner] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const activeOwner = useRef<string | null>(null);
  const isOwnerActive = useCallback((id: string) => activeOwner.current === id, []);
  useEffect(() => {
    if (!supabase) { setChecked(true); return; }
    let alive = true; let generation = 0;
    const changeOwner = (id: string | null) => {
      if (!alive) return;
      generation++; activeOwner.current = id; setOwner(id); setChecked(true);
    };
    void supabase.auth.getUser().then(({ data }) => { if (generation === 0) changeOwner(data.user?.id ?? null); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== activeOwner.current || !generation) changeOwner(session?.user.id ?? null);
    });
    return () => { alive = false; activeOwner.current = null; data.subscription.unsubscribe(); };
  }, []);
  if (!owner) return <main className="min-h-dvh bg-yeoni-bg p-6"><p role="status">{checked ? "로그인 정보를 확인한 뒤 문장 연습을 열어 주세요." : "연습 계정 확인 중…"}</p></main>;
  return <SentenceTypingPractice key={owner} owner={owner} isOwnerActive={isOwnerActive} />;
}

function SentenceTypingPractice({ owner, isOwnerActive }: { owner: string; isOwnerActive: (id: string) => boolean }) {
  const growth = useGrowthData(30);
  const practice = useSentenceTypingPractice(owner, isOwnerActive);
  const { passageIndex, passage, typed, startedAt, pending } = practice.draft;
  const { saving, saved } = practice;
  const locked = !practice.ready || practice.storageError || saving || saved || !!pending;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const elapsedSeconds = startedAt ? Math.max(1, Math.round(((pending ? Date.parse(pending.endedAt) : Date.now()) - startedAt) / 1000)) : 1;
  const metrics = useMemo(() => calculateTypingMetrics(passage, typed, elapsedSeconds), [elapsedSeconds, passage, typed]);
  const typingRoutine = growth.routines.find((routine) => routine.user_id === owner && routine.category === "typing" && (!pending || routine.id === pending.routineId)) ?? null;
  const finished = typed.length >= passage.length;
  const mistakes = typingMistakes(passage, typed);
  const sessions = growth.sessions.filter(row => row.user_id === owner && row.id !== practice.confirmedRow?.id);
  const trend = typingTrend(practice.confirmedRow ? [practice.confirmedRow, ...sessions] : sessions, passageIndex, getLocalDateKey());
  useUnsavedChanges(Boolean(typed) && !saved);
  const reset = (nextPassage = passageIndex) => { if (practice.reset(nextPassage)) textarea.current?.focus(); };
  const resetDisabled = !practice.ready || practice.storageError || saving || (!!pending && !saved);
  const saveDisabled = !practice.ready || practice.storageError || saving || saved || !typed || (!pending && (!typingRoutine || !growth.dataReady));

  return <main className="min-h-dvh bg-yeoni-bg pb-10 text-[#242231]">
    <header className="app-module-header"><div className="app-module-header-inner"><AppIdentity kind="growth" title="타자 연습" subtitle="정확하게 입력하고 기록 저장" /><Link href="/growth" className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600">자기계발 홈</Link></div></header>
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-9">
      <Link href="/growth/typing/basics" className="mb-5 block rounded-3xl bg-indigo-50 p-5 text-indigo-950"><strong className="block text-lg">손가락 자리부터 다시 배우기 →</strong><span className="mt-2 block text-sm">F·J 기본 자리부터 14단계로 · 누를 키와 담당 손가락 안내 · 가볍고 정확하게</span></Link>
      <AppCompanion compact quiet>속도보다 정확하게! 편한 자세로 한 문장씩 입력해봐요.</AppCompanion>
      <section className="rounded-[30px] bg-white p-5 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold text-blue-600">연습 문장 {passageIndex + 1}/{TYPING_PASSAGES.length}</p><h1 className="mt-1 text-2xl font-bold">보고 그대로 입력하세요</h1></div><button type="button" disabled={resetDisabled} onClick={() => reset((passageIndex + 1) % TYPING_PASSAGES.length)} className="min-h-11 rounded-xl bg-blue-50 px-4 text-xs font-bold text-blue-700 disabled:opacity-50">다른 문장</button></div>
        <p className="mt-6 rounded-2xl bg-blue-50 p-5 text-lg font-semibold leading-8 text-blue-950">{Array.from(passage).map((character, index) => <span key={`${character}-${index}`} className={index >= typed.length ? "" : typed[index] === character ? "text-emerald-600" : "rounded bg-red-100 text-red-600"}>{character}</span>)}</p>
        <label htmlFor="sentence-typing-input" className="mt-5 block text-sm font-bold text-gray-700">입력 칸</label>
        <textarea id="sentence-typing-input" ref={textarea} autoFocus readOnly={locked} value={typed} onChange={(event) => practice.changeInput(event.target.value)} spellCheck={false} className="mt-2 min-h-36 w-full rounded-2xl border-0 bg-gray-50 p-5 text-lg font-bold leading-8 text-gray-700 outline-none ring-1 ring-gray-200 focus:ring-blue-500" placeholder="여기를 누르고 입력을 시작하세요" />
        <div className="mt-5 grid grid-cols-3 gap-3 text-center"><article className="rounded-2xl bg-gray-50 p-4"><span className="text-xs text-gray-500">정확도</span><strong className="mt-1 block text-2xl">{metrics.accuracy}%</strong></article><article className="rounded-2xl bg-gray-50 p-4"><span className="text-xs text-gray-500">분당 타수</span><strong className="mt-1 block text-2xl">{metrics.charactersPerMinute}</strong></article><article className="rounded-2xl bg-gray-50 p-4"><span className="text-xs text-gray-500">입력 글자</span><strong className="mt-1 block text-2xl">{metrics.characters}</strong></article></div>
        <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" disabled={resetDisabled} onClick={() => reset()} className="min-h-12 rounded-xl bg-gray-100 text-sm font-bold text-gray-700">다시 시작</button><button type="button" disabled={saveDisabled} onClick={() => void practice.save(typingRoutine)} className="min-h-12 rounded-xl bg-blue-600 text-sm font-bold text-white disabled:bg-gray-300">{saved ? "저장 완료" : saving ? "저장 결과 확인 중…" : pending ? "같은 기록 다시 확인" : finished ? "완료 기록 저장" : "진행 기록 저장"}</button></div>
        <section aria-label="타자 오류와 변화" className="mt-5 rounded-2xl bg-blue-50 p-4 text-sm">
          <h2 className="font-bold">오류와 같은 문장 변화</h2>
          <p className="mt-2">현재 입력에서 다른 글자: {mistakes.length ? mistakes.map(item => `${item.character === " " ? "공백" : item.character} ${item.count}회`).join(" · ") : "없음"}</p>
          <p className="mt-1 text-xs text-gray-600">최종 입력과 문장을 비교합니다. 고친 오타·입력하지 않은 글자·키를 누른 횟수는 포함하지 않습니다.</p>
          {([['최근 14일', trend.recent], ['그전 14일', trend.previous]] as const).map(([label, value]) => <p key={label} className="mt-2">{label}: {value.count ? `${value.count}회 · 정확도 ${value.accuracy}% · 분당 ${value.cpm}타` : '측정 기록 없음'}</p>)}
          <p className="mt-2 text-xs text-gray-600">이 문장의 기록만 비교하며 오늘을 포함합니다. 첫 입력부터 저장까지의 경과 시간을 사용하므로 휴식 시간도 포함됩니다.</p>
        </section>
        {!practice.ready && !practice.loadError && !practice.notice && <p role="status" className="mt-4 text-sm">작성하던 연습 확인 중…</p>}
        {practice.notice && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{practice.notice}</p>}
        {practice.loadError && <button type="button" onClick={practice.retryLoad} className="mt-2 min-h-11 rounded-xl bg-gray-100 px-3 text-sm">복구 다시 불러오기</button>}
        {practice.storageError && <button type="button" disabled={saving} onClick={practice.retryCheckpoint} className="mt-2 min-h-11 rounded-xl bg-gray-100 px-3 text-sm">기기 임시 저장 다시 시도</button>}
        {growth.notice && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{growth.notice}</p>}
        {!growth.loading && !typingRoutine && <p className="mt-4 text-sm text-red-600">타자 루틴이 없습니다. 자기계발 홈에서 타자 루틴을 추가해 주세요.</p>}
      </section>
    </div>
  </main>;
}
