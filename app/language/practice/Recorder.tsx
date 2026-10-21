'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createSpeechParticipant } from '@/lib/yeoni/speech-participant';

// Audio stays in memory. No upload, speech recognition, or inferred score.
export default function Recorder({ text }: { text: string }) {
  const participantId = useId();
  const participant = useRef<ReturnType<typeof createSpeechParticipant> | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<'idle' | 'requesting' | 'recording'>('idle');
  const [url, setUrl] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const objectUrl = useRef('');
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function release(discard: boolean) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (discard) epoch.current++;
    if (active.current?.state === 'recording') active.current.stop();
    active.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
  }
  function clear() {
    audio.current?.pause();
    inFlight.current = false;
    release(true);
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = ''; setUrl(''); setState('idle'); setNotice('');
  }
  useEffect(() => {
    clear();
    const leave = () => clear();
    const hide = () => { if (document.visibilityState === 'hidden') clear(); };
    const member = createSpeechParticipant(`japanese-recorder:${participantId}`, () => {
      audio.current?.pause(); inFlight.current = false; release(true); setState('idle');
    });
    participant.current = member;
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', hide);
    return () => {
      member.dispose(); participant.current = null;
      release(true);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', hide);
    };
    // Each target owns a separate ephemeral recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, participantId]);

  async function start() {
    if (inFlight.current) return;
    clear();
    participant.current?.claim();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setNotice('이 브라우저에서는 녹음을 지원하지 않아요. 예문을 보고 소리 내어 연습해 주세요.'); return;
    }
    const ticket = epoch.current;
    inFlight.current = true;
    setState('requesting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (ticket !== epoch.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const recorder = new MediaRecorder(media);
      active.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (ticket === epoch.current && event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { if (ticket === epoch.current) { clear(); setNotice('녹음에 실패했어요. 다시 시도해 주세요.'); } };
      recorder.onstop = () => {
        if (ticket !== epoch.current) return;
        release(false); inFlight.current = false; setState('idle');
        const blob = new Blob(chunks, { type: recorder.mimeType });
        if (!blob.size) { setNotice('녹음된 소리가 없어요. 다시 시도해 주세요.'); return; }
        objectUrl.current = URL.createObjectURL(blob); setUrl(objectUrl.current);
      };
      recorder.start(); setState('recording');
      timer.current = setTimeout(() => release(false), 30000);
    } catch {
      if (ticket === epoch.current) { clear(); setNotice('마이크를 사용할 수 없어요. 권한과 연결을 확인하거나 녹음 없이 연습해 주세요.'); }
    }
  }
  return <section aria-label="발음 자기 점검" className="card">
    <h2>발음 자기 점검</h2>
    <p lang="ja" style={{ overflowWrap: 'anywhere' }}>{text}</p>
    <p>최대 30초 녹음 후 직접 들어 보세요. 녹음은 전송·저장하지 않으며 문장 변경이나 화면 이탈 시 삭제해요. AI 발음 채점은 아직 연결되지 않았어요.</p>
    <button className="btn" disabled={state !== 'idle'} onClick={() => void start()}>내 발음 녹음</button>{' '}
    {state === 'recording' && <button className="btn" onClick={() => release(false)}>녹음 마치기</button>}
    {state === 'requesting' && <button className="btn" onClick={clear}>권한 요청 취소</button>}
    <p role="status">{state === 'recording' ? '녹음 중 · 30초 후 자동 종료' : state === 'requesting' ? '마이크 권한 응답을 기다리고 있어요.' : notice}</p>
    {url && <><audio ref={audio} onPlay={() => participant.current?.claim()} aria-label="내 녹음 듣기" controls src={url} style={{ maxWidth: '100%' }} /><button className="btn" onClick={clear}>녹음 삭제</button></>}
    <p>긴 모음·작은 っ·문장 끝을 스스로 확인해 보세요. 자기 점검은 발음 정확도 점수가 아니에요.</p>
  </section>;
}
