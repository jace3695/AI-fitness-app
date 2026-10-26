'use client';

import { useState } from 'react';
import { INBODY_RECORDS_KEY, type InbodyRecord, type InbodyRecordStore } from '../data/recordStorage';
import { bodyImportOwner } from '../lib/bodyImport';
import { correctOaSourceDevice, oaCorrectionKeys, OA_CORRECTION_FIELDS } from '../lib/oaSourceCorrection';
import { notifyRecordsChanged, recoverStorageTransaction, writeStorageBatch } from '../data/storageTransaction';

export default function OaSourceCorrection({ dateKey, record, onSaved }: {
  dateKey: string; record: InbodyRecord; onSaved: (records: InbodyRecordStore) => void;
}) {
  const [review, setReview] = useState<{ owner: string; snapshot: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const keys = oaCorrectionKeys(record);
  if (!keys.length) return null;
  function openReview() {
    try {
      const owner = bodyImportOwner(window.localStorage);
      const snapshot = JSON.stringify(record);
      setReview({ owner, snapshot }); setConfirmed(false); setMessage('');
    } catch {
      setReview(null); setConfirmed(false);
      setMessage('기록을 읽지 못했어요. 기존 기록은 바꾸지 않았어요. 저장 공간 접근을 확인한 뒤 다시 눌러 주세요.');
    }
  }
  function save() {
    if (!review || !confirmed) return;
    try {
      const storage = window.localStorage;
      if (review.owner !== bodyImportOwner(storage)) {
        setReview(null); setConfirmed(false); setMessage('계정이나 기록이 바뀌었어요. 다시 확인해 주세요.'); return;
      }
      // Recover interrupted writes before comparing or composing the next snapshot.
      recoverStorageTransaction(storage);
      const records = JSON.parse(storage.getItem(INBODY_RECORDS_KEY) || '{}') as InbodyRecordStore;
      if (review.owner !== bodyImportOwner(storage) || JSON.stringify(records[dateKey]) !== review.snapshot
        || JSON.stringify(record) !== review.snapshot) {
        setReview(null); setConfirmed(false); setMessage('계정이나 기록이 바뀌었어요. 다시 확인해 주세요.'); return;
      }
      const next = { ...records, [dateKey]: correctOaSourceDevice(records[dateKey]) };
      writeStorageBatch(storage, { [INBODY_RECORDS_KEY]: JSON.stringify(next) });
      setReview(null); setConfirmed(false); onSaved(next); notifyRecordsChanged();
    } catch { setMessage('기기 정보를 저장하지 못했어요. 저장 공간과 기록을 확인한 뒤 다시 시도해 주세요.'); }
  }
  return <section aria-label="저장된 OA 기기 정보 정정" className="mt-3 rounded border p-3 text-sm">
    <p>원본이 PRO 보고서인 기록의 기기 정보를 정정할 수 있어요. 날짜·수치·메모는 유지해요.</p>
    {!review ? <button type="button" className="min-h-11 underline" onClick={openReview}>기기 정보 정정 검토</button> : <>
      <p>{dateKey} · OA long report → OA Smart Scale PRO</p>
      <ul>{OA_CORRECTION_FIELDS.filter(([key]) => keys.includes(key)).map(([key, label, unit]) =>
        <li key={key}>{label} · {unit} · {record.metricSources?.[key]?.mappingVersion}</li>)}</ul>
      <p>위 항목만 변경해요. 출처·단위·매핑 버전이 누락되거나 일치하지 않는 항목은 제외해요.</p>
      <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>
        이 날짜의 원본이 OA Smart Scale PRO 긴 건강보고서임을 직접 확인했어요.</label>
      <button type="button" disabled={!confirmed} onClick={save} className="min-h-11 rounded border px-3 disabled:opacity-50">기기 정보만 저장</button>
      <button type="button" onClick={() => { setReview(null); setConfirmed(false); setMessage(''); }} className="min-h-11 px-3">정정 취소</button>
    </>}
    {message && <p role="alert">{message}</p>}
  </section>;
}
