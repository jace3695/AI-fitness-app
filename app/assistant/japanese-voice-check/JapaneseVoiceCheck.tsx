'use client';
import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/supabase';
import { JAPANESE_CHECK } from '@/lib/japanese-voice-check';

const storageKey = `yeoni-japanese-check:${JAPANESE_CHECK.requestId}`;
const uncertain = '이 브라우저에서 이미 요청했습니다. 추가 생성하지 말고, 저장한 MP3 또는 요청 결과를 확인해 주세요.';
export default function JapaneseVoiceCheck() {
  const busy = useRef(false);
  const [initialized, setInitialized] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [audio, setAudio] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        setAttempted(true);
        if (saved.startsWith('data:audio/mpeg;base64,')) { setAudio(saved); setNotice('저장된 음성을 복원했습니다. 추가 생성 없이 재생·다운로드하세요.'); }
        else setNotice(uncertain);
      }
    } catch { setAttempted(true); setNotice('중복 요청 방지용 브라우저 저장소를 사용할 수 없습니다. 생성을 멈췄습니다.'); }
    setInitialized(true);
  }, []);
  async function generate() {
    if (busy.current || attempted || !initialized) return;
    busy.current = true; setLoading(true); setNotice('');
    try {
      if (localStorage.getItem(storageKey)) { setAttempted(true); setNotice(uncertain); return; }
      localStorage.setItem(storageKey, 'attempted');
      setAttempted(true);
      const response = await authenticatedFetch('/api/tts/japanese-check', { method: 'POST', signal: AbortSignal.timeout(45_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : '요청 결과를 확인하지 못했습니다.');
      if (result.requestId !== JAPANESE_CHECK.requestId || result.voice !== JAPANESE_CHECK.voice || result.text !== JAPANESE_CHECK.text
        || typeof result.audioContent !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.audioContent)) throw new Error('음성 응답이 승인 내용과 다릅니다. 추가 생성하지 않습니다.');
      const source = `data:audio/mpeg;base64,${result.audioContent}`;
      setAudio(source);
      try { localStorage.setItem(storageKey, source); setNotice('음성을 준비했습니다. MP3를 다운로드한 뒤 이 채팅에 첨부해 주세요.'); }
      catch { setNotice('브라우저에 음성을 보관하지 못했습니다. 화면을 닫기 전에 반드시 MP3를 다운로드하세요.'); }
    } catch (error) {
      setNotice(error instanceof Error && error.name !== 'TypeError' && error.name !== 'TimeoutError' ? error.message : '요청 완료 여부가 불확실합니다. 추가 생성하지 말고 이 메시지를 알려주세요.');
    } finally { busy.current = false; setLoading(false); }
  }
  return <section className="mt-5 rounded-xl border border-violet-200 bg-violet-50 p-4">
    {!audio && <button className="min-h-11 rounded-xl bg-violet-700 px-4 py-2 font-bold text-white disabled:opacity-50" disabled={!initialized || attempted || loading} onClick={() => void generate()}>{loading ? '일본어 음성 생성 중…' : attempted ? '요청 접수됨 · 추가 생성 중지' : '승인한 일본어 음성 1회 생성'}</button>}
    {!audio && <p className="mt-2 text-sm leading-6">버튼을 누르면 위 문장을 Google에 보냅니다. 실패해도 자동 재시도하지 않습니다.</p>}
    {audio && <><audio controls src={audio} preload="metadata" aria-label="일본어 Zephyr 음성" className="w-full" /><a href={audio} download="yeoni-zephyr-ja-approved.mp3" className="mt-3 inline-block rounded-xl bg-violet-700 px-4 py-3 font-bold text-white">일본어 MP3 다운로드</a><p className="mt-2 text-sm">재생·다운로드는 추가 음성을 생성하지 않습니다.</p></>}
    {notice && <p role="status" className="mt-3 text-sm leading-6">{notice}</p>}
  </section>;
}
