'use client';

import { useEffect, useState } from 'react';
import { WEIGHT_RECORDS_KEY, WeightRecordStore, getPreviousWeightRecord, isTodayKey, writeJson } from '../data/recordStorage';

interface Props { dateKey: string; weights: WeightRecordStore; onChange: (next: WeightRecordStore) => void }

export default function WeightRecordCard({ dateKey, weights, onChange }: Props) {
  const current = weights[dateKey];
  const [value, setValue] = useState('');
  useEffect(() => setValue(current?.weight ? current.weight.toFixed(1) : ''), [current?.weight, dateKey]);
  const previous = getPreviousWeightRecord(weights, dateKey);
  const diff = current && previous ? current.weight - previous[1].weight : null;
  const save = () => {
    const weight = Math.round(Number(value) * 10) / 10;
    if (!Number.isFinite(weight) || weight <= 0) return;
    const next = { ...weights, [dateKey]: { weight, recordedAt: new Date().toISOString() } };
    writeJson(WEIGHT_RECORDS_KEY, next); onChange(next);
  };
  const remove = () => { const next = { ...weights }; delete next[dateKey]; writeJson(WEIGHT_RECORDS_KEY, next); onChange(next); };
  return <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[15px] font-bold text-gray-800">체중 기록</p><p className="mt-1 text-[12px] text-gray-500">선택 날짜 기준으로 kg 단위, 소수점 1자리까지 기록합니다.</p></div><span className="rounded-full bg-[#EEEDFE] px-2 py-1 text-[11px] font-bold text-[#534AB7]">kg</span></div>
    {isTodayKey(dateKey) && <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-[12px] text-blue-700">오늘 입력 시 아침 공복 체중 기준을 권장합니다.</p>}
    <div className="mt-3 flex gap-2"><input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="예: 82.4" className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-[14px]" /><button onClick={save} className="rounded-xl bg-[#534AB7] px-4 py-2 text-[13px] font-bold text-white">저장</button></div>
    {current && <div className="mt-3 rounded-xl bg-gray-50 p-3 text-[13px] text-gray-700"><p>현재 체중: <b>{current.weight.toFixed(1)}kg</b></p><p className="mt-1">이전 기록 대비: <b>{diff === null ? '이전 기록 없음' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)}kg`}</b></p><button onClick={remove} className="mt-2 text-[12px] font-semibold text-red-600">삭제</button></div>}
  </section>;
}
