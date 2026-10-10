"use client";
import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import AppIdentity from '@/app/components/AppIdentity';
import { getLocalDateKey } from '@/utils/dateKey';
import { supabase } from '@/app/lib/supabase';
import { HANDWRITING_LESSONS } from '@/app/data/handwritingCourse';
import { canPairAttempts, comparisonPairNotes, type ComparisonAttempt } from '@/lib/handwriting-comparison';
import { comparisonStatusText, type ComparisonPane, type SavedHandwritingReader } from '@/lib/handwriting-comparison-reader';
import { useSavedHandwritingComparison } from './useSavedHandwritingComparison';

export default function HandwritingComparisonPage() {
  const [owner, setOwner] = useState<string | null>(null), [checked, setChecked] = useState(false), [authVersion, setAuthVersion] = useState(0);
  const activeOwner = useRef<string | null>(null);
  const isOwnerActive = useCallback((id: string) => activeOwner.current === id, []);
  useEffect(() => {
    if (!supabase) { setChecked(true); return; }
    let alive = true, generation = 0; setChecked(false);
    // getUser has no AbortSignal parameter. A bounded UI deadline settles even if the SDK hangs.
    const timeout = setTimeout(() => { if (alive && !generation) change(null); }, 15_000);
    const change = (id: string | null) => { if (!alive) return; generation++; activeOwner.current = id; setOwner(id); setChecked(true); };
    void supabase.auth.getUser().then(({ data, error }) => { if (!generation) change(error ? null : data.user?.id ?? null); }).catch(() => { if (!generation) change(null); }).finally(() => clearTimeout(timeout));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { if (session?.user.id !== activeOwner.current || !generation) flushSync(() => change(session?.user.id ?? null)); });
    return () => { alive = false; activeOwner.current = null; clearTimeout(timeout); data.subscription.unsubscribe(); };
  }, [authVersion]);
  if (!owner) return <main className="min-h-dvh bg-yeoni-bg p-6"><p role="status">{checked ? '로그인 정보를 확인한 뒤 저장한 손글씨 비교를 열어 주세요.' : '비교 계정 확인 중…'}</p>{checked && <button className="mt-3 min-h-11 rounded-xl bg-white px-4" onClick={() => setAuthVersion(value => value + 1)}>계정 다시 확인</button>}</main>;
  return <ComparisonWorkspace key={owner} owner={owner} isOwnerActive={isOwnerActive} />;
}
const sourceLabel = (a: ComparisonAttempt) => a.kind === 'free' ? '자유 연습' : '수업 연습';
const modeLabel = (a: ComparisonAttempt) => ({ paper: '종이·다른 앱', trace: '원본 위에 따라 쓰기', copy: '빈 연습장에 직접 쓰기', free: '자유 연습장' })[a.mode];
function contextLabel(a: ComparisonAttempt) {
  if (a.kind === 'free') return `선택한 안내 문장: ${a.guideText ?? '미확인'}`;
  if (a.lessonTitle) return `${a.lessonId} · 저장한 수업 이름: ${a.lessonTitle}`;
  const current = HANDWRITING_LESSONS.find(lesson => lesson.id === a.lessonId);
  return `${a.lessonId} · ${current ? `현재 수업 이름: ${current.title}` : '당시 수업 이름 미확인'}`;
}
const attemptLabel = (a: ComparisonAttempt) => `${a.date} · ${sourceLabel(a)} · ${modeLabel(a)} · ${a.kind === 'course' ? a.lessonId : a.guideText}`;
const ready = (pane: ComparisonPane) => pane.status === 'ready_verified' || pane.status === 'ready_legacy_unverified';
const buttonClass = 'min-h-11 rounded-xl bg-gray-100 px-4 py-2 text-sm font-bold disabled:opacity-40';
function ComparisonWorkspace({ owner, isOwnerActive }: { owner: string; isOwnerActive: (id: string) => boolean }) {
  const data = useSavedHandwritingComparison(owner, isOwnerActive), { reader, panes } = data;
  const [kind, setKind] = useState('all'), [context, setContext] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [checks, setChecks] = useState([false, false, false]);
  const [zoom, setZoom] = useState<{ index: 0 | 1; token: number } | null>(null);
  const pairKey = panes.map(pane => `${pane.id}:${pane.token}`).join('|');
  useEffect(() => { setChecks([false, false, false]); setZoom(null); }, [pairKey]);
  const changeFilter = (update: () => void) => { update(); void reader.refresh(); };
  const contextOptions = [...new Set(data.entries.flatMap(entry => entry.attempt && (kind === 'all' || entry.attempt.kind === kind) ? [entry.attempt.kind === 'course' ? entry.attempt.lessonId ?? '' : entry.attempt.guideText ?? ''] : []))].filter(Boolean).sort();
  const entries = data.entries.filter(entry => {
    const a = entry.attempt;
    return (!a ? kind === 'all' && !context && !from && !to : (kind === 'all' || a.kind === kind) && (!context || context === (a.kind === 'course' ? a.lessonId : a.guideText)) && (!from || a.date >= from) && (!to || a.date <= to));
  });
  const candidates = entries.filter(entry => entry.status === 'candidate').length;
  const notes = panes[0].attempt && panes[1].attempt ? comparisonPairNotes(panes[0].attempt, panes[1].attempt, ready(panes[0]) ? panes[0] : undefined, ready(panes[1]) ? panes[1] : undefined) : [];
  const zoomPane = zoom && panes[zoom.index].token === zoom.token && ready(panes[zoom.index]) ? panes[zoom.index] : null;
  return <main className="min-h-dvh bg-yeoni-bg pb-12 text-[#242231]">
    <header className="app-module-header"><div className="app-module-header-inner flex-wrap"><AppIdentity kind="growth" title="손글씨 비교" subtitle="저장한 두 장을 직접 살펴봐요" /><Link href="/growth/handwriting" className={buttonClass}>손글씨 수업</Link></div></header>
    <div className="mx-auto max-w-6xl space-y-5 px-3 py-6 sm:px-6">
      <section className="rounded-3xl bg-white p-4 sm:p-6">
        <h1 className="text-2xl font-bold">저장한 손글씨 전후 비교</h1>
        <p className="mt-2 text-sm leading-6">저장한 이미지 두 장을 직접 살펴봐요. 자동으로 글씨 품질이나 향상을 판정하지 않아요.</p>
        <p className="mt-2 text-xs leading-5 text-gray-600">원본은 저장한 연습장 PNG예요. 따라 쓰기는 배경 교재를 포함해요. 종이 완료 기록·교재·연결 없는 자료는 비교 이미지로 대신 쓰지 않아요.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">연습 종류<select aria-label="연습 종류" value={kind} onChange={event => changeFilter(() => { setKind(event.target.value); setContext(''); })} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border p-2"><option value="all">전체</option><option value="course">수업 연습</option><option value="free">자유 연습</option></select></label>
          <label className="text-sm">수업·안내 문장<select aria-label="수업·안내 문장" value={context} onChange={event => changeFilter(() => setContext(event.target.value))} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border p-2"><option value="">전체</option>{context && !contextOptions.includes(context) && <option value={context}>{context}</option>}{contextOptions.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="min-w-0 text-sm">기록 날짜부터<input aria-label="기록 날짜부터" type="date" value={from} onChange={event => changeFilter(() => setFrom(event.target.value))} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border p-2" /></label>
          <label className="min-w-0 text-sm">기록 날짜까지<input aria-label="기록 날짜까지" type="date" value={to} onChange={event => changeFilter(() => setTo(event.target.value))} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border p-2" /></label>
        </div>
        <p className="mt-3 text-sm" role="status">불러온 기록 {data.entries.length}개 · 현재 조건 {entries.length}개{data.loading ? ' · 목록 확인 중이에요.' : data.error ? ' · 조회를 확인하지 못했어요.' : data.hasMore ? ' · 더 불러올 기록이 있을 수 있어요.' : ' · 현재 조회의 끝까지 불러왔어요.'}</p>
        <p className="mt-1 text-xs leading-5 text-gray-600">필터는 불러온 기록에 적용돼요. 목록은 기록 날짜순이며 전체의 첫 기록·마지막 기록을 판정하지 않아요. 선택 후 실제 이미지와 연결을 다시 확인해요.</p>
        {data.loading && <p role="status" className="mt-3">기록 목록 확인 중…</p>}
        {data.error && <p role="alert" className="mt-3">{data.error}</p>}
        {!data.loading && !data.error && candidates === 0 && <p className="mt-3">{entries.length ? '현재 조건에는 비교 이미지 후보가 없어요. 아래 기록에서 이유를 확인할 수 있어요.' : data.entries.length ? '불러온 기록 중 현재 조건에 맞는 기록이 없어요.' : '아직 불러온 손글씨 기록이 없어요.'}</p>}
        {!data.loading && !data.error && candidates === 1 && <p className="mt-3">현재 조건에서 이미지 후보가 한 개예요. 두 번째 기록을 더 불러오거나 조건을 바꿔 주세요.</p>}
        <div className="mt-3 flex flex-wrap gap-2"><button className={buttonClass} onClick={() => void reader.refresh()}>새로 불러오기</button>{data.hasMore && !data.blocked && <button disabled={data.loading} className={buttonClass} onClick={() => void reader.more()}>{data.error ? '목록 다시 시도' : '더 불러오기'}</button>}<Link className="min-h-11 px-2 py-3 text-sm underline" href="/growth/resources">일반 자료함</Link></div>
      </section>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">{([0, 1] as const).map(index => {
        const title = index === 0 ? '기준 기록' : '비교 기록', other = panes[index === 0 ? 1 : 0].attempt;
        return <section key={index} aria-label={title} className="min-w-0 rounded-3xl bg-white p-4 sm:p-5">
          <h2 className="text-lg font-bold">{title}</h2>
          <label className="mt-3 block text-sm">{title} 선택<select aria-label={`${title} 선택`} value={panes[index].id ?? ''} disabled={data.blocked} onChange={event => void reader.select(index, event.target.value || null)} className="mt-1 min-h-12 w-full min-w-0 rounded-xl border p-2">
            <option value="">직접 선택해 주세요</option>{entries.map(entry => <option key={entry.id} value={entry.id} disabled={!!(entry.attempt && other && !canPairAttempts(entry.attempt, other))}>{entry.attempt ? attemptLabel(entry.attempt) : '확인할 수 없는 연습 기록'}{entry.status !== 'candidate' ? ` · ${entry.reason}` : ''}</option>)}
          </select></label>
          <ComparisonImagePane pane={panes[index]} index={index} title={title} reader={reader} onZoom={() => setZoom({ index, token: panes[index].token })} />
        </section>;
      })}</div>
      <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={!panes.every(pane => pane.id)} onClick={() => void reader.swap()}>두 기록 자리 바꾸기</button><button className={buttonClass} onClick={() => { reader.clear(0); reader.clear(1); }}>두 선택 닫기</button></div>
      {notes.length > 0 && <section aria-label="연습 조건 안내" className="rounded-3xl bg-white p-5"><h2 className="font-bold">연습 조건 안내</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">{notes.map(note => <li key={note}>{note}</li>)}</ul></section>}
      {panes.every(ready) && <fieldset className="rounded-3xl bg-white p-5"><legend className="px-2 font-bold">이번에 살펴본 점 (선택)</legend><p className="text-sm">이 화면의 확인 표시는 저장되지 않으며 두 기록을 바꾸면 초기화돼요.</p>{['글자 크기의 차이를 살펴봤어요', '글자·단어 사이 간격을 살펴봤어요', '다음 연습에서 신경 쓸 점을 정했어요'].map((label, index) => <label key={label} className="mt-2 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={checks[index]} onChange={event => setChecks(values => values.map((value, i) => i === index ? event.target.checked : value))} />{label}</label>)}</fieldset>}
      <p className="text-xs leading-5 text-gray-600">계정·초기화·연결 상태는 읽기, 이미지 표시 직전, 화면 복귀 때 확인해요. 다른 화면에서 돌아오면 두 기록을 다시 선택해 주세요. 다른 기기의 삭제·초기화를 즉시 감지하는 기능은 아니에요. 그림 크기가 같게 보여도 실제 종이·글씨 크기나 도구가 같다는 뜻은 아니에요.</p>
    </div>
    {zoomPane && zoom && <ImageDialog pane={zoomPane} title={zoom.index === 0 ? '기준 기록' : '비교 기록'} onClose={() => setZoom(null)} onError={() => reader.imageError(zoom.index, zoomPane.token, zoomPane.url)} />}
  </main>;
}
function ComparisonImagePane({ pane, index, title, reader, onZoom }: { pane: ComparisonPane; index: 0 | 1; title: string; reader: SavedHandwritingReader; onZoom: () => void }) {
  const a = pane.attempt;
  return <>
    <p role={['read_unconfirmed', 'integrity_mismatch', 'image_unavailable', 'metadata_missing'].includes(pane.status) ? 'alert' : 'status'} className="mt-3 text-sm font-bold">{pane.reason || comparisonStatusText[pane.status]}</p>
    {a && <div className="mt-3 space-y-1 break-words text-sm leading-6"><p>기록 날짜: {a.date}</p>{a.date > getLocalDateKey() && <p>미래 날짜로 저장된 기록이에요. 실제 연습 순서는 확인할 수 없어요.</p>}<p>저장 시각: {a.savedAt ? new Date(a.savedAt).toLocaleString('ko-KR') : '미확인'}</p><p>{sourceLabel(a)} · {modeLabel(a)}</p><p>{contextLabel(a)}</p><p className="text-xs text-gray-600">기록 날짜와 저장 시각은 실제 연습 시작 시각을 뜻하지 않아요.</p>{pane.pathDate && pane.pathDate !== a.date && <p>파일 저장 경로 날짜({pane.pathDate})와 기록 날짜가 달라요.</p>}</div>}
    {ready(pane) && a && <>
      <div className="mt-4 flex min-h-48 items-center justify-center rounded-xl border bg-gray-100 p-2"><Image unoptimized key={pane.url} src={pane.url} width={pane.width} height={pane.height} alt={`${title}: ${attemptLabel(a)}의 저장한 연습장 이미지`} className="h-auto max-h-[36rem] w-full object-contain" onError={() => reader.imageError(index, pane.token, pane.url)} /></div>
      <p className="mt-2 text-xs">저장 이미지 {pane.width} × {pane.height}픽셀 · 전체 화면 맞춤</p>
      <button onClick={onZoom} className={`${buttonClass} mt-2`} aria-label={`${title} 크게 보기`}>크게 보기</button>
      <dl className="mt-3 space-y-1 text-sm"><div>움직임이 남은 입력 획: {a.metrics.strokes ?? '미확인'}</div><div>획 접촉 구간 시간: {a.metrics.activeSeconds === null ? '미확인' : `${a.metrics.activeSeconds}초`}</div>{a.kind === 'free' && <><div>좌표 범위 너비 / 높이: {a.metrics.occupiedWidth ?? '미확인'} / {a.metrics.occupiedHeight ?? '미확인'} %</div><div>펜 압력 변화 범위: {a.metrics.pressureRange ? a.metrics.pressureRange.join('–') : '미확인 (변화 없음 포함)'}</div></>}</dl>
      <p className="mt-2 text-xs leading-5 text-gray-600">획 수는 글자 수·획순이 아니에요. 시간은 반올림한 접촉 구간으로 멈춤을 포함할 수 있어요.{a.kind === 'free' && ' 좌표 범위는 글자 크기·간격이 아니며 압력은 기기별 0–1 값으로 실제 힘이 아니에요.'}</p>
      {a.kind === 'course' && <div className="mt-3 text-sm"><p className="font-bold">저장한 자기 점검 (당시 자기 보고)</p>{a.checks.map((check, i) => <p key={i}>{check.checked ? '확인함' : '확인하지 않음'} · {check.label ?? `당시 ${i + 1}번 항목 문구 미확인`}</p>)}</div>}
    </>}
    {pane.id && pane.status !== 'loading' && !['no_saved_image', 'empty'].includes(pane.status) && <button className={`${buttonClass} mt-3`} onClick={() => void reader.select(index, pane.id)}>{title} 다시 확인</button>}
  </>;
}
function ImageDialog({ pane, title, onClose, onError }: { pane: ComparisonPane; title: string; onClose: () => void; onError: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const prior = document.activeElement as HTMLElement | null, dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); if (prior?.isConnected) prior.focus(); }; }, []);
  return <dialog ref={ref} aria-label={`${title} 크게 보기`} onCancel={event => { event.preventDefault(); onClose(); }} className="max-h-[95dvh] w-[96vw] max-w-6xl overflow-auto rounded-2xl p-3 backdrop:bg-black/60"><div className="sticky top-0 flex items-center justify-between gap-2 bg-white pb-3"><h2 className="font-bold">{title} · 전체 원본</h2><button autoFocus className={buttonClass} onClick={onClose}>닫기</button></div><Image unoptimized src={pane.url} width={pane.width} height={pane.height} alt={`${title} 저장한 연습장 전체 이미지`} className="h-auto w-full object-contain" onError={onError} /><p className="mt-2 text-xs">{pane.width} × {pane.height}픽셀. 확대는 보기만 바꾸며 원본은 편집하지 않아요.</p></dialog>;
}
