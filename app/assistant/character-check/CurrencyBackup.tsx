'use client';

import { useRef, useState } from 'react';
import { readCurrencyBackup } from '@/lib/yeoni/currency-backup';
import plan from '@/services/yeoni-alignment/currency-validation-plan.json';

const approved = { ...plan.cases[0], voice: plan.voice };

export default function CurrencyBackup() {
  const [backup, setBackup] = useState<ReturnType<typeof readCurrencyBackup> | null>(null);
  const [message, setMessage] = useState('원래 음성 탭을 열어 둔 채, 아래 버튼으로 저장된 결과를 확인해 주세요.');
  const textArea = useRef<HTMLTextAreaElement>(null);

  function load() {
    try {
      const result = readCurrencyBackup(localStorage, approved);
      setBackup(result);
      setMessage('저장된 금액 음성을 찾았어요. 아래 내용을 복사해 이 Work 대화에 보내 주세요. 백업 완료 여부는 받은 파일을 확인한 뒤 안내해 드려요.');
    } catch (error) {
      setMessage(error instanceof Error && error.name === 'Error' ? error.message
        : '브라우저 저장소를 읽지 못했어요. 원래 음성 탭을 열어 둔 채 이 메시지를 알려 주세요.');
    }
  }

  function selectText() {
    textArea.current?.focus();
    textArea.current?.select();
  }

  async function copy() {
    if (!backup) return;
    try {
      await navigator.clipboard.writeText(backup.json);
      setMessage('복사했어요. 이 Work 대화에 붙여넣어 보내 주세요. 붙여넣기가 안 되면 아래 전체 선택 버튼을 사용해 주세요.');
    } catch {
      selectText();
      setMessage('자동 복사가 허용되지 않았어요. 선택된 내용을 Ctrl+C(맥은 ⌘C)로 복사해 주세요. 복사할 수 없다면 이 화면을 알려 주세요.');
    }
  }

  return <>
    <h1 className="text-2xl font-bold">금액 음성 백업</h1>
    <p className="my-4 leading-7">이미 생성한 “{approved.text}”의 저장 결과를 텍스트로 꺼내요.
      원래 음성 탭은 백업이 끝날 때까지 닫거나 새로고침하지 마세요.</p>
    <p className="mb-4 text-sm leading-6">새 음성 생성이나 정렬을 요청하지 않으며, 저장 데이터와 중복 생성 방지 기록을 변경하지 않아요.</p>
    <button type="button" onClick={load} disabled={backup !== null}
      className="min-h-11 rounded-xl bg-violet-700 p-3 text-white disabled:opacity-50">저장된 금액 음성 확인</button>
    <p role="status" className="my-4 break-words leading-7">{message}</p>
    {backup ? <section className="min-w-0 rounded-2xl border bg-white p-4">
      <h2 className="font-bold">복사할 백업 내용</h2>
      <p className="my-3 text-sm">음성 {backup.audioBytes.toLocaleString()}바이트 · 백업 내용 {backup.json.length.toLocaleString()}자</p>
      <div className="mb-3 flex flex-wrap gap-3">
        <button type="button" onClick={() => void copy()} className="min-h-11 rounded-xl border p-3">백업 내용 복사</button>
        <button type="button" onClick={() => { selectText(); setMessage('전체 내용을 선택했어요. Ctrl+C(맥은 ⌘C)로 복사해 이 Work 대화에 보내 주세요.'); }}
          className="min-h-11 rounded-xl border p-3">전체 선택</button>
      </div>
      <label htmlFor="currency-backup-json" className="mb-2 block text-sm">금액 음성 원본 JSON (읽기 전용)</label>
      <textarea id="currency-backup-json" ref={textArea} readOnly value={backup.json} rows={10} spellCheck={false}
        className="block w-full min-w-0 rounded-lg border p-3 font-mono text-xs" />
    </section> : null}
  </>;
}
