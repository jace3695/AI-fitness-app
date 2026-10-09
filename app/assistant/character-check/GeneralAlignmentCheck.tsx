'use client';
import { useMemo, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/supabase';
import { YEONI_VOICE_NAME } from '@/lib/yeoni-voice-policy';
import { validateReplyAlignment } from '@/lib/yeoni/speech-alignment';
import { buildReplyPlan } from '@/lib/yeoni/reply-plan';
import type { LipSyncManifest } from '@/lib/yeoni/lip-sync';
import ReplyCharacterPanel from '@/components/yeoni/ReplyCharacterPanel';
import plan from '@/services/yeoni-alignment/general-validation-plan.json';
import currencyPlan from '@/services/yeoni-alignment/currency-validation-plan.json';

type Saved = { id: string; text: string; voice: string; audioContent: string; requestId: string; generationMs: number; alignment?: LipSyncManifest; alignmentMs?: number; requestText?: string; responseSpokenText?: string; reservedCharacters?: number; remainingCharacters?: number };
type Sample = { id: string; text: string; requestId: string; requestText?: string };
const labels: Record<string, string> = { short: '짧은 답변', numbers: '숫자와 시간', long: '긴 답변', 'currency-20261009': '금액 읽기' };
const bytes = (audio: string) => Uint8Array.from(atob(audio), c => c.charCodeAt(0)).buffer;
const download = (row: Saved) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(row, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `yeoni-review-${row.id}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export default function GeneralAlignmentCheck({ currencyOnly = false }: { currencyOnly?: boolean }) {
  const samples: Sample[] = currencyOnly ? currencyPlan.cases : plan.cases;
  const prefix = currencyOnly ? 'yeoni-approved-currency-20261009:' : 'yeoni-approved-review-20261008:';
  const approvedCharacters = samples.reduce((total, sample) => total + Array.from(sample.text).length, 0);
  const [rows, setRows] = useState<Record<string, Saved>>({});
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState('무료 사용 조건을 확인한 뒤 문장별로 한 번씩 생성해요.');
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected ? rows[selected] : null;
  const playback = useMemo(() => active?.alignment ? {
    clips: [{ manifest: active.alignment, async load() { return { bytes: bytes(active.audioContent), mime: 'audio/mpeg' }; } }],
    incoming: { value: { reply: active.text, performance: buildReplyPlan(active.text, `approved-${active.id}`) } },
  } : null, [active]);
  async function budget() {
    const response = await authenticatedFetch('/api/tts', { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    const data = await response.json();
    if (!response.ok || data.enabled !== true || data.voice !== YEONI_VOICE_NAME || data.useDeviceVoice !== false
      || !Number.isSafeInteger(data.remainingCharacters)) throw new Error(data.error || data.message || '무료 사용 조건을 확인하지 못했어요.');
    return data.remainingCharacters as number;
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : '확인을 중단했어요. 자동 재시도하지 않습니다.'); }
    finally { lock.current = false; setBusy(false); }
  }
  function save(row: Saved) {
    setRows(previous => ({ ...previous, [row.id]: row }));
    try { localStorage.setItem(prefix + row.id, JSON.stringify(row)); }
    catch { setMessage('파일 보관 공간이 부족해요. 검증 파일 저장을 눌러 받은 음성을 보존해 주세요.'); }
  }
  async function restore() {
    const restored: Record<string, Saved> = {}, receipts: Record<string, boolean> = {};
    for (const sample of samples) {
      receipts[sample.id] = localStorage.getItem(prefix + sample.id + ':attempt') !== null;
      const raw = localStorage.getItem(prefix + sample.id);
      if (!raw) continue;
      const row: Saved = JSON.parse(raw);
      if (row.id !== sample.id || row.text !== sample.text || row.requestId !== sample.requestId || row.voice !== YEONI_VOICE_NAME || !row.audioContent || row.audioContent.length > 2_000_000) throw new Error('저장 파일이 승인된 문장과 맞지 않아요.');
      if (currencyOnly && (row.responseSpokenText !== sample.text || row.reservedCharacters !== 17)) throw new Error('금액 읽기 응답이 승인된 발화문과 맞지 않아요. 새로 생성하지 않습니다.');
      if (row.alignment) await validateReplyAlignment(bytes(row.audioContent), row.text, row.alignment);
      restored[row.id] = row;
    }
    setRows(restored); setAttempted(receipts); setMessage(`저장 음성 ${Object.keys(restored).length}개를 불러왔어요. 새 생성은 하지 않았어요.`);
  }
  async function generate(id: string) {
    const sample = samples.find(item => item.id === id)!;
    if (localStorage.getItem(prefix + id + ':attempt')) throw new Error('이미 요청한 문장이에요. 저장 결과를 불러오거나 다운로드한 파일을 사용해 주세요.');
    const remaining = await budget();
    if (remaining < Array.from(sample.text).length) throw new Error('남은 무료 문자수가 부족해요.');
    // Stable request ID also lets the server budget reject a repeated request after reload.
    const requestId = sample.requestId;
    localStorage.setItem(prefix + id + ':attempt', requestId);
    if (localStorage.getItem(prefix + id + ':attempt') !== requestId) throw new Error('중복 생성 방지 기록을 저장하지 못했어요.');
    setAttempted(previous => ({ ...previous, [id]: true }));
    setMessage(`${labels[id]} 음성을 한 번 요청했어요. 결과를 기다리는 중이에요.`);
    const started = Date.now();
    const response = await authenticatedFetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sample.requestText ?? sample.text, requestId }), signal: AbortSignal.timeout(45_000) });
    const data = await response.json();
    if (!response.ok || data.requestId !== requestId || data.voice !== YEONI_VOICE_NAME || data.useDeviceVoice !== false
      || typeof data.audioContent !== 'string' || !data.audioContent || data.audioContent.length > 2_000_000
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.audioContent)) throw new Error(data.error || '음성 생성 결과가 불확실해요. 추가 생성은 중단했어요.');
    save({ id, text: sample.text, voice: data.voice, audioContent: data.audioContent, requestId, generationMs: Date.now() - started,
      ...(currencyOnly ? { requestText: sample.requestText, responseSpokenText: data.spokenText, reservedCharacters: data.reservedCharacters, remainingCharacters: data.remainingCharacters } : {}) });
    if (currencyOnly && (data.spokenText !== sample.text || data.reservedCharacters !== 17)) throw new Error('받은 응답을 보관했지만 승인된 발화문과 맞지 않아요. 검증 파일을 저장하고 추가 생성은 중단해 주세요.');
    setMessage(`${labels[id]} 생성 완료. 먼저 검증 파일을 저장해 주세요. 남은 문자 ${data.remainingCharacters}자.`);
  }
  async function align(id: string) {
    const row = rows[id];
    if (currencyOnly && (row.responseSpokenText !== row.text || row.reservedCharacters !== 17)) throw new Error('승인된 발화문과 일치하지 않아 정렬하지 않았어요.');
    setMessage(`${labels[id]} 저장 음성을 정렬하는 중이에요.`);
    const response = await authenticatedFetch('/api/yeoni/alignment-review', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, audioContent: row.audioContent }), signal: AbortSignal.timeout(55_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(`정렬 중단: ${data.error}. 생성한 음성은 그대로 보관돼요.`);
    const alignment = await validateReplyAlignment(bytes(row.audioContent), row.text, data.alignment);
    save({ ...row, alignment, alignmentMs: data.elapsedMs }); setSelected(id);
    setMessage(`${labels[id]} 정렬 완료 · ${alignment.cues.length}개 음소 · ${(data.elapsedMs / 1000).toFixed(2)}초 · 음성·문장 일치 확인`);
  }
  return <>
    <h1 className="text-2xl font-bold">{currencyOnly ? '금액 읽기 수정 검증' : '새 문장 음성·립싱크 검증'}</h1>
    <p className="my-4 leading-7">{currencyOnly ? '승인된 17자 문장을 기존 한국어 Zephyr로 한 번만 생성해요. 이전 세 음성은 그대로 보존해요.' : '승인된 세 문장을 기존 한국어 Zephyr로 각각 한 번 생성해요.'} 정렬과 다시 듣기는 받은 음성을 재사용하며 자동 재시도하지 않아요.</p>
    <div className="flex flex-wrap gap-3">
      <button disabled={busy} onClick={() => void run(async () => setMessage(`무료 사용 조건 확인 · 남은 ${await budget()}자 · 이번 검증 최대 ${approvedCharacters}자`))} className="rounded-xl border p-3">무료 사용 확인</button>
      <button disabled={busy} onClick={() => void run(restore)} className="rounded-xl border p-3">저장 결과 불러오기</button>
    </div>
    <p role="status" className="my-4">{message}</p>
    {samples.map(sample => <section key={sample.id} className="my-4 rounded-2xl border bg-white p-4">
      <h2 className="font-bold">{labels[sample.id]} · {Array.from(sample.text).length}자</h2><p className="my-3 leading-7">{sample.text}</p>
      {sample.requestText && <p className="mb-3 text-sm">화면의 숫자 문장: {sample.requestText}</p>}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy || attempted[sample.id] || !!rows[sample.id]} onClick={() => void run(() => generate(sample.id))} className="rounded-xl bg-violet-700 p-3 text-white disabled:opacity-40">{labels[sample.id]} 1회 생성</button>
        {rows[sample.id] && <><button onClick={() => download(rows[sample.id])} className="rounded-xl border p-3">{labels[sample.id]} 검증 파일 저장</button>
          <button disabled={busy || (currencyOnly && (rows[sample.id].responseSpokenText !== sample.text || rows[sample.id].reservedCharacters !== 17))} onClick={() => void run(() => align(sample.id))} className="rounded-xl border p-3">{labels[sample.id]} 저장 음성 정렬</button>
          {rows[sample.id].alignment && <button onClick={() => setSelected(sample.id)} className="rounded-xl border p-3">{labels[sample.id]} 재생 화면</button>}
          <p className="w-full text-sm">생성 {(rows[sample.id].generationMs / 1000).toFixed(2)}초{rows[sample.id].alignment && ` · 정렬 ${(rows[sample.id].alignmentMs! / 1000).toFixed(2)}초 · ${rows[sample.id].alignment!.cues.length}음소 · ${(rows[sample.id].alignment!.durationMs / 1000).toFixed(3)}초 음성`}</p></>}
      </div>
      {currencyOnly && rows[sample.id]?.responseSpokenText === sample.text && rows[sample.id].reservedCharacters === 17 && !rows[sample.id].alignment && <audio controls preload="none" aria-label="금액 읽기 원본 음성" src={`data:audio/mpeg;base64,${rows[sample.id].audioContent}`} className="mt-3 w-full" />}
    </section>)}
    {playback && <ReplyCharacterPanel key={selected} clips={playback.clips} incoming={playback.incoming} />}
  </>;
}
