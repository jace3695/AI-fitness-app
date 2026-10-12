'use client';
import { useRef, useState } from 'react';
import ReplyCharacterPanel from '@/components/yeoni/ReplyCharacterPanel';
import { authenticatedFetch } from '@/lib/supabase';
import { buildReplyPlan } from '@/lib/yeoni/reply-plan';
import { validateReplyAlignment } from '@/lib/yeoni/speech-alignment';
import type { ReplyClip } from '@/lib/yeoni/reply-session';
import sample from '@/docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json';

export default function AlignmentCheck() {
  const attempted = useRef(false);
  const [message, setMessage] = useState('기존 한국어 음성으로 서버 정렬을 확인할 수 있어요.');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [result, setResult] = useState<{ clips: readonly ReplyClip[]; incoming: { value: unknown } } | null>(null);
  async function check() {
    if (attempted.current) return;
    attempted.current = true; setSent(true); setBusy(true); setMessage('저장 음성을 정렬하는 중이에요.');
    try {
      const response = await authenticatedFetch('/api/yeoni/alignment-check', {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(55_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`정렬 확인 중단: ${data.code ?? response.status} · 서버 응답 ${data.workerStatus ?? '없음'}${data.bindingPresent === false ? ' · 연결 설정 없음' : ''}`);
      const bytes = Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0)).buffer;
      const manifest = await validateReplyAlignment(bytes, sample.spokenText, data.alignment);
      setResult({ clips: [{ manifest, async load() { return { bytes, mime: 'audio/mpeg' }; } }],
        incoming: { value: { reply: manifest.spokenText, performance: buildReplyPlan(manifest.spokenText, 'saved-alignment-check') } } });
      setMessage(`서버 정렬 확인 완료 · ${manifest.cues.length}개 음소 · ${(manifest.durationMs / 1000).toFixed(3)}초 · 처리 ${(data.elapsedMs / 1000).toFixed(2)}초 · 음성·문장 일치 확인`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '정렬을 확인하지 못했어요.'); }
    finally { setBusy(false); }
  }
  return <>
    <h1 className="text-2xl font-bold">저장 음성 · 서버 정렬 확인</h1>
    <p className="my-4 leading-7">기존 한국어 Zephyr 음성을 한 번 정렬합니다. 새 음성을 생성하지 않으며 자동 재시도하지 않아요.
      완료 후 ‘답변 듣기’로 같은 파일과 새 정렬 결과를 재생할 수 있어요.</p>
    <button className="min-h-11 rounded-xl bg-violet-700 px-4 py-2 text-white disabled:opacity-50" disabled={sent || busy} onClick={() => void check()}>
      {busy ? '서버 정렬 확인 중' : sent ? '정렬 요청 완료' : '저장 음성 정렬 확인'}
    </button>
    <p role="status" className="my-4 break-words">{message}</p>
    {result && <ReplyCharacterPanel clips={result.clips} incoming={result.incoming} />}
  </>;
}
