'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { readPitch, type PitchPoint } from './pitch';
import { createSpeechParticipant } from '@/lib/yeoni/speech-participant';
import AssessmentAvailability from './AssessmentAvailability';

// Audio stays in memory. No upload, speech recognition, or inferred score.
export default function Recorder({ text }: { text: string }) {
  const [recording, setRecording] = useState<Blob | null>(null);
  const [pitch, setPitch] = useState<PitchPoint[] | null>(null);
  const [pitchBusy, setPitchBusy] = useState(false);
  const [pitchNotice, setPitchNotice] = useState('');
  const pitchJob = useRef<AbortController | null>(null);
  function cancelPitch() {
    pitchJob.current?.abort(); pitchJob.current = null;
    setPitchBusy(false); setPitch(null); setPitchNotice('');
  }
  async function showPitch() {
    if (!recording || pitchJob.current) return;
    if (typeof AudioContext === 'undefined') { setPitchNotice('이 브라우저에서는 높낮이를 볼 수 없어요. 녹음은 다시 들을 수 있어요.'); return; }
    const job = new AbortController(); pitchJob.current = job;
    setPitchBusy(true); setPitch(null); setPitchNotice('');
    const timeout = setTimeout(() => job.abort(), 15000);
    try {
      const points = await readPitch(recording, job.signal, () => new AudioContext());
      if (pitchJob.current !== job || job.signal.aborted) return;
      setPitch(points);
      if (!points.some(point => point.hz !== null)) setPitchNotice('높낮이를 찾기 어려워요. 녹음을 다시 들어 보세요.');
    } catch {
      if (pitchJob.current === job) setPitchNotice('높낮이를 표시하지 못했어요. 녹음은 다시 들을 수 있어요.');
    } finally {
      clearTimeout(timeout);
      if (pitchJob.current === job) { pitchJob.current = null; setPitchBusy(false); }
    }
  }
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
    cancelPitch(); setRecording(null);
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
    window.addEventListener('yeoni-cloud-session-changed', leave);
    const storageChanged = (event: StorageEvent) => { if (!event.key || ['fitness-cloud-sync-user', 'fitness-cloud-sync-epoch'].includes(event.key)) clear(); };
    window.addEventListener('storage', storageChanged);
    document.addEventListener('visibilitychange', hide);
    return () => {
      pitchJob.current?.abort(); pitchJob.current = null;
      member.dispose(); participant.current = null;
      release(true);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('yeoni-cloud-session-changed', leave);
      window.removeEventListener('storage', storageChanged);
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
        setRecording(blob);
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
    <AssessmentAvailability />
    <p lang="ja" style={{ overflowWrap: 'anywhere' }}>{text}</p>
    <p>최대 30초 녹음 후 직접 들어 보세요. 녹음은 전송·저장하지 않으며 문장 변경이나 화면 이탈 시 삭제해요. 발음 평가 서비스는 아직 정하지 않았어요. 지금은 점수를 매기지 않아요.</p>
    <p className="text-sm">녹음 후 내 목소리 높낮이를 볼 수 있어요. 일본어 억양의 정답을 채점하는 기능은 아니에요.</p>
    <button className="btn" disabled={state !== 'idle'} onClick={() => void start()}>내 발음 녹음</button>{' '}
    {state === 'recording' && <button className="btn" onClick={() => release(false)}>녹음 마치기</button>}
    {state === 'requesting' && <button className="btn" onClick={clear}>권한 요청 취소</button>}
    <p role="status">{state === 'recording' ? '녹음 중 · 30초 후 자동 종료' : state === 'requesting' ? '마이크 권한 응답을 기다리고 있어요.' : notice}</p>
    {url && <><audio ref={audio} onPlay={() => participant.current?.claim()} aria-label="내 녹음 듣기" controls src={url} style={{ maxWidth: '100%' }} /><button className="btn" onClick={clear}>녹음 삭제</button></>}
    {recording && <div className="mt-3 rounded-xl border p-3">
      <button type="button" className="btn" style={{minHeight:44}} disabled={pitchBusy} onClick={() => void showPitch()}>목소리 높낮이 보기</button>
      {pitchBusy && <button type="button" className="btn" style={{minHeight:44}} onClick={cancelPitch}>그만 보기</button>}
      <p className="text-sm">선이 위로 가면 높은 소리, 아래로 가면 낮은 소리예요. 점수나 일본어 억양 정답이 아니에요. 소리가 불분명한 곳은 비워 둬요.</p>
      <p role="status">{pitchBusy ? '녹음의 높낮이를 살펴보고 있어요.' : pitchNotice}</p>
      {pitch?.some(point => point.hz !== null) && <svg viewBox="0 0 600 160" role="img" aria-label="시간에 따른 내 목소리 높낮이. 빈 구간은 분석할 수 없는 소리입니다." className="w-full" style={{maxHeight:180}}>

        {pitch.map((point,index) => {
          const previous=pitch[index-1]; if (!previous || previous.hz===null || point.hz===null) return null;
          const y=(hz:number)=>140-120*Math.log(hz/60)/Math.log(10);
          return <line key={index} x1={40+540*(index-1)/pitch.length} x2={40+540*index/pitch.length} y1={y(previous.hz)} y2={y(point.hz)} stroke="currentColor" strokeWidth="2" />;
        })}

      </svg>}
      {pitch?.some(point => point.hz !== null) && <p className="flex justify-between text-sm" aria-hidden="true"><span>처음</span><span>끝</span></p>}
      <p className="text-sm">이 문장에 연결된 비교용 예문 음성은 아직 없어요. 지금은 내 목소리만 볼 수 있어요.</p>
    </div>}
    <p>긴 모음·작은 っ·문장 끝을 스스로 확인해 보세요. 자기 점검은 발음 정확도 점수가 아니에요.</p>
  </section>;
}
