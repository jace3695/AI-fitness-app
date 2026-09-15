'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { EDIT_FIELDS, displayEditValue } from '@/app/budget/lib/history-edit';
import type { BudgetCommandProposal, BudgetCommandReceipt, BudgetChangeDetail } from '@/lib/assistant-budget-command';

export async function budgetCommandRequest(body?: unknown, offset = 0, requestId?: string, ownerId?: string) {
  const session = await supabase?.auth.getSession();
  if (!session?.data.session) throw new Error('로그인이 필요합니다.');
  if (ownerId && session.data.session.user.id !== ownerId) throw new Error('로그인 계정이 변경됐습니다. 화면을 다시 열어 주세요.');
  const response = await fetch(`/api/assistant/budget-commands${body ? '' : requestId ? `?requestId=${encodeURIComponent(requestId)}` : `?offset=${offset}`}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { Authorization: `Bearer ${session.data.session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '가계부 실행 결과를 확인하지 못했습니다.');
  return result;
}
const primary = 'rounded-xl bg-violet-700 px-3 py-2 font-bold text-white disabled:opacity-50';
const secondary = 'rounded-xl bg-violet-50 px-3 py-2 font-bold text-violet-800 disabled:opacity-50';

export function AssistantBudgetReceipt({ receipt, currency, onChanged }: { receipt: BudgetCommandReceipt; currency: string; onChanged?: () => void | Promise<void> }) {
  const [saved, setSaved] = useState(receipt);
  const [details, setDetails] = useState<BudgetChangeDetail[] | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const field = saved.field_name || 'category';
  const label = EDIT_FIELDS[field];
  const action = async (undo: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (undo) {
        const result = await budgetCommandRequest({ decision: 'undo', requestId: saved.id });
        setSaved(result.receipt); setConfirmUndo(false); await onChanged?.();
      } else {
        const result = await budgetCommandRequest(undefined, 0, saved.id);
        setSaved(result.receipt); setDetails(result.details);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '가계부 이력을 확인하지 못했습니다.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <article aria-label={`가계부 ${label} ${saved.entry_count}건 실행 이력`} className="rounded-2xl border border-violet-100 bg-white p-4 text-sm text-gray-800">
    <p className="font-bold">가계부 · {label} {saved.entry_count}건 변경</p>
    <p role="status" className="mt-1 text-xs text-violet-700">{saved.undone_at ? '되돌리기 완료' : '가계부 변경 완료'} · {new Date(saved.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
    <p className="mt-2 break-words">변경한 값: {displayEditValue(field, saved.field_name ? saved.field_value : saved.category, currency)}</p>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void action(false)} className={secondary}>변경 전후 보기</button>{!saved.undone_at && <button type="button" disabled={busy} onClick={() => setConfirmUndo(true)} className={secondary}>이 변경 되돌리기</button>}</div>
    {details && <div className="mt-3 space-y-2">
      <p className="text-xs text-gray-500">사용처와 날짜는 현재 기록 기준입니다.</p>
      {details.map(item => <div key={item.transaction_id} className="rounded-xl bg-gray-50 p-3 break-words"><p>{item.place || '삭제된 내역'} · {item.date || ''}</p><p>{displayEditValue(field, saved.field_name ? item.before_value : item.before_category, currency)} → {displayEditValue(field, saved.field_name ? saved.field_value : saved.category, currency)}</p></div>)}
      {details.length < saved.entry_count && <p>삭제된 내역의 상세는 남기지 않습니다. 일부 내역이 없으면 이 변경 전체를 되돌릴 수 없습니다.</p>}
    </div>}
    {confirmUndo && !saved.undone_at && <div className="mt-3 rounded-xl bg-amber-50 p-3"><p>{saved.entry_count}건의 {label}을 변경 전으로 되돌릴까요?{!saved.field_name && ' 함께 기억한 분류 설정도 되돌립니다.'}</p><p className="mt-1 text-xs">이후에 바뀌거나 삭제된 내역이 있으면 중단합니다.</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void action(true)} className={primary}>확인하고 되돌리기</button><button type="button" disabled={busy} onClick={() => setConfirmUndo(false)} className={secondary}>유지하기</button></div></div>}
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
  </article>;
}

export function AssistantBudgetReview({ proposal, ownerId, initiallyAttempted = false, onAttempt, onSettled, onChanged }: {
  proposal: BudgetCommandProposal; ownerId?: string; initiallyAttempted?: boolean;
  onAttempt?: () => Promise<void>; onSettled?: () => Promise<void>; onChanged?: () => void | Promise<void>;
}) {
  const [attempted, setAttempted] = useState(initiallyAttempted);
  const [receipt, setReceipt] = useState<BudgetCommandReceipt | null>(null);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (receipt || closed || expired) return;
    const check = () => setExpired(Date.now() >= Date.parse(proposal.expiresAt));
    check(); const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [proposal.expiresAt, receipt, closed, expired]);
  const act = async (save: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (save) {
        await onAttempt?.(); setAttempted(true);
        const result = await budgetCommandRequest({ decision: 'apply', proposal }, 0, undefined, ownerId);
        setReceipt(result.receipt); await onSettled?.(); await onChanged?.();
      } else { await onSettled?.(); setClosed(true); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '가계부 변경 결과를 확인하지 못했습니다.'); }
    finally { lock.current = false; setBusy(false); }
  };
  if (closed) return <p role="status" className="mt-3 text-sm text-gray-600">{attempted ? '확인 화면을 닫았습니다. 저장 여부는 실행 이력에서 확인해 주세요.' : '취소했습니다. 지출은 변경하지 않았습니다.'}</p>;
  if (receipt) return <div className="mt-3"><AssistantBudgetReceipt receipt={receipt} currency="KRW" onChanged={onChanged} />{error && <p role="alert" className="text-red-700">{error}</p>}<Link href="/assistant/history?area=budget" className="mt-3 inline-block font-bold text-violet-700">가계부 실행 이력 보기 →</Link></div>;
  return <section aria-label="가계부 변경 확인" className="mt-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-gray-800">
    <h3 className="font-bold">지출 금액 수정 확인</h3>
    <p className="mt-2 break-words">{proposal.expected.date} · {proposal.expected.place}</p>
    <p className="mt-1 text-xs">{typeof proposal.expected.payment === 'string' ? proposal.expected.payment : '결제수단 미입력'} · {typeof proposal.expected.transaction_type === 'string' ? proposal.expected.transaction_type : '일반 지출'}</p>
    <table className="mt-3 w-full table-fixed text-left"><thead><tr><th>변경 전</th><th>변경 후</th></tr></thead><tbody><tr><td className="break-words py-2">{displayEditValue('amount', proposal.expected.amount, 'KRW')}</td><td className="break-words py-2 font-bold">{displayEditValue('amount', proposal.amount, 'KRW')}</td></tr></tbody></table>
    <p className="mt-2 text-xs text-gray-600">이 내역 1건의 금액을 바꿉니다. 확인은 15분간 유효하며 같은 탭에서 새로고침해도 복구됩니다.</p>
    {expired && <p role="status" className="mt-2 text-amber-800">확인 시간이 지났습니다. {attempted ? '같은 요청으로 저장 결과만 확인할 수 있습니다.' : '저장하려면 명령을 다시 입력해 주세요.'}</p>}
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || (expired && !attempted)} onClick={() => void act(true)} className={primary}>{busy ? '확인 중…' : attempted ? '같은 요청으로 다시 확인' : '확인하고 저장'}</button><button type="button" disabled={busy} onClick={() => void act(false)} className={secondary}>{attempted ? '확인 화면 닫기' : '취소'}</button></div>
    {error && <div role="alert" className="mt-3 text-red-700"><p>{error}</p><Link href="/assistant/history?area=budget" className="underline">가계부 실행 이력 확인</Link></div>}
  </section>;
}

