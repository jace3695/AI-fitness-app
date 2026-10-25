'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { recurrenceLabel, type RecurrenceRule } from '@/app/lib/assistantRecurrence';
import { taskCommandDateLabel, type TaskCommandProposal, type TaskCommandReceipt } from '@/lib/assistant-task-command';

function checkTaskWait(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}

export async function withinTaskWait<T>(operation: (signal: AbortSignal) => Promise<T>, lifetime: AbortSignal, message: string): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (lifetime.aborted) abort();
  lifetime.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortWait: () => void;
  let timedOut = false;
  const cancelled = new Promise<never>((_, reject) => {
    abortWait = () => reject(new DOMException("Cancelled", "AbortError"));
    controller.signal.addEventListener("abort", abortWait, { once: true });
  });
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; reject(new Error("timeout")); controller.abort(); }, 15000);
    });
    checkTaskWait(controller.signal);
    return await Promise.race([operation(controller.signal), deadline, cancelled]);
  } catch (failure) {
    if (timedOut) throw new Error(message);
    throw failure;
  } finally {
    clearTimeout(timer);
    lifetime.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", abortWait!);
  }
}

export async function assistantCommandRequest(body: unknown, offset: number, ownerId: string | undefined, signal: AbortSignal) {
  checkTaskWait(signal);
  const session = await supabase?.auth.getSession();
  checkTaskWait(signal);
  const token = session?.data.session?.access_token;
  if (!token) throw new Error('로그인이 필요합니다.');
  if (ownerId && session?.data.session?.user.id !== ownerId) throw new Error('로그인 계정이 변경됐습니다. 화면을 다시 열어 주세요.');
  const response = await fetch(`/api/assistant/commands${body ? '' : `?offset=${offset}`}`, {
    signal,
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  checkTaskWait(signal);
  const result = await response.json();
  checkTaskWait(signal);
  const currentSession = (await supabase?.auth.getSession())?.data.session;
  checkTaskWait(signal);
  if (currentSession?.user.id !== session?.data.session?.user.id) throw new Error('로그인 계정이 바뀌었습니다. 화면을 다시 열어 주세요.');
  if (!response.ok) throw new Error(result.error || '실행 이력을 확인하지 못했습니다.');
  return { ...result, clientOwnerId: session?.data.session?.user.id };
}

export function useTaskRequestLifetime(onAccountChanged: () => void, ownerHint?: string) {
  const active = useRef<AbortController | null>(null);
  const invalidate = useRef(onAccountChanged); invalidate.current = onAccountChanged;
  useEffect(() => {
    let owner = ownerHint;
    let subscribed = true;
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!subscribed) return;
      const next = session?.user.id;
      if (owner !== undefined && owner !== next) {
        active.current?.abort(); invalidate.current();
      }
      owner = next;
    }).data.subscription;
    return () => { subscribed = false; active.current?.abort(); subscription?.unsubscribe(); };
  }, [ownerHint]);
  return useCallback(() => {
    active.current?.abort();
    active.current = new AbortController();
    return active.current;
  }, []);
}

function ChangeDetails({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> }) {
  const details = (record: Record<string, unknown>) => [
    taskCommandDateLabel(record.due_at), `우선순위 ${record.priority}`,
    recurrenceLabel(record.recurrence_rule as RecurrenceRule),
  ];
  const previous = before ? details(before) : null;
  const next = details(after);
  return <div className="mt-3 overflow-x-auto"><table className="w-full table-fixed text-left text-xs leading-5">
    <thead><tr><th className="w-14 py-1">항목</th>{previous && <th className="px-1">변경 전</th>}<th className="px-1">{previous ? '변경 후' : '저장할 내용'}</th></tr></thead>
    <tbody>{['마감', '중요도', '반복'].map((label, index) => <tr key={label} className="border-t border-violet-100"><th className="py-2 align-top font-medium">{label}</th>{previous && <td className="break-words px-1 py-2 align-top text-gray-600">{previous[index]}</td>}<td className="break-words px-1 py-2 align-top">{next[index]}</td></tr>)}</tbody>
  </table></div>;
}

