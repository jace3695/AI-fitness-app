'use client';

import { useEffect, useRef, useState } from 'react';
import { INBODY_RECORDS_KEY, InbodyRecord, InbodyRecordStore, updateJson } from '../data/recordStorage';

import { captureStorageOwner, isStorageOwnerCurrent, StorageSessionChangedError, type StorageOwnerToken } from '../data/storageTransaction';
import { fitnessStorageError } from '../data/fitnessStorageUpdates';

const fields: { key: keyof InbodyRecord; label: string; unit: string }[] = [
  { key: 'weight', label: '체중', unit: 'kg' }, { key: 'skeletalMuscleMass', label: '골격근량', unit: 'kg' }, { key: 'bodyFatMass', label: '체지방량', unit: 'kg' }, { key: 'bodyFatPercent', label: '체지방률', unit: '%' }, { key: 'visceralFatLevel', label: '내장지방레벨', unit: '' }, { key: 'basalMetabolicRate', label: '기초대사량', unit: 'kcal' },
];
interface Props { dateKey: string; records: InbodyRecordStore; onChange: (next: InbodyRecordStore) => void }
export default function InbodyRecordCard({ dateKey, records, onChange }: Props) {
  const current = records[dateKey];
  const [form, setForm] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const pendingRef = useRef(false);
  const editorOwner = useRef<StorageOwnerToken | null>(null);
  const dirtyFields = useRef(new Set<string>());
  const draftDate = useRef(dateKey);
  const liveDate = useRef(dateKey);
  liveDate.current = dateKey;
  useEffect(() => {
    if (draftDate.current === dateKey && (dirtyFields.current.size || pendingRef.current)) return;
    draftDate.current = dateKey;
    dirtyFields.current.clear();
    setMessage('');
    const next: Record<string, string> = { memo: current?.memo || '' };
    fields.forEach((field) => { const value = current?.[field.key]; next[field.key] = typeof value === 'number' ? String(value) : ''; });
    setForm(next);
    try { editorOwner.current = captureStorageOwner(); }
    catch (error) { editorOwner.current = null; setMessage(fitnessStorageError(error)); }
  }, [current, dateKey]);
  const commit = async (remove: boolean) => {
    if (pendingRef.current) return;
    const invalid = fields.some(({ key }) => (form[key] ?? '').trim() && !Number.isFinite(Number(form[key])));
    if (!remove && invalid) { setMessage('인바디 값을 숫자로 확인해주세요.'); return; }
    const editedFields = new Set(dirtyFields.current);
    const savedDate = dateKey;
    pendingRef.current = true;
    setPending(true);
    setMessage('');
    try {
      const owner = editorOwner.current;
      if (!owner) throw new StorageSessionChangedError();
      const next = await updateJson<InbodyRecordStore>(INBODY_RECORDS_KEY, {}, (current) => {
        const next = { ...current };
        if (remove) delete next[savedDate];
        else {
          const record = { ...next[savedDate] };
          fields.forEach(({ key }) => {
            if (!editedFields.has(key)) return;
            const input = (form[key] ?? '').trim();
            if (input) record[key] = Number(input) as never;
            else delete record[key];
          });
          if (editedFields.has('memo')) {
            if (form.memo?.trim()) record.memo = form.memo.trim();
            else delete record.memo;
          }
          if (Object.keys(record).length) next[savedDate] = record;
          else delete next[savedDate];
        }
        return next;
      }, owner);
      if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError();
      if (liveDate.current === savedDate) {
        dirtyFields.current.clear();
        if (remove) setForm({});
        setMessage(remove ? '인바디 기록을 삭제했습니다.' : '인바디 기록을 저장했습니다.');
      }
      onChange(next);
    } catch (error) {
      if (liveDate.current === savedDate) setMessage(fitnessStorageError(error));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
    <fieldset disabled={pending} className="min-w-0" aria-busy={pending}><p className="text-[15px] font-bold text-gray-800">인바디 기록</p><p className="mt-1 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-700">인바디는 주 1회 또는 2주 1회 정도 같은 조건에서 측정하는 것을 권장합니다.</p>
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{fields.map((field) => <label key={field.key} className="text-[12px] font-semibold text-gray-600">{field.label}<div className="mt-1 flex items-center gap-1 rounded-xl border border-gray-200 px-2"><input inputMode="decimal" value={form[field.key] || ''} onChange={(e) => { if (pendingRef.current) return; dirtyFields.current.add(field.key); setForm({ ...form, [field.key]: e.target.value }); setMessage(''); }} className="min-w-0 flex-1 py-2 text-[13px] outline-none" /><span className="text-[11px] text-gray-400">{field.unit}</span></div></label>)}</div>
    <textarea value={form.memo || ''} onChange={(e) => { if (pendingRef.current) return; dirtyFields.current.add('memo'); setForm({ ...form, memo: e.target.value }); setMessage(''); }} placeholder="인바디 메모" className="mt-3 min-h-20 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px]" />
    <div className="mt-2 flex gap-2"><button onClick={() => commit(false)} className="flex-1 rounded-xl bg-[#534AB7] px-4 py-2 text-[13px] font-bold text-white">저장</button>{current && <button onClick={() => commit(true)} className="rounded-xl bg-red-50 px-4 py-2 text-[13px] font-bold text-red-600">삭제</button>}</div>
    {message && <p role={(message.includes('저장했습니다') || message.includes('삭제했습니다')) ? 'status' : 'alert'} className="mt-2 text-[12px]">{message}</p>}
    </fieldset>
  </section>;
}
