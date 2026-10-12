"use client";
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import AppIdentity from '@/app/components/AppIdentity';
import { supabase } from '@/app/lib/supabase';
import { useGrowthData } from '../useGrowthData';
import { useUnsavedChanges } from '@/components/useUnsavedChanges';
import { HANDWRITING_LESSONS, nextHandwritingLesson, type HandwritingLesson } from '@/app/data/handwritingCourse';
import { canonical } from '@/lib/handwriting-draft';
import { usePrivateMaterials } from './usePrivateMaterials';
import { useHandwritingPractice } from './useHandwritingPractice';

export default function HandwritingCoursePage() {
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
  return <HandwritingWorkspace key={owner} owner={owner} isOwnerActive={isOwnerActive} />;
}
function HandwritingWorkspace({ owner, isOwnerActive }: { owner: string; isOwnerActive: (id: string) => boolean }) {
  const growth = useGrowthData(), practice = useHandwritingPractice(owner, isOwnerActive), router = useRouter();
  const { draft, saving, saved, notice, completed, progressReady, progressError, sheetReady, sheetError, canvasRef, start, draw, stop, undo } = practice;
  const { lesson, mode, trace, checks, minutes, reflection, strokes, pending } = draft;
  const materials = usePrivateMaterials(owner, lesson.pdfPage, isOwnerActive), imagePath = materials.imageUrl;
  const routine = growth.routines.find(row => row.user_id === owner && row.category === 'handwriting') ?? null;
  const materialMatches = !draft.worksheet || !materials.worksheet || canonical(draft.worksheet) === canonical(materials.worksheet);
  const locked = !practice.ready || practice.storageError || practice.invalidated || saving || !!pending || materials.importing;
  useUnsavedChanges(practice.dirty || materials.importing);
  useEffect(() => practice.prepareSheet(imagePath, materials.worksheet), [imagePath, materials.worksheet, mode, trace, practice.sheetRetry, practice.ready, draft.attemptId]); // eslint-disable-line react-hooks/exhaustive-deps
  const paperMinutes = Number(minutes);
  const practiceReady = mode === 'paper' ? Number.isInteger(paperMinutes) && paperMinutes > 0 && paperMinutes <= 240 : sheetReady && strokes > 0;
  const canSave = practice.ready && !practice.storageError && !practice.invalidated && !saving && !saved && (!!pending || !!imagePath && !!draft.worksheet && materialMatches && !materials.importing && progressReady && growth.dataReady && !!routine && checks.every(Boolean) && practiceReady);
  const save = () => practice.save(routine);
  const resetAttempt = () => practice.reset();
  const selectLesson = (next: HandwritingLesson) => { void practice.reset({ lesson: next }); };
  async function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); if (saving || materials.importing) return;
    const href = event.currentTarget.getAttribute('href'); if (!href) return;
    try { if (practice.ready && !saved && !practice.invalidated) await practice.flush(); router.push(href); } catch { /* Keep the screen on failed checkpoint. */ }
  }
  return <main className="min-h-dvh bg-yeoni-bg pb-12 text-[#242231]">
    <header className="app-module-header"><div className="app-module-header-inner"><AppIdentity kind="growth" title="손글씨 연습" subtitle="필림 자료로 한 수업씩" /><Link onClick={navigate} href="/growth" className="rounded-xl bg-gray-100 px-3 py-3 text-xs font-bold">자기계발 홈</Link></div></header>
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <section className="rounded-3xl bg-white p-5 shadow-sm" aria-label="손글씨 학습 진도">
        <h1 className="text-2xl font-bold">천천히 익히는 내 손글씨</h1><p className="mt-2 text-sm leading-6 text-gray-600">12단계 · 53개 수업. 하루 10~15분을 목표로 한 수업씩 해봐요. 어려운 수업은 반복하고, 익숙한 수업은 직접 골라도 괜찮아요.</p>
        <p className="mt-3 font-bold text-amber-800">{progressReady ? `${completed.size} / 53 수업 완료` : progressError || '저장한 진도를 불러오는 중…'}</p>
        {progressError && <button className="mt-2 min-h-11 rounded-xl bg-gray-100 px-4" onClick={() => practice.retryProgress()}>진도 다시 불러오기</button>}
        {progressReady && <progress className="mt-3 w-full accent-amber-600" value={completed.size} max={53} aria-label="수업 완료 진도" />}
        {completed.size === 53 && <p className="mt-3 text-sm">전 과정을 연습했어요! 어려웠던 수업을 골라 복습하거나 내 문장으로 자유롭게 써보세요.</p>}
        <details className="mt-4"><summary className="min-h-11 cursor-pointer py-3 font-bold">전체 수업 보기</summary><div className="grid gap-2 sm:grid-cols-2">{HANDWRITING_LESSONS.map(row => <button key={row.id} disabled={!progressReady || locked} aria-current={row.id === lesson.id ? 'step' : undefined} onClick={() => selectLesson(row)} className={`min-h-12 rounded-xl p-3 text-left text-sm disabled:opacity-40 ${row.id === lesson.id ? 'bg-amber-100 ring-2 ring-amber-500' : 'bg-gray-50'}`}><span className="block text-xs text-gray-500">{row.stage}</span>{row.number}강 · {row.title}{completed.has(row.id) ? ' ✓ 완료' : ''}</button>)}</div></details>
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-bold text-amber-800"><button disabled={!owner || materials.opening || materials.importing} onClick={() => void materials.downloadPdf()} className="min-h-11 underline disabled:opacity-40">{materials.opening ? '원본 준비 중…' : '내 원본 PDF 내려받기'}</button><Link onClick={navigate} href="/growth/handwriting/free" className="py-3 underline">자유 문장 연습</Link><Link onClick={navigate} href="/growth/resources" className="py-3 underline">저장한 연습 보기</Link><Link onClick={navigate} href="/growth/handwriting/compare" className="py-3 underline">저장한 손글씨 비교</Link></div>
      </section>
      <section aria-label="비공개 손글씨 교재" className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="font-bold">내 계정 전용 교재</h2><p className="mt-2 text-sm text-gray-600">교재 원본과 연습지는 로그인한 본인만 열 수 있어요. GitHub나 공개 파일 주소에는 교재를 올리지 않아요.</p>
        {materials.loading && <p role="status" className="mt-3 text-sm">비공개 연습지를 불러오는 중…</p>}
        {materials.error && <p role="alert" className="mt-3 text-sm">{materials.error} <button className="min-h-11 underline" onClick={materials.retry}>교재 다시 불러오기</button></p>}
        <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 font-bold">처음 한 번 교재 등록</summary><p className="mb-3 text-sm">제공받은 교재 묶음(JSON)을 선택하세요. 원본 PDF와 53개 연습지가 본인 계정에만 저장돼요. 등록 중에는 화면을 닫지 마세요.</p><label className="block text-sm">교재 묶음 파일<input type="file" accept=".json,application/json" disabled={!owner || materials.importing || saving || !!pending} onChange={event => { const file = event.target.files?.[0]; if (file) void materials.importPackage(file); event.target.value = ''; }} className="mt-2 block w-full min-w-0 text-sm" /></label></details>
        {materials.importStatus && <p role="status" className="mt-3 text-sm">{materials.importStatus}</p>}
      </section>
      <section className="rounded-3xl bg-white p-5 shadow-sm" aria-label="오늘의 손글씨 수업">
        <p className="text-sm font-bold text-amber-700">{lesson.stage}</p><h2 className="mt-2 text-xl font-bold">{lesson.number}강 · {lesson.title}</h2><p className="mt-2">{lesson.goal}</p><p className="mt-2 text-xs text-gray-500">PDF {lesson.pdfPage}쪽 · 유인물 {lesson.pdfPage - 1}쪽</p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6">{lesson.steps.map(step => <li key={step}>{step}</li>)}</ol>
        <p className="mt-3 text-xs leading-5 text-gray-500">필림의 원본 연습 자료를 기준으로 연이가 연습 순서와 점검 항목을 덧붙였어요. 원래 강의 영상의 설명을 대체하지는 않아요.</p>
        <fieldset disabled={locked} className="mt-5 flex flex-wrap gap-2"><legend className="mb-2 text-sm font-bold">연습 방법</legend>{(['paper','screen'] as const).map(value => <button key={value} aria-pressed={mode === value} className={`min-h-11 rounded-xl px-4 text-sm font-bold ${mode === value ? 'bg-amber-600 text-white' : 'bg-gray-100'}`} onClick={() => { if (mode !== value) void practice.reset({ mode: value }); }}>{value === 'paper' ? '종이·다른 앱에서 연습' : '이 화면에 직접 쓰기'}</button>)}</fieldset>
        <details open={mode === 'paper'} className="mt-4"><summary className="cursor-pointer py-3 font-bold">원본 예시 살펴보기</summary>{imagePath && materialMatches && <a href={imagePath} target="_blank" rel="noopener noreferrer" className="block"><Image key={imagePath} src={imagePath} alt={`필림 유인물 ${lesson.pdfPage - 1}쪽: ${lesson.title}`} width={1000} height={1415} unoptimized className="h-auto w-full rounded-xl border" /><span className="block py-3 text-xs text-amber-800 underline">새 창에서 크게 보기</span></a>}</details>
        {mode === 'screen' && <div className="mt-4"><div className="flex flex-wrap gap-2"><button disabled={locked} aria-pressed={trace} className="min-h-11 rounded-xl bg-gray-100 px-3 text-sm" onClick={() => void practice.reset({ trace: !trace })}>{trace ? '원본 위에 따라 쓰기 · 빈 연습장으로 전환' : '빈 연습장에 직접 쓰기 · 원본으로 전환'}</button><button onClick={undo} disabled={locked || saved || !strokes} className="min-h-11 rounded-xl bg-gray-100 px-4 disabled:opacity-40">되돌리기</button><button disabled={locked} onClick={() => void resetAttempt()} className="min-h-11 rounded-xl bg-gray-100 px-4">다시 연습</button></div>
          <p className="my-3 text-xs leading-5 text-gray-600">펜·손가락·마우스로 쓸 수 있어요. 작은 휴대폰에서는 종이 연습이 편해요. 화면 이동은 연습장 바깥에서 해주세요.</p>
          {sheetError ? <p role="alert">연습지를 불러오지 못했어요. <button className="min-h-11 underline" onClick={() => practice.retrySheet()}>연습지 다시 불러오기</button></p> : !sheetReady && <p role="status">연습지 준비 중…</p>}
          <canvas ref={canvasRef} aria-label="수업 손글씨 연습장" onPointerDown={start} onPointerMove={draw} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} className="w-full rounded-xl border bg-white" style={{ touchAction: 'none', aspectRatio: '1 / 1.415' }} />
          <p className="mt-2 text-xs text-gray-500">직접 쓴 획 {strokes}개 · 펜이 움직인 시간 {Math.round(draft.activeMs / 1000)}초. 글씨 품질을 자동 채점하지 않아요.</p>
        </div>}
        <fieldset disabled={locked || saved || !progressReady} className="mt-5 space-y-3"><legend className="mb-2 font-bold">연습 후 스스로 확인해요</legend>{lesson.checks.map((check, index) => <label key={check} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={checks[index]} onChange={event => practice.change({ checks: checks.map((value, i) => i === index ? event.target.checked : value) })} className="h-5 w-5 shrink-0 accent-amber-600" />{check}</label>)}
          {mode === 'paper' && <label className="block text-sm">실제로 연습한 시간 (분)<input type="number" inputMode="numeric" min={1} max={240} step={1} value={minutes} onChange={event => practice.change({ minutes: event.target.value })} className="mt-2 block min-h-12 w-full rounded-xl border p-3 text-base" /><span className="mt-1 block text-xs text-gray-500">종이·다른 앱 연습 시간은 직접 입력한 값으로 저장해요.</span></label>}
          <label className="block text-sm">다음에 신경 쓸 점 (선택)<textarea value={reflection} maxLength={200} onChange={event => practice.change({ reflection: event.target.value })} placeholder="예: 글자 사이를 조금 더 띄우기" className="mt-2 block w-full rounded-xl border p-3 text-base" /></label>
        </fieldset>
        {!routine && growth.dataReady && <p role="alert" className="mt-3 text-sm">손글씨 루틴이 없어요. 자기계발 홈에서 손글씨 루틴을 추가한 뒤 저장해 주세요.</p>}
        <button disabled={!canSave} onClick={() => void save()} className="mt-5 min-h-12 w-full rounded-xl bg-amber-600 px-4 font-bold text-white disabled:bg-gray-300">{saving ? '수업 저장 중…' : saved ? '수업 저장 완료' : pending ? '같은 기록 다시 확인' : '이 수업 완료하고 저장'}</button>
        {(notice || growth.notice) && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">{notice || growth.notice}</p>}
        {!practice.ready && !practice.loadError && <p role="status" className="mt-3 text-sm">작성하던 연습 확인 중…</p>}
        {practice.loadError && <button onClick={practice.retryLoad} className="mt-2 min-h-11 rounded-xl bg-gray-100 px-3">복구 다시 불러오기</button>}
        {practice.storageError && !practice.conflict && <button disabled={saving} onClick={practice.retryCheckpoint} className="mt-2 min-h-11 rounded-xl bg-gray-100 px-3">기기 임시 저장 다시 시도</button>}
        {practice.invalidated && <button onClick={() => void practice.reset()} className="mt-2 min-h-11 rounded-xl bg-gray-100 px-3">새 연습 시작</button>}
        {!materialMatches && <p role="alert" className="mt-3 text-sm">복구한 연습과 현재 교재가 달라요. 복구한 화면은 유지했어요. 새 연습으로 바꾸기 전에 내용을 확인해 주세요.</p>}
        <p className="mt-3 text-xs text-gray-500">기기 복구는 완료된 임시 저장까지만 가능해요. 갑작스러운 종료, 브라우저 데이터 삭제·저장 공간 정리 뒤의 복구는 보장할 수 없어요.</p>
        {saved && <div className="mt-4 flex flex-wrap gap-2"><button className="min-h-12 rounded-xl bg-amber-100 px-4 font-bold" onClick={() => selectLesson(nextHandwritingLesson(completed))}>{completed.size === 53 ? '처음부터 복습하기' : '다음 미완료 수업'}</button><button className="min-h-12 rounded-xl bg-gray-100 px-4" onClick={() => void resetAttempt()}>같은 수업 다시 연습</button></div>}
      </section>
    </div>
  </main>;
}