export function AssistantBudgetHistory() {
  const [history, setHistory] = useState<BudgetCommandReceipt[]>([]);
  const [currency, setCurrency] = useState('KRW');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const lock = useRef(false);
  const load = useCallback(async (offset = 0) => {
    if (lock.current) return;
    lock.current = true; setLoading(true); setError('');
    try {
      const result = await budgetCommandRequest(undefined, offset);
      setHistory(current => offset ? [...current, ...result.history].filter((row, i, rows) => rows.findIndex(r => r.id === row.id) === i) : result.history);
      setCurrency(result.currency); setHasMore(result.history.length === 20);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '가계부 이력을 불러오지 못했습니다.'); }
    finally { lock.current = false; setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section aria-label="가계부 실행 이력 목록">
    <p className="mt-2 text-sm leading-6 text-gray-600">연이 명령과 가계부 화면에서 수정한 분류·금액·날짜·결제수단·장소·메모 이력입니다. 금액 표시는 현재 가계부 통화 설정을 따릅니다.</p>
    <button type="button" disabled={loading} onClick={() => void load()} className={`${secondary} mt-4`}>가계부 이력 새로고침</button>
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
    {!loading && !error && !history.length && <p className="mt-4">아직 가계부 변경 이력이 없습니다.</p>}
    <div className="mt-4 space-y-4">{history.map(receipt => <AssistantBudgetReceipt key={`${receipt.id}:${receipt.undone_at}`} receipt={receipt} currency={currency} onChanged={() => load()} />)}</div>
    {loading && <p role="status" className="mt-4">가계부 실행 이력을 불러오는 중…</p>}
    {hasMore && <button type="button" disabled={loading} onClick={() => void load(history.length)} className={`${secondary} mt-4`}>이전 가계부 이력 더 보기</button>}
  </section>;
}
