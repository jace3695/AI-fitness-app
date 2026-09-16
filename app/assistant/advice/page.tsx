'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/supabase';
import { AREA_LABELS, type SavedAdvice } from '@/lib/chatgpt-connection';
import ZephyrReadButton from '@/components/ZephyrReadButton';

export default function ChatgptAdvicePage() {
  const [advice, setAdvice] = useState<SavedAdvice[]>([]); const [error, setError] = useState('');
  const [loading, setLoading] = useState(true); const [more, setMore] = useState(false); const lock = useRef(false);
  const load = useCallback(async (offset = 0) => {
    if (lock.current) return; lock.current = true; setLoading(true); setError('');
    try {
      const response = await authenticatedFetch(`/api/chatgpt/advice?offset=${offset}`, { cache: 'no-store' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setAdvice(current => offset ? [...current, ...data.advice].filter((item, index, rows) => rows.findIndex(row => row.id === item.id) === index) : data.advice);
      setMore(data.advice.length === 20);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '조언을 불러오지 못했습니다.'); }
    finally { lock.current = false; setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <main className="min-h-dvh bg-yeoni-bg px-4 pb-28 pt-6 text-gray-800"><div className="mx-auto max-w-2xl">
    <Link href="/assistant" className="text-sm font-bold text-violet-700">← 연이</Link>
    <h1 className="mt-5 text-2xl font-bold">ChatGPT가 남긴 조언</h1>
    <p className="mt-2 text-sm leading-6 text-gray-600">ChatGPT에서 분석한 뒤 연이에 저장해 달라고 요청한 조언입니다. 각 조언의 분석 시점을 확인해 주세요.</p>
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={loading} onClick={() => void load()} className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-violet-700 disabled:opacity-50">조언 새로고침</button>
      <Link href="/assistant/connect" className="rounded-xl bg-violet-100 px-4 py-3 text-sm font-bold text-violet-700">ChatGPT 연결 관리</Link></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    {!loading && !error && !advice.length && <p className="mt-5 rounded-2xl bg-white p-5">아직 저장한 ChatGPT 조언이 없습니다.</p>}
    <div className="mt-5 space-y-4">{advice.map(item => <article key={item.id} aria-label={`${item.title} 조언`} className="rounded-2xl border border-violet-100 bg-white p-5">
      <p className="text-xs font-bold text-violet-700">{AREA_LABELS[item.area]} · ChatGPT</p>
      <h2 className="mt-2 break-words text-lg font-bold">{item.title}</h2>
      <p className="mt-2 text-xs leading-5 text-gray-500">기록 조회: {new Date(item.snapshot_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}<br />분석 기간: {item.summary.start_date} ~ {item.summary.end_date}</p>
      <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">{item.body}</p>
      <ZephyrReadButton text={`${item.title}\n${item.body}`} />
      <details className="mt-4 rounded-xl bg-gray-50 p-3"><summary className="cursor-pointer text-sm font-bold">분석에 사용한 기록 요약</summary>
        <dl className="mt-3 space-y-2 text-sm">{Object.entries(item.summary.metrics).map(([label, value]) => <div className="flex flex-wrap justify-between gap-2" key={label}><dt>{label}</dt><dd className="font-bold">{Number(value).toLocaleString('ko-KR')}</dd></div>)}</dl>
        <p className="mt-3 text-xs leading-5 text-gray-500">{item.summary.notes.join(' ')}</p>
      </details>
    </article>)}</div>
    {loading && <p role="status" className="mt-4">저장한 조언을 불러오는 중…</p>}
    {more && <button type="button" disabled={loading} onClick={() => void load(advice.length)} className="mt-4 rounded-xl bg-white px-4 py-3 font-bold text-violet-700 disabled:opacity-50">이전 조언 더 보기</button>}
  </div></main>;
}
