'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { prepareZephyrSpeech, ZephyrAudioCache } from '@/lib/zephyr-playback';

const cache = new ZephyrAudioCache();
const playEvent = 'yeoni-zephyr-play';

export default function ZephyrReadButton({ text }: { text: string }) {
  const [owner, setOwner] = useState<string | null>(null);
  const [changedAccount, setChangedAccount] = useState(false);
  const identity = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (identity.current !== undefined && identity.current !== next) { cache.clear(); setChangedAccount(true); }
      identity.current = next; setOwner(next);
    });
    return () => subscription.unsubscribe();
  }, []);
  if (changedAccount) return <p className="mt-2 text-xs" role="status">계정이 바뀌었어요. 새로고침한 뒤 답변을 읽어 주세요.</p>;
  if (!owner) return null;
  const speech = prepareZephyrSpeech(text);
  return speech.text ? <Playback key={`${owner}:${speech.text}`} owner={owner} speech={speech} /> : null;
}

function Playback({ owner, speech }: { owner: string; speech: ReturnType<typeof prepareZephyrSpeech> }) {
  const id = useId();
  const audio = useRef<HTMLAudioElement>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    alive.current = true;
    const element = audio.current;
    const stopOther = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) element?.pause(); };
    window.addEventListener(playEvent, stopOther);
    return () => { alive.current = false; element?.pause(); element?.removeAttribute('src'); element?.load(); window.removeEventListener(playEvent, stopOther); };
  }, [id]);

  async function read() {
    if (busy.current || !audio.current) return;
    if (!audio.current.paused) { audio.current.pause(); return; }
    busy.current = true; setNotice('');
    try {
      if (!ready) {
        setGenerating(true);
        const result = await cache.get(owner, speech.text, { storage: window.sessionStorage, request: async init => {
          const { data: { session } } = await createClient().auth.getSession();
          if (!alive.current || session?.user.id !== owner) throw new Error('로그인 계정을 다시 확인해 주세요.');
          const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${session.access_token}`);
          return fetch('/api/tts', { ...init, headers });
        } });
        const { data: { session } } = await createClient().auth.getSession();
        if (!alive.current || session?.user.id !== owner) return;
        audio.current.src = `data:audio/mpeg;base64,${result.audioContent}`;
        setReady(true); setRemaining(result.remainingCharacters);
      }
      if (audio.current.ended) audio.current.currentTime = 0;
      try { await audio.current.play(); }
      catch { if (alive.current) setNotice('음성은 준비됐어요. 재생 버튼을 눌러 들어 주세요. 추가로 생성하지 않아요.'); }
    } catch (error) {
      if (alive.current) setNotice(error instanceof Error && error.name !== 'TimeoutError' && error.name !== 'TypeError' ? error.message : '음성 연결을 확인하지 못했어요. 자동으로 다시 생성하지 않아요.');
    } finally { busy.current = false; if (alive.current) setGenerating(false); }
  }

  return <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-violet-950" aria-label="Zephyr 답변 읽기">
    <button type="button" disabled={generating} onClick={() => void read()} className="min-h-11 rounded-xl bg-white px-3 py-2 text-sm font-bold text-violet-800 disabled:opacity-50">
      {generating ? '음성 준비 중…' : playing ? '읽기 중지' : ready ? '다시 재생' : '답변 읽기'}
    </button>
    <p className="mt-1 text-xs leading-5">Google Zephyr · {speech.characters.toLocaleString('ko-KR')}자{speech.truncated ? ' · 긴 답변의 앞부분만 읽어요.' : ''}</p>
    {!ready && <p className="text-xs leading-5">누르면 이 답변을 Google에 보내 음성을 만들어요.</p>}
    <audio ref={audio} controls={ready} className={ready ? 'mt-2 w-full min-w-0' : 'hidden'} preload="none" aria-label="Zephyr 답변 음성"
      onPlay={() => { setPlaying(true); window.dispatchEvent(new CustomEvent(playEvent, { detail: id })); }}
      onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setNotice('재생을 마쳤어요. 다시 재생해도 문자수를 추가로 사용하지 않아요.'); }}
      onError={() => setNotice('음성을 재생하지 못했어요. 새 음성은 생성하지 않고 화면의 답변을 유지해요.')} />
    {remaining !== null && <p className="mt-1 text-xs leading-5">생성 당시 앱의 남은 한도 {remaining.toLocaleString('ko-KR')}자 · 이 화면에서 다시 재생하면 추가 생성 없음</p>}
    {notice && <p role="status" className="mt-2 text-xs leading-5">{notice}</p>}
  </div>;
}
