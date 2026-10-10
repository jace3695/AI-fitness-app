'use client';

import { useEffect, useRef, useState } from 'react';
import { WEIGHT_RECORDS_KEY, WeightRecordStore, getPreviousWeightRecord, isTodayKey, updateJson } from '../data/recordStorage';

import { captureStorageOwner, isStorageOwnerCurrent, StorageSessionChangedError, type StorageOwnerToken } from '../data/storageTransaction';
import { fitnessStorageError } from '../data/fitnessStorageUpdates';

interface Props { dateKey: string; weights: WeightRecordStore; onChange: (next: WeightRecordStore) => void }

export default function WeightRecordCard({ dateKey, weights, onChange }: Props) {
  const current = weights[dateKey];
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const pendingRef = useRef(false);
  const editorOwner = useRef<StorageOwnerToken | null>(null);
  const dirty = useRef(false);
  const draftDate = useRef(dateKey);
  const liveDate = useRef(dateKey);
  liveDate.current = dateKey;
  useEffect(() => {
    if (draftDate.current === dateKey && (dirty.current || pendingRef.current)) return;
    draftDate.current = dateKey;
    dirty.current = false;
    setValue(current?.weight ? current.weight.toFixed(1) : '');
    setMessage('');
    try { editorOwner.current = captureStorageOwner(); }
    catch (error) { editorOwner.current = null; setMessage(fitnessStorageError(error)); }
  }, [current?.weight, dateKey]);
  const previous = getPreviousWeightRecord(weights, dateKey);
  const diff = current && previous ? current.weight - previous[1].weight : null;
  const commit = async (remove: boolean) => {
    if (pendingRef.current) return;
    const weight = Math.round(Number(value) * 10) / 10;
    if (!remove && (!Number.isFinite(weight) || weight <= 0)) {
      setMessage('체중은 0보다 큰 숫자로 입력해주세요.');
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setMessage('');
    const savedDate = dateKey;
    try {
      const owner = editorOwner.current;
      if (!owner) throw new StorageSessionChangedError();
      const next = await updateJson<WeightRecordStore>(WEIGHT_RECORDS_KEY, {}, (current) => {
        const next = { ...current };
        if (remove) delete next[savedDate];
        else next[savedDate] = { ...next[savedDate], weight, recordedAt: new Date().toISOString() };
        return next;
      }, owner);
      if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError();
      if (liveDate.current === savedDate) {
        dirty.current = false;
        setValue(remove ? '' : weight.toFixed(1));
        setMessage(remove ? '체중 기록을 삭제했습니다.' : '체중 기록을 저장했습니다.');
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
    <fieldset disabled={pending} className="min-w-0" aria-busy={pending}><div className="flex items-start justify-between gap-3"><div><p className="text-[15px] font-bold text-gray-800">체중 기록</p><p className="mt-1 text-[12px] text-gray-500">선택 날짜 기준으로 kg 단위, 소수점 1자리까지 기록합니다.</p></div><span className="rounded-full bg-[#EEEDFE] px-2 py-1 text-[11px] font-bold text-[#534AB7]">kg</span></div>
    {isTodayKey(dateKey) && <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-[12px] text-blue-700">오늘 입력 시 아침 공복 체중 기준을 권장합니다.</p>}
    <div className="mt-3 flex gap-2"><input inputMode="decimal" value={value} onChange={(e) => { if (pendingRef.current) return; dirty.current = true; setValue(e.target.value); setMessage(''); }} placeholder="예: 82.4" className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-[14px]" /><button onClick={() => commit(false)} className="rounded-xl bg-[#534AB7] px-4 py-2 text-[13px] font-bold text-white">저장</button></div>
    {current && <div className="mt-3 rounded-xl bg-gray-50 p-3 text-[13px] text-gray-700"><p>현재 체중: <b>{current.weight.toFixed(1)}kg</b></p><p className="mt-1">이전 기록 대비: <b>{diff === null ? '이전 기록 없음' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)}kg`}</b></p><button onClick={() => commit(true)} className="mt-2 text-[12px] font-semibold text-red-600">삭제</button></div>}
    {message && <p role={(message.includes('저장했습니다') || message.includes('삭제했습니다')) ? 'status' : 'alert'} className="mt-2 text-[12px]">{message}</p>}
    </fieldset>
  </section>;
}
