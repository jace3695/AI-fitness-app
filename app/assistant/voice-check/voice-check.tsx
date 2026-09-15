'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedJsonHeaders } from '@/app/lib/authenticatedHeaders';
import { ZEPHYR_PROBE_TEXT, ZEPHYR_PROBE_CHARACTERS, type ZephyrProbeSlot } from '@/lib/zephyr-probe';

type Result = { slot: number; requestId: string; audioContent: string; generatedAt: string; googleHttpStatus: number; characters: number };

function AudioResult({ result }: { result: Result }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState('재생 대기');
  const [duration, setDuration] = useState<number | null>(null);
  return <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4" aria-label={`검증 ${result.slot} 결과`}>
    <h2 className="font-semibold">검증 {result.slot} · 생성 성공</h2>
    <p className="mt-2 text-sm">Google HTTP {result.googleHttpStatus} · {result.characters}자 · {result.generatedAt}</p>
    <p className="text-sm">{duration !== null ? `음성 길이 ${duration.toFixed(2)}초 · ` : ''}{state}</p>
    <audio ref={audio} preload="metadata" src={`data:audio/mpeg;base64,${result.audioContent}`}
      onLoadedMetadata={() => { const value = audio.current?.duration; if (value && Number.isFinite(value)) setDuration(value); }}
      onPlaying={() => setState('재생 중')} onEnded={() => setState('재생 완료')} onError={() => setState('재생 오류')} />
    <button type="button" className="mt-3 rounded-xl bg-emerald-700 px-4 py-2 text-white" onClick={() => {
      const player = audio.current; if (!player) return;
      player.currentTime = 0; void player.play().catch(() => setState('재생을 시작하지 못했어요'));
    }}>검증 {result.slot} 음성 재생</button>
    <p className="mt-2 text-xs text-slate-600">이 재생 버튼은 받은 음성을 다시 재생하며 새 음성을 생성하지 않아요.</p>
  </section>;
}

export default function VoiceCheck() {
  const [slots, setSlots] = useState<ZephyrProbeSlot[]>([]);
  const [message, setMessage] = useState('검증 준비 상태를 확인하고 있어요.');
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [halted, setHalted] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const running = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/tts/probe', { headers: await authenticatedJsonHeaders(), cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '준비 상태를 확인하지 못했어요.');
      setConfigured(data.configured === true); setSlots(data.slots); setMessage(data.message);
    } catch (error) { setConfigured(false); setSlots([]); setMessage(error instanceof Error ? error.message : '준비 상태를 확인하지 못했어요.'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function generate(slot: ZephyrProbeSlot) {
    if (running.current || halted || !slot.available) return;
    running.current = true; setBusy(true);
    try {
      const response = await fetch('/api/tts/probe', { method: 'POST', headers: await authenticatedJsonHeaders(), body: JSON.stringify({ requestId: slot.requestId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '음성 생성 결과를 확인하지 못했어요.');
      setResults(previous => [...previous, { ...data, slot: slot.slot }]);
      await refresh();
    } catch (error) {
      await refresh();
      setHalted(true); setMessage(error instanceof Error ? error.message : '검증을 멈췄어요.');
    } finally { running.current = false; setBusy(false); }
  }
  const reserved = slots.filter(slot => slot.reservedAt !== null).length;
  return <main className="mx-auto min-h-screen max-w-2xl space-y-5 px-4 pb-32 pt-8 text-slate-800">
    <Link href="/assistant/settings" className="text-sm text-emerald-700">← 연이 설정</Link>
    <h1 className="text-2xl font-bold">Zephyr 음성 검증</h1>
    <p>이번 검증은 최대 3회, 총 {ZEPHYR_PROBE_CHARACTERS * 3}자로 제한돼요. Google 무료 한도 적용 여부는 청구 보고서에서 확인해야 해요.</p>
    <p className="text-sm text-slate-600">목소리: ko-KR-Chirp3-HD-Zephyr · 일반 음성 사용은 아직 대기 중이에요.</p>
    <blockquote className="rounded-2xl bg-white p-4 shadow-sm">{ZEPHYR_PROBE_TEXT}</blockquote>
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      <p role="status">{message}</p>
      <p>서버 키 설정: {configured ? '확인됨' : '확인 필요'}</p>
      <p>접수한 검증: {reserved}/3회 · 예약 {reserved * ZEPHYR_PROBE_CHARACTERS}자</p>
      <p className="text-sm text-slate-600">예약에는 실패한 요청도 포함돼요. 실제 Google 사용량이나 청구 금액을 뜻하지 않아요.</p>
      {slots.length === 0 && <p>현재 계정에 승인된 검증 요청이 없어요.</p>}
      <div className="flex flex-wrap gap-2">{slots.map(slot => <button key={slot.requestId} type="button"
        disabled={busy || halted || !slot.available} onClick={() => void generate(slot)}
        className="rounded-xl bg-emerald-700 px-4 py-3 text-white disabled:opacity-40">검증 음성 {slot.slot} 생성</button>)}</div>
      <button type="button" disabled={busy} className="text-sm underline" onClick={() => void refresh()}>준비 상태 새로고침</button>
    </section>
    {results.map(result => <AudioResult key={result.requestId} result={result} />)}
  </main>;
}
