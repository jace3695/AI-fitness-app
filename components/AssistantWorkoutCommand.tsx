'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { workoutRecordStatus, type WorkoutCommandProposal, type WorkoutCommandReceipt } from '@/lib/assistant-workout-command';
import { taskCommandDateLabel } from '@/lib/assistant-task-command';

async function workoutRequest(body?: unknown, offset = 0, ownerId?: string) {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session) throw new Error('로그인이 필요합니다.');
  if (ownerId && session.user.id !== ownerId) throw new Error('로그인 계정이 변경됐습니다. 화면을 다시 열어 주세요.');
  const response = await fetch(`/api/assistant/workout-commands${body ? '' : `?offset=${offset}`}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if ((await supabase?.auth.getSession())?.data.session?.user.id !== session.user.id) throw new Error('로그인 계정이 변경됐습니다. 화면을 다시 열어 주세요.');
  if (!response.ok) throw new Error(result.error || '운동 실행 이력을 확인하지 못했습니다.');
  return result;
}
const describe = (records: WorkoutCommandReceipt['before_values']) => workoutRecordStatus(records) === 'completed' ? '운동 완료' : '일반 운동 완료 기록 없음';

export function AssistantWorkoutReceipt({ receipt, onChanged }: { receipt: WorkoutCommandReceipt; onChanged?: () => void | Promise<void> }) {
  const [saved, setSaved] = useState(receipt);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const undo = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await workoutRequest({ decision: 'undo', requestId: saved.id }, 0, saved.user_id);
      setSaved(result.receipt); setConfirm(false); await onChanged?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '되돌리기 결과를 확인하지 못했습니다.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <article aria-label="운동 실행 이력" className="rounded-2xl border border-violet-100 bg-white p-4 text-sm text-gray-800">
    <p className="font-bold">{saved.record_date} · 운동</p>
    <p role="status" className="mt-1 text-xs text-violet-700">{saved.undone_at ? '되돌리기 완료' : '운동 완료 저장'} · {taskCommandDateLabel(saved.created_at)}</p>
    <dl className="mt-3 space-y-1"><div><dt className="inline font-bold">변경 전: </dt><dd className="inline">{describe(saved.before_values)}</dd></div><div><dt className="inline font-bold">변경 후: </dt><dd className="inline">{describe(saved.after_values)}</dd></div></dl>
    {!saved.undone_at && (confirm ? <div className="mt-3 rounded-xl bg-amber-50 p-3">
      <p>이 명령으로 저장한 운동 완료를 되돌릴까요?</p><p className="mt-1 text-xs">이후에 같은 날짜의 운동 기록이 변경되었으면 되돌리지 않습니다.</p>
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void undo()} className="rounded-xl bg-violet-700 px-3 py-2 font-bold text-white disabled:opacity-50">{busy ? '처리 중…' : '확인하고 되돌리기'}</button><button type="button" disabled={busy} onClick={() => setConfirm(false)} className="rounded-xl bg-white px-3 py-2">유지하기</button></div>
    </div> : <button type="button" onClick={() => setConfirm(true)} className="mt-3 rounded-xl bg-violet-50 px-3 py-2 font-bold text-violet-800">이 변경 되돌리기</button>)}
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
  </article>;
}

export function AssistantWorkoutReview({ proposal, onChanged, ownerId, initiallyAttempted = false, onAttempt, onSettled }: {
  proposal: WorkoutCommandProposal; onChanged?: () => void | Promise<void>; ownerId?: string;
  initiallyAttempted?: boolean; onAttempt?: () => Promise<void>; onSettled?: () => Promise<void>;
}) {
  const [receipt, setReceipt] = useState<WorkoutCommandReceipt | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(initiallyAttempted);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (receipt || cancelled) return;
    const check = () => setExpired(Date.now() >= Date.parse(proposal.expiresAt));
    check(); const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [proposal.expiresAt, receipt, cancelled]);
  const apply = async () => {
    if (lock.current || receipt || cancelled) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await onAttempt?.(); setAttempted(true);
      const result = await workoutRequest({ decision: 'apply', proposal }, 0, ownerId ?? proposal.ownerId);
      setReceipt(result.receipt); await onSettled?.(); await onChanged?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '운동 저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const cancel = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await onSettled?.(); setCancelled(true); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '확인 화면을 닫지 못했습니다.'); }
    finally { lock.current = false; setBusy(false); }
  };
  if (cancelled) return <p role="status" className="mt-3 text-gray-600">{attempted ? '확인 화면을 닫았습니다. 저장 여부는 실행 이력에서 확인해 주세요.' : '취소했습니다. 운동 기록은 변경하지 않았습니다.'}</p>;
  if (receipt) return <div className="mt-3">{error && <p role="alert" className="text-red-700">{error}</p>}<AssistantWorkoutReceipt receipt={receipt} onChanged={onChanged} /><Link href="/assistant/history?area=workout" className="mt-2 inline-block font-bold text-violet-700">운동 실행 이력 보기 →</Link><Link href="/fitness" className="ml-4 inline-block font-bold text-violet-700">운동 기록 보기 →</Link></div>;
  return <section aria-label="운동 완료 확인" className="mt-3 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-gray-800">
    <h3 className="font-bold">운동 완료 확인</h3><p className="mt-1">{proposal.date} (한국 시간)</p>
    <p className="mt-2 text-sm">현재 완료: {describe(proposal.expected)}</p><p className="mt-1 text-sm">저장할 내용: 사용자가 직접 확인한 운동 완료</p>
    <p className="mt-2 text-xs text-gray-600">오늘의 완료 사실을 기록합니다. 운동 종류·세트·횟수·통증은 운동 화면에서 입력해 주세요. 확인 화면은 15분간 유효하며 같은 탭에서 새로고침하면 복구됩니다.</p>
    {expired && <p role="status" className="mt-2 text-sm text-amber-800">확인 시간이 지났습니다. {attempted ? '같은 요청으로 저장 결과를 재확인할 수 있습니다.' : '명령을 다시 입력해 주세요.'}</p>}
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || (expired && !attempted)} onClick={() => void apply()} className="rounded-xl bg-violet-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? '저장 중…' : attempted ? '같은 요청으로 다시 확인' : '확인하고 저장'}</button><button type="button" disabled={busy} onClick={() => void cancel()} className="rounded-xl bg-white px-3 py-2 text-sm">{attempted ? '확인 화면 닫기' : '취소'}</button></div>
    {error && <div role="alert" className="mt-3 text-sm text-red-700"><p>{error}</p><Link href="/assistant/history?area=workout" className="mt-2 inline-block underline">저장 여부를 실행 이력에서 확인</Link></div>}
  </section>;
}

export function AssistantWorkoutHistory() {
  const [history, setHistory] = useState<WorkoutCommandReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const load = useCallback(async (offset = 0) => {
    if (lock.current) return;
    lock.current = true; setLoading(true); setError('');
    try {
      const result = await workoutRequest(undefined, offset);
      setHistory(current => offset ? [...current, ...result.history].filter((row, index, rows) => rows.findIndex(other => other.id === row.id) === index) : result.history);
      setHasMore(result.history.length === 20);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '운동 실행 이력을 불러오지 못했습니다.'); }
    finally { lock.current = false; setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section aria-label="운동 실행 이력 목록"><p className="mt-2 text-sm leading-6 text-gray-600">연이 대화·빠른 명령에서 확인하고 저장한 운동 완료 이력입니다.</p>
    <button type="button" disabled={loading} onClick={() => void load()} className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-bold text-violet-700 disabled:opacity-50">이력 새로고침</button>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    {!loading && !error && !history.length && <p className="mt-5 rounded-2xl bg-white p-5">아직 확인하고 저장한 운동 명령이 없습니다.</p>}
    <div className="mt-4 space-y-4">{history.map(receipt => <AssistantWorkoutReceipt key={`${receipt.id}:${receipt.undone_at}`} receipt={receipt} onChanged={() => load()} />)}</div>
    {loading && <p role="status" className="mt-4">실행 이력을 불러오는 중…</p>}
    {hasMore && <button type="button" disabled={loading} onClick={() => void load(history.length)} className="mt-4 rounded-xl bg-white px-4 py-3 font-bold text-violet-700 disabled:opacity-50">이전 이력 더 보기</button>}
  </section>;
}