export function AssistantTaskReceipt({ receipt, onChanged, ownerId }: { receipt: TaskCommandReceipt; ownerId?: string; onChanged?: () => void | Promise<void> }) {
  const [saved, setSaved] = useState(receipt);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const [accountChanged, setAccountChanged] = useState(false);
  const beginRequest = useTaskRequestLifetime(() => { lock.current = false; setBusy(false); setAccountChanged(true); }, ownerId);
  const undo = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const request = beginRequest();
    let acknowledged = false;
    try {
      await withinTaskWait(async signal => {
        const result = await assistantCommandRequest({ decision: 'undo', requestId: saved.id }, 0, ownerId, signal);
        checkTaskWait(signal);
        acknowledged = true; setSaved(result.receipt); setConfirmUndo(false);
        await onChanged?.(); checkTaskWait(signal);
      }, request.signal, '되돌리기 결과를 아직 확인하지 못했어요. 서버 처리는 계속될 수 있으니 실행 이력을 확인해 주세요.');
    } catch (failure) { if (!request.signal.aborted) setError(acknowledged ? '되돌리기는 확인됐어요. 목록 새로고침을 마치지 못했어요.' : failure instanceof Error ? failure.message : '되돌리기 결과를 확인하지 못했습니다.'); }
    finally { if (!request.signal.aborted) { lock.current = false; setBusy(false); } }
  };
  if (accountChanged) return <p role="alert">계정이 바뀌었어요. 이전 요청을 더 진행하지 않아요. 화면을 다시 열어 주세요.</p>;
  return <article aria-label={`${saved.after_record.title} 실행 이력`} className="rounded-2xl border border-violet-100 bg-white p-4 text-sm text-gray-800">
    <p className="font-bold break-words">{saved.after_record.title}</p>
    <p role="status" className="mt-1 text-xs text-violet-700">{saved.undone_at ? '되돌리기 완료' : saved.operation === 'create' ? '할 일 추가 완료' : saved.operation === 'complete' ? '할 일 완료 저장' : '할 일 수정 완료'} · {taskCommandDateLabel(saved.created_at)}</p>
    <ChangeDetails before={saved.before_record} after={saved.after_record} />
    {saved.operation === 'complete' && <p className="mt-2 text-xs">완료 상태: {saved.undone_at ? '변경 전 상태로 복구' : '완료'}{saved.spawned_record ? ` · 다음 반복 일정: ${taskCommandDateLabel(saved.spawned_record.due_at)}${saved.undone_at ? ' (함께 되돌림)' : ''}` : ' · 다음 일정 생성 없음'}</p>}
    {!saved.undone_at && (confirmUndo ? <div className="mt-3 rounded-xl bg-amber-50 p-3">
      <p>{saved.operation === 'complete' ? '완료를 취소하고 이 명령이 만든 다음 반복 일정도 되돌릴까요?' : saved.operation === 'create' ? '이 명령으로 추가한 할 일을 삭제할까요?' : '마감일·우선순위·반복을 변경 전으로 되돌릴까요?'}</p>
      <p className="mt-1 text-xs text-gray-600">이후에 수정된 기록은 되돌리지 않습니다.</p>
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void undo()} className="rounded-xl bg-violet-700 px-3 py-2 font-bold text-white disabled:opacity-50">{busy ? '처리 중…' : '확인하고 되돌리기'}</button><button type="button" disabled={busy} onClick={() => setConfirmUndo(false)} className="rounded-xl bg-white px-3 py-2">유지하기</button></div>
    </div> : <button type="button" onClick={() => setConfirmUndo(true)} className="mt-3 rounded-xl bg-violet-50 px-3 py-2 font-bold text-violet-800">이 변경 되돌리기</button>)}
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
  </article>;
}

