'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { recurrenceLabel, type RecurrenceRule } from '@/app/lib/assistantRecurrence';
import { taskCommandDateLabel, type TaskCommandProposal, type TaskCommandReceipt } from '@/lib/assistant-task-command';

export async function assistantCommandRequest(body?: unknown, offset = 0, ownerId?: string) {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (!token) throw new Error('로그인이 필요합니다.');
  if (ownerId && session?.data.session?.user.id !== ownerId) throw new Error('로그인 계정이 변경됐습니다. 화면을 다시 열어 주세요.');
  const response = await fetch(`/api/assistant/commands${body ? '' : `?offset=${offset}`}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '실행 이력을 확인하지 못했습니다.');
  return result;
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

export function AssistantTaskReceipt({ receipt, onChanged }: { receipt: TaskCommandReceipt; onChanged?: () => void | Promise<void> }) {
  const [saved, setSaved] = useState(receipt);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const undo = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await assistantCommandRequest({ decision: 'undo', requestId: saved.id });
      setSaved(result.receipt); setConfirmUndo(false);
      await onChanged?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '되돌리기를 확인하지 못했습니다. 다시 시도해 주세요.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <article aria-label={`${saved.after_record.title} 실행 이력`} className="rounded-2xl border border-violet-100 bg-white p-4 text-sm text-gray-800">
    <p className="font-bold break-words">{saved.after_record.title}</p>
    <p role="status" className="mt-1 text-xs text-violet-700">{saved.undone_at ? '되돌리기 완료' : saved.operation === 'create' ? '할 일 추가 완료' : '할 일 수정 완료'} · {taskCommandDateLabel(saved.created_at)}</p>
    <ChangeDetails before={saved.before_record} after={saved.after_record} />
    {!saved.undone_at && (confirmUndo ? <div className="mt-3 rounded-xl bg-amber-50 p-3">
      <p>{saved.operation === 'create' ? '이 명령으로 추가한 할 일을 삭제할까요?' : '마감일·우선순위·반복을 변경 전으로 되돌릴까요?'}</p>
      <p className="mt-1 text-xs text-gray-600">이후에 수정된 기록은 되돌리지 않습니다.</p>
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void undo()} className="rounded-xl bg-violet-700 px-3 py-2 font-bold text-white disabled:opacity-50">{busy ? '처리 중…' : '확인하고 되돌리기'}</button><button type="button" disabled={busy} onClick={() => setConfirmUndo(false)} className="rounded-xl bg-white px-3 py-2">유지하기</button></div>
    </div> : <button type="button" onClick={() => setConfirmUndo(true)} className="mt-3 rounded-xl bg-violet-50 px-3 py-2 font-bold text-violet-800">이 변경 되돌리기</button>)}
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
  </article>;
}

export function AssistantTaskReview({ proposal, onChanged, ownerId, initiallyAttempted = false, onAttempt, onSettled }: {
  proposal: TaskCommandProposal; onChanged?: () => void | Promise<void>; ownerId?: string;
  initiallyAttempted?: boolean; onAttempt?: () => Promise<void>; onSettled?: () => Promise<void>;
}) {
  const [receipt, setReceipt] = useState<TaskCommandReceipt | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(initiallyAttempted);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (receipt || cancelled) return;
    const check = () => setExpired(Date.now() >= Date.parse(proposal.expiresAt));
    check(); const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [proposal.expiresAt, receipt, cancelled]);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const apply = async () => {
    if (lock.current || cancelled || receipt) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await onAttempt?.();
      setAttempted(true);
      const result = await assistantCommandRequest({ decision: 'apply', proposal }, 0, ownerId);
      setReceipt(result.receipt);
      await onSettled?.();
      await onChanged?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도하거나 실행 이력을 확인해 주세요.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const cancel = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await onSettled?.(); setCancelled(true); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '닫지 못했습니다.'); }
    finally { lock.current = false; setBusy(false); }
  };
  if (cancelled) return <p role="status" className="mt-3 text-gray-600">{attempted ? '확인 화면을 닫았습니다. 저장 여부는 실행 이력에서 확인해 주세요.' : '취소했습니다. 할 일은 변경하지 않았습니다.'}</p>;
  if (receipt) return <div className="mt-3">{error && <p role="alert" className="text-red-700">{error}</p>}<AssistantTaskReceipt receipt={receipt} onChanged={onChanged} /><Link href="/assistant/history" className="mt-2 inline-block font-bold text-violet-700">실행 이력 보기 →</Link></div>;
  return <section aria-label="할 일 변경 확인" className="mt-3 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-gray-800">
    <h3 className="font-bold">{proposal.operation === 'create' ? '할 일 추가 확인' : '할 일 수정 확인'}</h3>
    <p className="mt-1 break-words">{proposal.values.title}</p>
    <p className="mt-1 text-xs">프로젝트: {proposal.projectName || '연결 없음'}</p>
    <ChangeDetails before={proposal.expected} after={proposal.values} />
    <p className="mt-2 text-xs text-gray-600">확인 화면은 15분간 유효합니다. 같은 탭에서 새로고침하거나 돌아오면 복구됩니다. 탭을 닫거나 로그아웃하면 복구되지 않을 수 있습니다.</p>
    {expired && <p role="status" className="mt-2 text-sm text-amber-800">확인 시간이 지났습니다. {attempted ? '같은 요청으로 저장 결과를 재확인할 수 있습니다. 저장되지 않은 요청은 새로 실행하지 않습니다.' : '저장하려면 명령을 다시 입력해 주세요.'}</p>}
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || (expired && !attempted)} onClick={() => void apply()} className="rounded-xl bg-violet-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? '저장 중…' : attempted ? '같은 요청으로 다시 확인' : '확인하고 저장'}</button>{<button type="button" disabled={busy} onClick={() => void cancel()} className="rounded-xl bg-white px-3 py-2 text-sm">{attempted ? '확인 화면 닫기' : '취소'}</button>}</div>
    {error && <div role="alert" className="mt-3 text-sm text-red-700"><p>{error}</p><Link href="/assistant/history" className="mt-2 inline-block underline">저장 여부를 실행 이력에서 확인</Link></div>}
  </section>;
}
