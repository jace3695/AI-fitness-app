'use client';

import { useEffect, useState } from 'react';
import { INBODY_RECORDS_KEY, InbodyRecord, InbodyRecordStore, writeJson } from '../data/recordStorage';

const fields: { key: keyof InbodyRecord; label: string; unit: string }[] = [
  { key: 'weight', label: '체중', unit: 'kg' }, { key: 'skeletalMuscleMass', label: '골격근량', unit: 'kg' }, { key: 'bodyFatMass', label: '체지방량', unit: 'kg' }, { key: 'bodyFatPercent', label: '체지방률', unit: '%' }, { key: 'visceralFatLevel', label: '내장지방레벨', unit: '' }, { key: 'basalMetabolicRate', label: '기초대사량', unit: 'kcal' },
];
interface Props { dateKey: string; records: InbodyRecordStore; onChange: (next: InbodyRecordStore) => void }
export default function InbodyRecordCard({ dateKey, records, onChange }: Props) {
  const current = records[dateKey];
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = { memo: current?.memo || '' };
    fields.forEach((field) => { const value = current?.[field.key]; next[field.key] = typeof value === 'number' ? String(value) : ''; });
    setForm(next);
  }, [current, dateKey]);
  const save = () => {
    const record: InbodyRecord = {};
    fields.forEach((field) => { const parsed = Number(form[field.key]); if (form[field.key] !== '' && Number.isFinite(parsed)) record[field.key] = parsed as never; });
    if (form.memo?.trim()) record.memo = form.memo.trim();
    const next = { ...records, [dateKey]: record };
    if (!Object.keys(record).length) delete next[dateKey];
    writeJson(INBODY_RECORDS_KEY, next); onChange(next);
  };
  const remove = () => { const next = { ...records }; delete next[dateKey]; writeJson(INBODY_RECORDS_KEY, next); onChange(next); };
  return <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
    <p className="text-[15px] font-bold text-gray-800">인바디 기록</p><p className="mt-1 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-700">인바디는 주 1회 또는 2주 1회 정도 같은 조건에서 측정하는 것을 권장합니다.</p>
    <div className="mt-3 grid grid-cols-2 gap-2">{fields.map((field) => <label key={field.key} className="text-[12px] font-semibold text-gray-600">{field.label}<div className="mt-1 flex items-center gap-1 rounded-xl border border-gray-200 px-2"><input inputMode="decimal" value={form[field.key] || ''} onChange={(e) => setForm({ ...form, [field.key]: e.target.value })} className="min-w-0 flex-1 py-2 text-[13px] outline-none" /><span className="text-[11px] text-gray-400">{field.unit}</span></div></label>)}</div>
    <textarea value={form.memo || ''} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="인바디 메모" className="mt-3 min-h-20 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px]" />
    <div className="mt-2 flex gap-2"><button onClick={save} className="flex-1 rounded-xl bg-[#534AB7] px-4 py-2 text-[13px] font-bold text-white">저장</button>{current && <button onClick={remove} className="rounded-xl bg-red-50 px-4 py-2 text-[13px] font-bold text-red-600">삭제</button>}</div>
  </section>;
}
