"use client";

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import AppIdentity from '@/app/components/AppIdentity';
import { supabase } from '@/app/lib/supabase';
import { useGrowthData } from '../useGrowthData';
import { useUnsavedChanges } from '@/components/useUnsavedChanges';
import { getLocalDateKey } from '@/utils/dateKey';
import { HANDWRITING_COURSE_ID, HANDWRITING_LESSONS, completedHandwritingLessons, nextHandwritingLesson, type HandwritingLesson } from '@/app/data/handwritingCourse';

import { usePrivateMaterials } from './usePrivateMaterials';

export default function HandwritingCoursePage() {
  const growth = useGrowthData();
  const [lesson, setLesson] = useState(HANDWRITING_LESSONS[0]);
  const [completed, setCompleted] = useState(new Set<string>());
  const [progressReady, setProgressReady] = useState(false);
  const [progressError, setProgressError] = useState('');
  const [reload, setReload] = useState(0);
  const [mode, setMode] = useState<'paper' | 'screen'>('paper');
  const [trace, setTrace] = useState(true);
  const [checks, setChecks] = useState<boolean[]>([false, false]);
  const [minutes, setMinutes] = useState('');
  const [reflection, setReflection] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState('');
  const [sheetReady, setSheetReady] = useState(false);
  const [sheetError, setSheetError] = useState(false);
  const [sheetRetry, setSheetRetry] = useState(0);
  const [strokes, setStrokes] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const evidence = useRef({ strokes: 0, activeMs: 0 });
  const drawing = useRef<{ x: number; y: number; started: number; moved: boolean } | null>(null);
  const history = useRef<{ image: ImageData; strokes: number; activeMs: number }[]>([]);
  const pending = useRef<{ owner: string; id: string; resourceId?: string; path?: string; blob?: Blob; uploaded: boolean; resourceSaved: boolean; session: Parameters<typeof growth.saveSession>[0] } | null>(null);
  const routine = growth.routines.find(row => row.category === 'handwriting');
  const owner = growth.user?.id;
  const dirty = !saved && (strokes > 0 || checks.some(Boolean) || !!minutes || !!reflection || !!pending.current);
  const materials = usePrivateMaterials(owner, lesson.pdfPage);
  const imagePath = materials.imageUrl;
  useUnsavedChanges(dirty || materials.importing);

  useEffect(() => {
    if (!owner || !supabase) return;
    const client = supabase;
    let cancelled = false;
    setProgressReady(false); setProgressError(''); setCompleted(new Set());
    void (async () => {
      const rows: Parameters<typeof completedHandwritingLessons>[0] = [];
      try {
        for (let offset = 0; ; offset += 500) {
          const result = await client.from('growth_sessions').select('status,source,metrics').eq('user_id', owner).eq('source', 'handwriting').contains('metrics', { courseId: HANDWRITING_COURSE_ID }).order('id').range(offset, offset + 499).abortSignal(AbortSignal.timeout(15000));
          if (result.error) throw result.error;
          rows.push(...(result.data ?? []));
          if ((result.data?.length ?? 0) < 500) break;
        }
        if (cancelled) return;
        const done = completedHandwritingLessons(rows);
        setCompleted(done); setLesson(nextHandwritingLesson(done)); setProgressReady(true);
      } catch { if (!cancelled) setProgressError('수업 진도를 불러오지 못했어요. 다시 불러온 뒤 이어서 연습해 주세요.'); }
    })();
    return () => { cancelled = true; };
  }, [owner, reload]);

  useEffect(() => {
    if (mode !== 'screen' || !imagePath) { setSheetReady(false); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    setSheetReady(false); setSheetError(false);
    const image = new window.Image();
    image.onload = () => {
      if (cancelled) return;
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) { setSheetError(true); return; }
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      if (trace) context.drawImage(image, 0, 0);
      else { context.strokeStyle = '#e5e7eb'; context.lineWidth = 1; for (let y = 90; y < canvas.height; y += 90) { context.beginPath(); context.moveTo(25, y); context.lineTo(canvas.width - 25, y); context.stroke(); } }
      evidence.current = { strokes: 0, activeMs: 0 }; history.current = []; drawing.current = null; setStrokes(0); setSheetReady(true);
    };
    image.onerror = () => { if (!cancelled) setSheetError(true); };
    image.src = imagePath;
    return () => { cancelled = true; };
  }, [imagePath, mode, trace, sheetRetry]);

  function resetAttempt() { setChecks([false, false]); setMinutes(''); setReflection(''); setSaved(false); setNotice(''); pending.current = null; evidence.current = { strokes: 0, activeMs: 0 }; history.current = []; drawing.current = null; setStrokes(0); setSheetRetry(value => value + 1); }
  function canLeave() { return !saving && !materials.importing && !pending.current && (!dirty || window.confirm('저장하지 않은 이번 연습을 비우고 이동할까요?')); }
  function selectLesson(next: HandwritingLesson) { if (!canLeave()) return; resetAttempt(); setLesson(next); }
  function point(event: PointerEvent<HTMLCanvasElement>) { const rect = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - rect.left) * event.currentTarget.width / rect.width, y: (event.clientY - rect.top) * event.currentTarget.height / rect.height }; }
  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (!sheetReady || saved || saving || pending.current || drawing.current) return;
    const ctx = event.currentTarget.getContext('2d'); if (!ctx) return;
    history.current.push({ image: ctx.getImageData(0, 0, event.currentTarget.width, event.currentTarget.height), ...evidence.current });
    history.current = history.current.slice(-5);
    drawing.current = { ...point(event), started: performance.now(), moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function draw(event: PointerEvent<HTMLCanvasElement>) {
    const previous = drawing.current; if (!previous) return;
    const next = point(event); const ctx = event.currentTarget.getContext('2d'); if (!ctx) return;
    ctx.strokeStyle = '#183a68'; ctx.lineWidth = 2 + (event.pressure || .5) * 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(next.x, next.y); ctx.stroke();
    drawing.current = { ...next, started: previous.started, moved: true };
  }
  function stop() {
    const current = drawing.current; drawing.current = null; if (!current) return;
    if (!current.moved) { history.current.pop(); return; }
    evidence.current = { strokes: evidence.current.strokes + 1, activeMs: evidence.current.activeMs + Math.max(0, performance.now() - current.started) }; setStrokes(evidence.current.strokes);
  }
  function undo() {
    if (saved || saving || pending.current) return;
    const last = history.current.pop(); const ctx = canvasRef.current?.getContext('2d'); if (!last || !ctx) return;
    ctx.putImageData(last.image, 0, 0); evidence.current = { strokes: last.strokes, activeMs: last.activeMs }; setStrokes(last.strokes);
  }
  const paperMinutes = Number(minutes);
  const practiceReady = mode === 'paper' ? Number.isInteger(paperMinutes) && paperMinutes > 0 && paperMinutes <= 240 : sheetReady && strokes > 0;
  const canSave = !!imagePath && !materials.importing && progressReady && growth.dataReady && !!routine && checks.every(Boolean) && practiceReady && !saving && !saved;

  async function save() {
    if (!canSave || !supabase || !owner || !routine) return;
    setSaving(true); setNotice('');
    try {
      if (!pending.current) {
        const id = crypto.randomUUID(); const resourceId = mode === 'screen' ? crypto.randomUUID() : undefined;
        const blob = mode === 'screen' ? await new Promise<Blob | null>(resolve => canvasRef.current?.toBlob(resolve, 'image/png')) : undefined;
        if (mode === 'screen' && !blob) throw Error('image');
        const activeSeconds = Math.round(evidence.current.activeMs / 1000);
        pending.current = { owner, id, resourceId, path: resourceId ? `${owner}/${getLocalDateKey()}/handwriting-${resourceId}.png` : undefined, blob: blob ?? undefined, uploaded: false, resourceSaved: false, session: { id, routineId: routine.id, sessionDate: getLocalDateKey(), status: 'completed', plannedMinutes: 15, actualMinutes: mode === 'paper' ? paperMinutes : Math.round(activeSeconds / 60), memo: `${lesson.number}강 ${lesson.title}${reflection.trim() ? ` · ${reflection.trim()}` : ''}`, source: 'handwriting', metrics: { courseId: HANDWRITING_COURSE_ID, lessonId: lesson.id, lessonCompleted: true, pdfPage: lesson.pdfPage, mode, practiceMode: mode === 'screen' ? (trace ? 'trace' : 'copy') : 'paper', selfChecks: checks, ...(resourceId ? { resourceId, strokes: evidence.current.strokes, activeSeconds } : { timeSource: 'self-reported' }) } } };
      }
      const job = pending.current; if (job.owner !== owner) throw Error('owner');
      if (job.blob && job.path && !job.uploaded) {
        const upload = await supabase.storage.from('growth-resources').upload(job.path, job.blob, { contentType: 'image/png', upsert: false });
        if (upload.error) { const existing = await supabase.storage.from('growth-resources').download(job.path); if (existing.error || existing.data.size !== job.blob.size) throw Error('upload'); }
        job.uploaded = true;
      }
      if (job.blob && job.path && !job.resourceSaved) {
        const result = await supabase.from('growth_resources').insert({ id: job.resourceId, user_id: owner, routine_id: routine.id, title: `필림 손글씨 ${lesson.number}강 ${lesson.title}`, category: 'handwriting', storage_path: job.path, mime_type: 'image/png', size_bytes: job.blob.size, classification: 'direct', notes: job.session.memo });
        if (result.error) { const existing = await supabase.from('growth_resources').select('id').eq('id', job.resourceId!).eq('user_id', owner).eq('storage_path', job.path).maybeSingle(); if (existing.error || !existing.data) throw Error('resource'); }
        job.resourceSaved = true;
      }
      const result = await growth.saveSession(job.session); if (result.error) throw result.error;
      setCompleted(current => new Set([...current, lesson.id])); setSaved(true); pending.current = null;
      setNotice('이번 수업과 연습 기록을 저장했어요. 다음 수업으로 가거나 같은 수업을 다시 연습할 수 있어요.');
    } catch { setNotice('저장을 확인하지 못했어요. 입력은 유지했으니 같은 기록 다시 확인을 눌러 주세요.'); }
    finally { setSaving(false); }
  }

  return <main className="min-h-dvh bg-yeoni-bg pb-12 text-[#242231]">
    <header className="app-module-header"><div className="app-module-header-inner"><AppIdentity kind="growth" title="손글씨 연습" subtitle="필림 자료로 한 수업씩" /><Link href="/growth" className="rounded-xl bg-gray-100 px-3 py-3 text-xs font-bold">자기계발 홈</Link></div></header>
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <section className="rounded-3xl bg-white p-5 shadow-sm" aria-label="손글씨 학습 진도">
        <h1 className="text-2xl font-bold">천천히 익히는 내 손글씨</h1><p className="mt-2 text-sm leading-6 text-gray-600">12단계 · 53개 수업. 하루 10~15분을 목표로 한 수업씩 해봐요. 어려운 수업은 반복하고, 익숙한 수업은 직접 골라도 괜찮아요.</p>
        <p className="mt-3 font-bold text-amber-800">{progressReady ? `${completed.size} / 53 수업 완료` : progressError || '저장한 진도를 불러오는 중…'}</p>
        {progressError && <button className="mt-2 min-h-11 rounded-xl bg-gray-100 px-4" onClick={() => setReload(value => value + 1)}>진도 다시 불러오기</button>}
        {progressReady && <progress className="mt-3 w-full accent-amber-600" value={completed.size} max={53} aria-label="수업 완료 진도" />}
        {completed.size === 53 && <p className="mt-3 text-sm">전 과정을 연습했어요! 어려웠던 수업을 골라 복습하거나 내 문장으로 자유롭게 써보세요.</p>}
        <details className="mt-4"><summary className="min-h-11 cursor-pointer py-3 font-bold">전체 수업 보기</summary><div className="grid gap-2 sm:grid-cols-2">{HANDWRITING_LESSONS.map(row => <button key={row.id} disabled={!progressReady || saving || !!pending.current} aria-current={row.id === lesson.id ? 'step' : undefined} onClick={() => selectLesson(row)} className={`min-h-12 rounded-xl p-3 text-left text-sm disabled:opacity-40 ${row.id === lesson.id ? 'bg-amber-100 ring-2 ring-amber-500' : 'bg-gray-50'}`}><span className="block text-xs text-gray-500">{row.stage}</span>{row.number}강 · {row.title}{completed.has(row.id) ? ' ✓ 완료' : ''}</button>)}</div></details>
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-bold text-amber-800"><button disabled={!owner || materials.opening || materials.importing} onClick={() => void materials.downloadPdf()} className="min-h-11 underline disabled:opacity-40">{materials.opening ? '원본 준비 중…' : '내 원본 PDF 내려받기'}</button><Link href="/growth/handwriting/free" className="py-3 underline">자유 문장 연습</Link><Link href="/growth/resources" className="py-3 underline">저장한 연습 보기</Link></div>
      </section>
      <section aria-label="비공개 손글씨 교재" className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="font-bold">내 계정 전용 교재</h2><p className="mt-2 text-sm text-gray-600">교재 원본과 연습지는 로그인한 본인만 열 수 있어요. GitHub나 공개 파일 주소에는 교재를 올리지 않아요.</p>
        {materials.loading && <p role="status" className="mt-3 text-sm">비공개 연습지를 불러오는 중…</p>}
        {materials.error && <p role="alert" className="mt-3 text-sm">{materials.error} <button className="min-h-11 underline" onClick={materials.retry}>교재 다시 불러오기</button></p>}
        <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 font-bold">처음 한 번 교재 등록</summary><p className="mb-3 text-sm">제공받은 교재 묶음(JSON)을 선택하세요. 원본 PDF와 53개 연습지가 본인 계정에만 저장돼요. 등록 중에는 화면을 닫지 마세요.</p><label className="block text-sm">교재 묶음 파일<input type="file" accept=".json,application/json" disabled={!owner || materials.importing || saving || !!pending.current} onChange={event => { const file = event.target.files?.[0]; if (file) void materials.importPackage(file); event.target.value = ''; }} className="mt-2 block w-full min-w-0 text-sm" /></label></details>
        {materials.importStatus && <p role="status" className="mt-3 text-sm">{materials.importStatus}</p>}
      </section>
      <section className="rounded-3xl bg-white p-5 shadow-sm" aria-label="오늘의 손글씨 수업">
        <p className="text-sm font-bold text-amber-700">{lesson.stage}</p><h2 className="mt-2 text-xl font-bold">{lesson.number}강 · {lesson.title}</h2><p className="mt-2">{lesson.goal}</p><p className="mt-2 text-xs text-gray-500">PDF {lesson.pdfPage}쪽 · 유인물 {lesson.pdfPage - 1}쪽</p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6">{lesson.steps.map(step => <li key={step}>{step}</li>)}</ol>
        <p className="mt-3 text-xs leading-5 text-gray-500">필림의 원본 연습 자료를 기준으로 연이가 연습 순서와 점검 항목을 덧붙였어요. 원래 강의 영상의 설명을 대체하지는 않아요.</p>
        <fieldset disabled={saving || !!pending.current} className="mt-5 flex flex-wrap gap-2"><legend className="mb-2 text-sm font-bold">연습 방법</legend>{(['paper','screen'] as const).map(value => <button key={value} aria-pressed={mode === value} className={`min-h-11 rounded-xl px-4 text-sm font-bold ${mode === value ? 'bg-amber-600 text-white' : 'bg-gray-100'}`} onClick={() => { if (mode !== value && canLeave()) { resetAttempt(); setMode(value); } }}>{value === 'paper' ? '종이·다른 앱에서 연습' : '이 화면에 직접 쓰기'}</button>)}</fieldset>
        <details open={mode === 'paper'} className="mt-4"><summary className="cursor-pointer py-3 font-bold">원본 예시 살펴보기</summary>{imagePath && <a href={imagePath} target="_blank" rel="noopener noreferrer" className="block"><Image key={imagePath} src={imagePath} alt={`필림 유인물 ${lesson.pdfPage - 1}쪽: ${lesson.title}`} width={1000} height={1415} unoptimized className="h-auto w-full rounded-xl border" /><span className="block py-3 text-xs text-amber-800 underline">새 창에서 크게 보기</span></a>}</details>
        {mode === 'screen' && <div className="mt-4"><div className="flex flex-wrap gap-2"><button disabled={saving || !!pending.current} aria-pressed={trace} className="min-h-11 rounded-xl bg-gray-100 px-3 text-sm" onClick={() => { if (canLeave()) { resetAttempt(); setTrace(value => !value); } }}>{trace ? '원본 위에 따라 쓰기 · 빈 연습장으로 전환' : '빈 연습장에 직접 쓰기 · 원본으로 전환'}</button><button onClick={undo} disabled={saving || saved || !!pending.current || !strokes} className="min-h-11 rounded-xl bg-gray-100 px-4 disabled:opacity-40">되돌리기</button><button disabled={saving || !!pending.current} onClick={() => { if (canLeave()) resetAttempt(); }} className="min-h-11 rounded-xl bg-gray-100 px-4">다시 연습</button></div>
          <p className="my-3 text-xs leading-5 text-gray-600">펜·손가락·마우스로 쓸 수 있어요. 작은 휴대폰에서는 종이 연습이 편해요. 화면 이동은 연습장 바깥에서 해주세요.</p>
          {sheetError ? <p role="alert">연습지를 불러오지 못했어요. <button className="min-h-11 underline" onClick={() => setSheetRetry(value => value + 1)}>연습지 다시 불러오기</button></p> : !sheetReady && <p role="status">연습지 준비 중…</p>}
          <canvas ref={canvasRef} aria-label="수업 손글씨 연습장" onPointerDown={start} onPointerMove={draw} onPointerUp={stop} onPointerCancel={stop} className="w-full rounded-xl border bg-white" style={{ touchAction: 'none', aspectRatio: '1 / 1.415' }} />
          <p className="mt-2 text-xs text-gray-500">직접 쓴 획 {strokes}개 · 펜이 움직인 시간 {Math.round(evidence.current.activeMs / 1000)}초. 글씨 품질을 자동 채점하지 않아요.</p>
        </div>}
        <fieldset disabled={saving || saved || !!pending.current || !progressReady} className="mt-5 space-y-3"><legend className="mb-2 font-bold">연습 후 스스로 확인해요</legend>{lesson.checks.map((check, index) => <label key={check} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={checks[index]} onChange={event => setChecks(current => current.map((value, i) => i === index ? event.target.checked : value))} className="h-5 w-5 shrink-0 accent-amber-600" />{check}</label>)}
          {mode === 'paper' && <label className="block text-sm">실제로 연습한 시간 (분)<input type="number" inputMode="numeric" min={1} max={240} step={1} value={minutes} onChange={event => setMinutes(event.target.value)} className="mt-2 block min-h-12 w-full rounded-xl border p-3 text-base" /><span className="mt-1 block text-xs text-gray-500">종이·다른 앱 연습 시간은 직접 입력한 값으로 저장해요.</span></label>}
          <label className="block text-sm">다음에 신경 쓸 점 (선택)<textarea value={reflection} maxLength={200} onChange={event => setReflection(event.target.value)} placeholder="예: 글자 사이를 조금 더 띄우기" className="mt-2 block w-full rounded-xl border p-3 text-base" /></label>
        </fieldset>
        {!routine && growth.dataReady && <p role="alert" className="mt-3 text-sm">손글씨 루틴이 없어요. 자기계발 홈에서 손글씨 루틴을 추가한 뒤 저장해 주세요.</p>}
        <button disabled={!canSave} onClick={() => void save()} className="mt-5 min-h-12 w-full rounded-xl bg-amber-600 px-4 font-bold text-white disabled:bg-gray-300">{saving ? '수업 저장 중…' : saved ? '수업 저장 완료' : pending.current ? '같은 기록 다시 확인' : '이 수업 완료하고 저장'}</button>
        {(notice || growth.notice) && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">{notice || growth.notice}</p>}
        {saved && <div className="mt-4 flex flex-wrap gap-2"><button className="min-h-12 rounded-xl bg-amber-100 px-4 font-bold" onClick={() => selectLesson(nextHandwritingLesson(completed))}>{completed.size === 53 ? '처음부터 복습하기' : '다음 미완료 수업'}</button><button className="min-h-12 rounded-xl bg-gray-100 px-4" onClick={resetAttempt}>같은 수업 다시 연습</button></div>}
      </section>
    </div>
  </main>;
}
