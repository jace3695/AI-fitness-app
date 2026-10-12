"use client";
import AppCompanion from "@/components/AppCompanion";
import Link from "next/link";
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import AppIdentity from "@/app/components/AppIdentity";
import { supabase } from "@/app/lib/supabase";
import { useGrowthData } from "@/app/growth/useGrowthData";
import { handwritingMetrics } from "@/app/data/practiceEvidence";
import { useUnsavedChanges } from "@/components/useUnsavedChanges";
import { freeEvidence } from '@/lib/free-handwriting-draft';
import { useFreeHandwritingPractice } from './useFreeHandwritingPractice';

export default function GrowthHandwritingPage() {
  const [owner, setOwner] = useState<string | null>(null), [checked, setChecked] = useState(false);
  const activeOwner = useRef<string | null>(null);
  const isOwnerActive = useCallback((id: string) => activeOwner.current === id, []);
  useEffect(() => {
    if (!supabase) { setChecked(true); return; }
    let alive = true, generation = 0;
    const changeOwner = (id: string | null) => { if (!alive) return; generation++; activeOwner.current = id; setOwner(id); setChecked(true); };
    void supabase.auth.getUser().then(({ data }) => { if (!generation) changeOwner(data.user?.id ?? null); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { if (session?.user.id !== activeOwner.current || !generation) changeOwner(session?.user.id ?? null); });
    return () => { alive = false; activeOwner.current = null; data.subscription.unsubscribe(); };
  }, []);
  if (!owner) return <main className="min-h-dvh bg-yeoni-bg p-6"><p role="status">{checked ? '로그인 정보를 확인한 뒤 손글씨 연습을 열어 주세요.' : '연습 계정 확인 중…'}</p></main>;
  return <FreeWorkspace key={owner} owner={owner} isOwnerActive={isOwnerActive} />;
}
function FreeWorkspace({ owner, isOwnerActive }: { owner: string; isOwnerActive: (id: string) => boolean }) {
  const growth = useGrowthData(30), practice = useFreeHandwritingPractice(owner, isOwnerActive), router = useRouter();
  const { draft, canvasRef, saving, saved } = practice;
  const metrics = handwritingMetrics(freeEvidence(draft));
  const handwritingRoutine = growth.routines.find(routine => routine.user_id === owner && routine.category === 'handwriting') ?? null;
  const locked = !practice.ready || saving || saved || practice.storageError || practice.invalidated || !!draft.pending;
  const canSave = practice.ready && !saving && !saved && !practice.storageError && !practice.invalidated && metrics.strokes > 0 && (!!draft.pending || !!handwritingRoutine && growth.dataReady);
  useUnsavedChanges(practice.dirty);
  async function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); if (saving) return;
    const href = event.currentTarget.getAttribute('href'); if (!href) return;
    try { if (practice.ready && !saved && !practice.invalidated) await practice.flush(); router.push(href); } catch { /* Preserve the screen when checkpointing fails. */ }
  }
  return <main className="min-h-dvh bg-yeoni-bg pb-10 text-[#242231]">
    <header className="app-module-header"><div className="app-module-header-inner"><AppIdentity kind="growth" title="손글씨 연습" subtitle="iPad와 Apple Pencil로 간단하게" /><nav className="flex flex-wrap gap-2"><Link onClick={navigate} href="/growth/handwriting" className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600">단계별 수업</Link><Link onClick={navigate} href="/growth/handwriting/compare" className="min-h-11 rounded-xl bg-gray-100 px-3 py-3 text-xs font-bold text-gray-600">저장한 손글씨 비교</Link></nav></div></header>
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-9">
      <AppCompanion compact quiet>한 글자씩 천천히 써봐요. 끝나면 오늘의 손글씨를 남겨 주세요.</AppCompanion>
      <section className="rounded-[30px] bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold text-amber-600">따라 쓰기</p><h1 className="mt-1 text-2xl font-bold">{draft.guideText}</h1></div><button disabled={locked} onClick={practice.nextGuide} className="min-h-11 rounded-xl bg-amber-50 px-4 text-xs font-bold text-amber-700">다른 문장</button></div>
        <div className="mt-4 flex flex-wrap gap-2"><label className="flex min-h-11 items-center gap-2 rounded-xl bg-gray-100 px-3 text-xs font-bold">펜 색<input type="color" value={draft.inkColor} disabled={locked} onChange={(event) => practice.changeColor(event.target.value)} className="h-7 w-7" /></label><button onClick={() => practice.restore(draft.historyIndex - 1)} disabled={locked || draft.historyIndex <= 0} className="min-h-11 rounded-xl bg-gray-100 px-4 text-xs font-bold disabled:opacity-40">되돌리기</button><button onClick={() => practice.restore(draft.historyIndex + 1)} disabled={locked || draft.historyIndex >= draft.frames.length - 1} className="min-h-11 rounded-xl bg-gray-100 px-4 text-xs font-bold disabled:opacity-40">다시 실행</button><button disabled={saving || practice.storageError || (!practice.ready && !practice.invalidated) || (!!draft.pending && !saved)} onClick={() => void practice.clear()} className="min-h-11 rounded-xl bg-red-50 px-4 text-xs font-bold text-red-600">모두 지우기</button></div>
        <canvas ref={canvasRef} onPointerDown={practice.start} onPointerMove={practice.draw} onPointerUp={practice.stop} onPointerCancel={practice.stop} onLostPointerCapture={practice.stop} className="mt-4 w-full rounded-2xl bg-white shadow-inner ring-1 ring-gray-200" style={{ touchAction: "none", aspectRatio: "1.62 / 1" }} aria-label="손글씨 연습장" />
        <button disabled={!canSave} onClick={() => void practice.save(handwritingRoutine)} className="mt-4 min-h-12 w-full rounded-xl bg-amber-500 text-sm font-bold text-white disabled:bg-gray-300">{saved ? "저장 완료" : saving ? "비공개 저장 중…" : draft.pending ? "같은 기록 다시 확인" : "손글씨와 완료 기록 저장"}</button>
        <section aria-label="손글씨 측정 기록" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm">
          <h2 className="font-bold">직접 측정한 연습 기록</h2><p className="mt-2">획 {metrics.strokes}개 · 그린 시간 {metrics.activeSeconds}초</p>
          <p>사용한 범위: 가로 {metrics.occupiedWidth}% · 세로 {metrics.occupiedHeight}%</p>
          <p>{metrics.pressureRange ? `펜 압력 범위 ${metrics.pressureRange[0].toFixed(2)} ~ ${metrics.pressureRange[1].toFixed(2)}` : '변화가 있는 펜 압력 미측정'}</p>
          <p className="mt-2 text-xs text-gray-600">화면에 남은 획의 접촉 시간만 합칩니다. 되돌린 획은 제외하며, 글씨 품질이나 교정 점수를 판정하지 않습니다. 목표 시간은 실제 시간으로 기록하지 않습니다.</p>
        </section>
        {(practice.notice || growth.notice) && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{practice.notice || growth.notice}</p>}
        {practice.storageError && !practice.conflict && <button disabled={saving} className="mt-2 min-h-11 rounded-xl bg-gray-100 px-3" onClick={practice.retryCheckpoint}>기기 임시 저장 다시 시도</button>}
        {practice.loadError && <p className="mt-2 text-sm">연결 후 다시 저장하거나 이 화면을 다시 열어 주세요. 화면 이동 전 기기 임시 저장 상태를 확인해 주세요.</p>}
        {practice.invalidated && <button disabled={saving || practice.storageError} className="mt-2 min-h-11 rounded-xl bg-gray-100 px-3" onClick={() => void practice.clear()}>새 연습 시작</button>}
        <p className="mt-3 text-xs leading-5 text-gray-500">기기 복구는 임시 저장이 완료된 획과 최근 20개 화면까지만 가능해요. 최대 1200×744 연습장과 PNG를 합쳐 80MiB 이내로 보관해요. 브라우저 데이터 삭제나 갑작스러운 종료 직전의 획은 복구하지 못할 수 있어요.</p>
        <p className="mt-3 text-xs leading-5 text-gray-500">그림 기능은 포함하지 않았습니다. 이 화면은 손글씨 교정용 한 장 연습장만 제공합니다.</p>
      </section>
    </div>
  </main>;
}
