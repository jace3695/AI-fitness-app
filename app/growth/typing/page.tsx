"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AppIdentity from "../../components/AppIdentity";
import { calculateTypingMetrics } from "../../data/growthPlatform";
import { getLocalDateKey } from "@/utils/dateKey";
import { useGrowthData } from "../useGrowthData";

const PASSAGES = [
  "천천히 정확하게 입력하면 속도는 자연스럽게 따라옵니다.",
  "작은 기록을 매일 이어가면 분명한 성장으로 돌아옵니다.",
  "오늘 할 수 있는 만큼 시작하고 끝난 뒤 한 줄을 남깁니다.",
];

export default function GrowthTypingPage() {
  const growth = useGrowthData(30);
  const [passageIndex, setPassageIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const passage = PASSAGES[passageIndex];
  const elapsedSeconds = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 1000)) : 1;
  const metrics = useMemo(() => calculateTypingMetrics(passage, typed, elapsedSeconds), [elapsedSeconds, passage, typed]);
  const typingRoutine = growth.routines.find((routine) => routine.category === "typing") ?? null;
  const finished = typed.length >= passage.length;

  const reset = (nextPassage = passageIndex) => {
    setPassageIndex(nextPassage);
    setTyped("");
    setStartedAt(null);
    growth.setNotice("");
  };

  const save = async () => {
    if (!typingRoutine || !typed || saving) return;
    setSaving(true);
    const durationSeconds = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 1000)) : 1;
    const finalMetrics = calculateTypingMetrics(passage, typed, durationSeconds);
    const result = await growth.saveSession({
      routineId: typingRoutine.id,
      sessionDate: getLocalDateKey(),
      status: finished ? "completed" : "partial",
      plannedMinutes: typingRoutine.target_minutes,
      actualMinutes: Math.max(1, Math.round(durationSeconds / 60)),
      source: "typing",
      memo: "타자 연습",
      metrics: {
        passageIndex,
        characters: finalMetrics.characters,
        correctCharacters: finalMetrics.correctCharacters,
        accuracy: finalMetrics.accuracy,
        charactersPerMinute: finalMetrics.charactersPerMinute,
        elapsedSeconds: durationSeconds,
      },
      startedAt: startedAt ? new Date(startedAt).toISOString() : null,
      endedAt: new Date().toISOString(),
    });
    setSaving(false);
    growth.setNotice(result.error ? "타자 기록을 저장하지 못했어요." : "속도와 정확도를 클라우드에 저장했어요.");
  };

  return <main className="min-h-dvh bg-[#F5F4FA] pb-10 text-[#242231]">
    <header className="app-module-header"><div className="app-module-header-inner"><AppIdentity kind="growth" title="타자 연습" subtitle="정확하게 입력하고 기록 저장" /><Link href="/growth" className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600">자기계발 홈</Link></div></header>
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-9">
      <section className="rounded-[30px] bg-white p-5 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold text-blue-600">연습 문장 {passageIndex + 1}/{PASSAGES.length}</p><h1 className="mt-1 text-2xl font-bold">보고 그대로 입력하세요</h1></div><button type="button" onClick={() => reset((passageIndex + 1) % PASSAGES.length)} className="min-h-11 rounded-xl bg-blue-50 px-4 text-xs font-bold text-blue-700">다른 문장</button></div>
        <p className="mt-6 rounded-2xl bg-blue-50 p-5 text-lg font-semibold leading-8 text-blue-950">{Array.from(passage).map((character, index) => <span key={`${character}-${index}`} className={index >= typed.length ? "" : typed[index] === character ? "text-emerald-600" : "rounded bg-red-100 text-red-600"}>{character}</span>)}</p>
        <label className="mt-5 block text-sm font-bold text-gray-700">입력 칸<textarea autoFocus value={typed} onChange={(event) => { if (!startedAt && event.target.value) setStartedAt(Date.now()); setTyped(event.target.value.slice(0, passage.length)); }} spellCheck={false} className="mt-2 min-h-36 w-full rounded-2xl border-0 bg-gray-50 p-5 text-lg leading-8 outline-none ring-1 ring-gray-200 focus:ring-blue-500" placeholder="여기를 누르고 입력을 시작하세요" /></label>
        <div className="mt-5 grid grid-cols-3 gap-3 text-center"><article className="rounded-2xl bg-gray-50 p-4"><span className="text-xs text-gray-500">정확도</span><strong className="mt-1 block text-2xl">{metrics.accuracy}%</strong></article><article className="rounded-2xl bg-gray-50 p-4"><span className="text-xs text-gray-500">분당 타수</span><strong className="mt-1 block text-2xl">{metrics.charactersPerMinute}</strong></article><article className="rounded-2xl bg-gray-50 p-4"><span className="text-xs text-gray-500">입력 글자</span><strong className="mt-1 block text-2xl">{metrics.characters}</strong></article></div>
        <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={() => reset()} className="min-h-12 rounded-xl bg-gray-100 text-sm font-bold text-gray-700">다시 시작</button><button type="button" disabled={saving || !typed || !typingRoutine} onClick={() => void save()} className="min-h-12 rounded-xl bg-blue-600 text-sm font-bold text-white disabled:bg-gray-300">{finished ? "완료 기록 저장" : "진행 기록 저장"}</button></div>
        {growth.notice && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{growth.notice}</p>}
        {!growth.loading && !typingRoutine && <p className="mt-4 text-sm text-red-600">타자 루틴이 없습니다. 자기계발 홈에서 타자 루틴을 추가해 주세요.</p>}
      </section>
    </div>
  </main>;
}
