'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { assistantCommandRequest, AssistantTaskReceipt } from '@/components/AssistantTaskCommand';
import { useSearchParams } from 'next/navigation';
import { AssistantBudgetHistory } from '@/components/AssistantBudgetCommand';
import { AssistantLanguageHistory } from '@/components/AssistantLanguageCommand';
import type { TaskCommandReceipt } from '@/lib/assistant-task-command';

function TaskHistory() {
  const [history, setHistory] = useState<TaskCommandReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const lock = useRef(false);
  const load = useCallback(async (offset = 0) => {
    if (lock.current) return;
    lock.current = true; setLoading(true); setError('');
    try {
      const result = await assistantCommandRequest(undefined, offset);
      setHistory(current => offset ? [...current, ...result.history].filter((row, index, rows) => rows.findIndex(other => other.id === row.id) === index) : result.history);
      setHasMore(result.history.length === 20);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '이력을 불러오지 못했습니다.'); }
    finally { lock.current = false; setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section aria-label="할 일 실행 이력 목록">
    <p className="mt-2 text-sm leading-6 text-gray-600">연이 대화·빠른 명령에서 확인하고 저장한 할 일 추가·수정 이력입니다. 변경 전후를 확인하고 되돌릴 수 있어요.</p>
    <button type="button" disabled={loading} onClick={() => void load()} className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-bold text-violet-700 disabled:opacity-50">이력 새로고침</button>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    {!loading && !error && !history.length && <p className="mt-5 rounded-2xl bg-white p-5">아직 확인하고 실행한 명령이 없습니다.</p>}
    <div className="mt-4 space-y-4">{history.map(receipt => <AssistantTaskReceipt key={`${receipt.id}:${receipt.undone_at}`} receipt={receipt} onChanged={() => load()} />)}</div>
    {loading && <p role="status" className="mt-4">실행 이력을 불러오는 중…</p>}
    {hasMore && <button type="button" disabled={loading} onClick={() => void load(history.length)} className="mt-4 rounded-xl bg-white px-4 py-3 font-bold text-violet-700 disabled:opacity-50">이전 이력 더 보기</button>}
  </section>;
}

function HistoryContent() {
  const search = useSearchParams();
  const budget = search.get('area') === 'budget';
  const language = search.get('area') === 'language';
  return <main className="min-h-dvh bg-yeoni-bg px-4 pb-28 pt-6 text-gray-800"><div className="mx-auto max-w-2xl">
    <Link href="/assistant" className="text-sm font-bold text-violet-700">← 연이</Link>
    <h1 className="mt-5 text-2xl font-bold">연이 실행 이력</h1>
    <nav aria-label="실행 이력 영역" className="my-4 flex flex-wrap gap-2">
      <Link href="/assistant/history" aria-current={!budget && !language ? 'page' : undefined} className={`rounded-xl px-4 py-2 font-bold ${!budget && !language ? 'bg-violet-700 text-white' : 'bg-white text-violet-700'}`}>할 일</Link>
      <Link href="/assistant/history?area=budget" aria-current={budget ? 'page' : undefined} className={`rounded-xl px-4 py-2 font-bold ${budget ? 'bg-violet-700 text-white' : 'bg-white text-violet-700'}`}>가계부</Link>
      <Link href="/assistant/history?area=language" aria-current={language ? 'page' : undefined} className={`rounded-xl px-4 py-2 font-bold ${language ? 'bg-violet-700 text-white' : 'bg-white text-violet-700'}`}>일본어</Link>
    </nav>
    {budget ? <AssistantBudgetHistory /> : language ? <AssistantLanguageHistory /> : <TaskHistory />}
  </div></main>;
}
export default function AssistantHistoryPage() {
  return <Suspense fallback={<p role="status">실행 이력을 준비하는 중…</p>}><HistoryContent /></Suspense>;
}
