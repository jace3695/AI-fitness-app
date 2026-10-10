'use client';

import { useMemo, useRef, useState } from 'react';
import ReplyCharacterPanel from '@/components/yeoni/ReplyCharacterPanel';
import { CURRENCY_IMPORT_MAX_BYTES, parseCurrencyPlaybackFile } from '@/lib/yeoni/currency-import';
import { buildReplyPlan } from '@/lib/yeoni/reply-plan';
import plan from '@/services/yeoni-alignment/currency-validation-plan.json';

const approved = { ...plan.cases[0], voice: plan.voice };
type PlaybackFile = Awaited<ReturnType<typeof parseCurrencyPlaybackFile>>;

export default function CurrencyFileReview() {
  const [file, setFile] = useState<PlaybackFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState('보관한 정렬 포함 JSON 파일을 선택해 주세요.');
  const locked = useRef(false);
  const playback = useMemo(() => file ? {
    clips: [{ manifest: file.manifest, async load() { return { bytes: file.audio, mime: 'audio/mpeg' }; } }],
    incoming: { value: { reply: file.text, performance: buildReplyPlan(file.text, `approved-${approved.id}`) } },
  } : null, [file]);

  async function load(selected: File) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(false); setMessage('백업의 원본 음성과 정렬 정보를 확인하고 있어요.');
    try {
      if (!selected.size || selected.size > CURRENCY_IMPORT_MAX_BYTES) throw new Error('금액 음성 백업 JSON 파일(128KB 이하)을 선택해 주세요.');
      const next = await parseCurrencyPlaybackFile(await selected.text(), approved);
      setFile(next);
      setMessage('백업 확인 완료 · 3.216초 · 34개 음소. 아래에서 움직임을 켜고 답변 듣기를 눌러 주세요.');
    } catch {
      setError(true);
      setMessage('파일을 불러오지 못했어요. 정렬 정보가 포함된 원본 금액 백업 JSON(128KB 이하)을 선택해 주세요. 이미 불러온 결과는 유지돼요.');
    } finally { locked.current = false; setBusy(false); }
  }

  return <>
    <h1 className="text-2xl font-bold">백업 파일로 금액 음성 확인</h1>
    <p className="my-4 leading-7">“{approved.requestText}”의 원본 음성과 입 모양을 확인해요.
      파일은 이 화면에서만 사용하며 새로고침하면 다시 선택해 주세요.</p>
    <p id="currency-file-help" className="mb-4 text-sm leading-6">정렬 정보가 포함된 yeoni-review-currency-20261009-aligned.json 파일을 선택해 주세요.
      음성을 생성하거나 정렬하지 않고, 기존 저장 결과와 요청 기록도 변경하지 않아요.</p>
    <label htmlFor="currency-playback-file" className="mb-2 block font-medium">금액 음성 백업 JSON</label>
    <input id="currency-playback-file" type="file" accept=".json,application/json" disabled={busy}
      aria-describedby="currency-file-help" className="block min-h-11 w-full min-w-0 max-w-full rounded-xl border p-2 text-sm"
      onChange={event => { const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (selected) void load(selected); }} />
    <p role={error ? 'alert' : 'status'} className="my-4 break-words leading-7">{message}</p>
    {file && playback ? <>
      <ReplyCharacterPanel clips={playback.clips} incoming={playback.incoming} displayText={file.displayText} />
      <p className="my-4 text-sm leading-7">답변 듣기 → 일시정지 → 답변 듣기로 이어 듣기를 확인해 주세요.
        재생 중 고양이형·인간형을 바꾸어도 같은 음성이 이어지고, 끝나면 입이 닫히는지 확인해 주세요.</p>
      <button type="button" disabled={busy} className="min-h-11 rounded-xl border p-3"
        onClick={() => { setFile(null); setError(false); setMessage('파일 재생을 닫았어요. 다시 확인하려면 같은 백업을 선택해 주세요.'); }}>불러온 파일 닫기</button>
    </> : null}
  </>;
}