export function AssistantTaskReview({ proposal, onChanged, ownerId, initiallyAttempted = false, onAttempt, onSettled }: {
  proposal: TaskCommandProposal; onChanged?: () => void | Promise<void>; ownerId?: string;
  initiallyAttempted?: boolean; onAttempt?: (signal?: AbortSignal) => Promise<void>; onSettled?: (signal?: AbortSignal) => Promise<void>;
}) {
  const [receipt, setReceipt] = useState<TaskCommandReceipt | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(initiallyAttempted);
  const [expired, setExpired] = useState(false);
  const [accountChanged, setAccountChanged] = useState(false);
  const [receiptOwner, setReceiptOwner] = useState<string | undefined>(ownerId);
  useEffect(() => {
    if (receipt || cancelled || accountChanged) return;
    const check = () => setExpired(Date.now() >= Date.parse(proposal.expiresAt));
    check(); const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [proposal.expiresAt, receipt, cancelled, accountChanged]);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const beginRequest = useTaskRequestLifetime(() => { lock.current = false; setBusy(false); setAccountChanged(true); }, ownerId);
  const apply = async () => {
    if (lock.current || receipt || cancelled) return;
    lock.current = true; setBusy(true); setError('');
    const request = beginRequest();
    let acknowledged = false;
    try {
      await withinTaskWait(async signal => {
        await onAttempt?.(signal); checkTaskWait(signal);
        setAttempted(true);
        const result = await assistantCommandRequest({ decision: 'apply', proposal }, 0, ownerId, signal);
        checkTaskWait(signal);
        acknowledged = true; setReceiptOwner(result.clientOwnerId); setReceipt(result.receipt);
        await onSettled?.(signal); checkTaskWait(signal);
        await onChanged?.(); checkTaskWait(signal);
      }, request.signal, '저장 결과를 아직 확인하지 못했어요. 서버 처리는 계속될 수 있어요. 같은 요청으로 다시 확인하거나 실행 이력을 확인해 주세요.');
    } catch (failure) { if (!request.signal.aborted) setError(acknowledged ? '저장 결과는 확인됐어요. 화면 정리를 마치지 못했으니 실행 이력을 확인해 주세요.' : failure instanceof Error ? failure.message : '할 일 저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.'); }
    finally { if (!request.signal.aborted) { lock.current = false; setBusy(false); } }
  };
  const cancel = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    const request = beginRequest();
    try {
      await withinTaskWait(async signal => {
        await onSettled?.(signal); checkTaskWait(signal); setCancelled(true);
      }, request.signal, '확인 화면을 아직 닫지 못했어요. 잠시 뒤 다시 눌러 주세요.');
    }
    catch (failure) { if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : '확인 화면을 닫지 못했습니다.'); }
    finally { if (!request.signal.aborted) { lock.current = false; setBusy(false); } }
  };
  if (accountChanged) return <p role="alert">계정이 바뀌었어요. 이전 요청을 더 진행하지 않아요. 화면을 다시 열어 주세요.</p>;
  if (cancelled) return <p role="status" className="mt-3 text-gray-600">{attempted ? '확인 화면을 닫았습니다. 저장 여부는 실행 이력에서 확인해 주세요.' : '취소했습니다. 할 일은 변경하지 않았습니다.'}</p>;
  if (receipt) return <div className="mt-3">{error && <p role="alert" className="text-red-700">{error}</p>}<AssistantTaskReceipt receipt={receipt} ownerId={receiptOwner} onChanged={onChanged} /><Link href="/assistant/history" className="mt-2 inline-block font-bold text-violet-700">실행 이력 보기 →</Link></div>;
  return <section aria-label="할 일 변경 확인" className="mt-3 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-gray-800">
    <h3 className="font-bold">{proposal.operation === 'create' ? '할 일 추가 확인' : proposal.operation === 'complete' ? '할 일 완료 확인' : '할 일 수정 확인'}</h3>
    <p className="mt-1 break-words">{proposal.values.title}</p>
    <p className="mt-1 text-xs">프로젝트: {proposal.projectName || '연결 없음'}</p>
    <ChangeDetails before={proposal.expected} after={proposal.values} />
    {proposal.operation === 'complete' && <div className="mt-2 text-sm"><p>상태: {proposal.expected?.status === 'waiting' ? '대기' : proposal.expected?.status === 'in_progress' ? '진행 중' : '미완료'} → 완료</p><p>{proposal.values.recurrence_rule === 'none' ? '다음 반복 일정은 생성하지 않습니다.' : '기존 마감일(없으면 완료일)을 기준으로 다음 반복 일정 1건을 함께 만듭니다. 다음 일정이 수정되면 되돌리기를 막아 새 기록을 보호합니다.'}</p></div>}
    <p className="mt-2 text-xs text-gray-600">확인 화면은 15분간 유효합니다. 같은 탭에서 새로고침하거나 돌아오면 복구됩니다. 탭을 닫거나 로그아웃하면 복구되지 않을 수 있습니다.</p>
    {expired && <p role="status" className="mt-2 text-sm text-amber-800">확인 시간이 지났습니다. {attempted ? '같은 요청으로 저장 결과를 재확인할 수 있습니다. 저장되지 않은 요청은 새로 실행하지 않습니다.' : '저장하려면 명령을 다시 입력해 주세요.'}</p>}
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || (expired && !attempted)} onClick={() => void apply()} className="rounded-xl bg-violet-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? '저장 중…' : attempted ? '같은 요청으로 다시 확인' : '확인하고 저장'}</button>{<button type="button" disabled={busy} onClick={() => void cancel()} className="rounded-xl bg-white px-3 py-2 text-sm">{attempted ? '확인 화면 닫기' : '취소'}</button>}</div>
    {error && <div role="alert" className="mt-3 text-sm text-red-700"><p>{error}</p><Link href="/assistant/history" className="mt-2 inline-block underline">저장 여부를 실행 이력에서 확인</Link></div>}
  </section>;
}
