"use client";

import { useRef, useState } from 'react';
import type { GrowthResourceRow } from '@/app/data/growthPlatform';
import { confirmResourceUsage, resourceToday, resourceUsage, saveResourceUsage, validResourceUsageDate } from '@/app/data/growthResourceUsage';
import { supabase } from '@/app/lib/supabase';

type Props = {
  resource: GrowthResourceRow;
  owner: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onRow: (row: GrowthResourceRow) => void;
  onNotice: (notice: string) => void;
};

export default function GrowthResourceUsage({ resource, owner, disabled, onBusy, onRow, onNotice }: Props) {
  const [mode, setMode] = useState<'edit' | 'review' | 'uncertain' | null>(null);
  const [previous, setPrevious] = useState(resource);
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const working = useRef(false);
  const today = resourceToday();
  const usage = resourceUsage(resource.last_used_on, today);
  const available = Object.hasOwn(resource, 'last_used_on');
  const desired = date || null;
  const run = async (confirmOnly: boolean) => {
    if (!supabase || disabled || working.current) return;
    working.current = true;
    onBusy(true);
    setError('');
    const result = confirmOnly
      ? await confirmResourceUsage(supabase, owner, resource.id, desired)
      : await saveResourceUsage(supabase, owner, previous, desired);
    if (result.kind === 'confirmed') {
      onRow(result.row); setMode(null);
      onNotice(`${resource.title}: ${desired ? `마지막 활용일 ${desired}` : '활용일 미기록'}으로 확인했어요.`);
    } else if (result.kind === 'changed') {
      onRow(result.row); setMode(null);
      onNotice('저장한 값과 달라요. 다른 곳에서 변경했거나 저장되지 않았을 수 있어요. 최신 내용을 확인하고 다시 입력해 주세요.');
    } else if (result.kind === 'uncertain') {
      setMode('uncertain'); setError('저장 결과를 확인하지 못했어요. 연결이 돌아오면 결과를 다시 확인해 주세요.');
    } else if (result.kind === 'missing') {
      setMode(null); onNotice('자료를 찾을 수 없어요. 자료 목록을 새로고침해 주세요.');
    } else {
      setMode('edit'); setError('한국 날짜 기준 오늘까지의 올바른 날짜를 입력해 주세요.');
    }
    working.current = false;
    onBusy(false);
  };

  return <div className="mt-4 border-t border-gray-200 pt-3 text-xs">
    <p className="font-semibold text-gray-600">{usage.label}</p>
    {usage.kind === 'revisit' && <p className="mt-1 leading-5 text-amber-800">기록한 활용일로부터 {usage.days}일 지났어요. 다시 살펴볼까요?</p>}
    {!available ? <p className="mt-2 text-gray-500">활용일 기록을 준비 중이에요.</p> : mode === null ? <button disabled={disabled} onClick={() => { setPrevious(resource); setDate(resource.last_used_on ?? today); setError(''); setMode('edit'); }} className="mt-2 min-h-10 rounded-xl bg-white px-3 font-bold text-emerald-700 ring-1 ring-gray-200 disabled:opacity-50">활용일 기록·수정</button> : <div className="mt-3 rounded-xl bg-white p-3 ring-1 ring-gray-200">
      {mode === 'edit' ? <>
        <label className="block font-bold" htmlFor={`usage-${resource.id}`}>마지막 활용일</label>
        <input id={`usage-${resource.id}`} aria-label={`${resource.title} 마지막 활용일`} type="date" min="1900-01-01" max={today} value={date} onChange={event => { setDate(event.target.value); setError(''); }} disabled={disabled} className="mt-2 min-h-11 w-full min-w-0 rounded-lg bg-gray-50 p-2 ring-1 ring-gray-200" />
        <p className="mt-2 leading-5 text-gray-500">직접 활용한 날짜를 입력해 주세요. 날짜를 비우면 미기록으로 돌아가요. 기준: 한국 날짜</p>
        <button disabled={disabled} onClick={() => { if (!validResourceUsageDate(desired, today)) { setError('오늘까지의 올바른 날짜를 입력해 주세요.'); return; } setError(''); setMode('review'); }} className="mt-2 min-h-10 rounded-lg bg-emerald-600 px-3 font-bold text-white">변경 내용 확인</button>
      </> : mode === 'review' ? <>
        <p className="font-bold">활용일 변경 확인</p>
        <p className="mt-2 break-words leading-5">이전: {previous.last_used_on ?? '미기록'} → 변경: {desired ?? '미기록'}</p>
        <p className="mt-1 leading-5 text-gray-500">{resource.title}의 마지막 활용일을 저장해요.</p>
        <button disabled={disabled} onClick={() => void run(false)} className="mt-2 min-h-10 rounded-lg bg-emerald-600 px-3 font-bold text-white disabled:opacity-50">{disabled ? '확인 중…' : '확인 후 저장'}</button>
      </> : <button disabled={disabled} onClick={() => void run(true)} className="min-h-10 rounded-lg bg-emerald-600 px-3 font-bold text-white disabled:opacity-50">저장 결과 다시 확인</button>}
      {mode !== 'uncertain' && <button disabled={disabled} onClick={() => { setMode(null); setError(''); }} className="ml-2 min-h-10 px-3 text-gray-600">취소</button>}
      {error && <p role="alert" className="mt-2 leading-5 text-amber-800">{error}</p>}
    </div>}
  </div>;
}
