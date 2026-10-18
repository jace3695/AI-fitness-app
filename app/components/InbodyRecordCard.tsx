'use client';

import { useEffect, useState } from 'react';
import { mergeBodyFields } from '../lib/bodyImport';
import { INBODY_RECORDS_KEY, InbodyRecord, InbodyRecordStore, writeJson } from '../data/recordStorage';
import { OA_REPORT_INVENTORY } from '../lib/oaReportInventory';

const fields: { key: keyof InbodyRecord; label: string; unit: string }[] = [
  { key: 'weight', label: '체중', unit: 'kg' }, { key: 'skeletalMuscleMass', label: '골격근량', unit: 'kg' }, { key: 'bodyFatMass', label: '체지방량', unit: 'kg' }, { key: 'bodyFatPercent', label: '체지방률', unit: '%' }, { key: 'visceralFatLevel', label: '내장지방레벨', unit: '' }, { key: 'basalMetabolicRate', label: '기초대사량', unit: 'kcal' },
];
interface Props { dateKey: string; records: InbodyRecordStore; onChange: (next: InbodyRecordStore) => void }
export default function InbodyRecordCard({ dateKey, records, onChange }: Props) {
  const current = records[dateKey];
  const [form, setForm] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  useEffect(() => {
    const next: Record<string, string> = { memo: current?.memo || '' };
    fields.forEach((field) => { const value = current?.[field.key]; next[field.key] = typeof value === 'number' ? String(value) : ''; });
    setForm(next);
  }, [current, dateKey]);
  const save = () => {
    try {
    // The weight may live in the separate weight store. An untouched empty input
    // must not erase its source metadata or any field owned by the full editor.
    const patch = Object.fromEntries(fields.filter(({key}) => (form[key] || '') !== String(current?.[key] ?? '')).map(({key}) => [key, form[key] || '']));
    const record = mergeBodyFields(current, { ...patch, memo: form.memo || '' });
    const next = { ...records, [dateKey]: record };
    if (!Object.keys(record).length) delete next[dateKey];
    writeJson(INBODY_RECORDS_KEY, next); onChange(next);
    setMessage('저장했습니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '저장하지 못했습니다.'); }
  };
  const remove = () => { const next = { ...records }; delete next[dateKey]; writeJson(INBODY_RECORDS_KEY, next); onChange(next); };
  return <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
    <p className="text-[15px] font-bold text-gray-800">인바디 기록</p><p className="mt-1 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-700">인바디는 주 1회 또는 2주 1회 정도 같은 조건에서 측정하는 것을 권장합니다.</p>
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{fields.map((field) => <label key={field.key} className="text-[12px] font-semibold text-gray-600">{field.label}<div className="mt-1 flex items-center gap-1 rounded-xl border border-gray-200 px-2"><input inputMode="decimal" value={form[field.key] || ''} onChange={(e) => setForm({ ...form, [field.key]: e.target.value })} className="min-w-0 flex-1 py-2 text-[13px] outline-none" /><span className="text-[11px] text-gray-400">{field.unit}</span></div></label>)}</div>
    <textarea value={form.memo || ''} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="인바디 메모" className="mt-3 min-h-20 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px]" />
    <details className="mt-3 text-sm"><summary>사진에서 보존한 원문 기록</summary><p>이 간단 편집 화면에서 제공하지 않는 항목도 저장할 때 유지합니다. 원문 수정은 체중 기록 화면에서 할 수 있어요.</p><ul>{OA_REPORT_INVENTORY.map(([key, label, unit]) => {
      const value = key === 'measurementDate' ? dateKey : current?.[key];
      const source = current?.metricSources?.[key];
      return value === undefined ? null : <li key={key}>{label}: {value} {key === 'reportedBodyAge' ? current?.reportedBodyAgeUnit : unit}{source && <> · {source.device} · 원문: {source.originalLabel} {source.originalText}</>}</li>;
    })}</ul></details>
    <div className="mt-2 flex gap-2"><button onClick={save} className="flex-1 rounded-xl bg-[#534AB7] px-4 py-2 text-[13px] font-bold text-white">저장</button>{current && <button onClick={remove} className="rounded-xl bg-red-50 px-4 py-2 text-[13px] font-bold text-red-600">삭제</button>}</div>
    {message && <p role="status">{message}</p>}
  </section>;
}
