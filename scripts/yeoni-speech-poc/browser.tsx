import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CatAnimationStage from '../../components/yeoni/CatAnimationStage';
import { updateYeoniPreferences, useYeoniPreferences } from '../../components/useYeoniPreferences';
import { LipSyncPlayer, type SpeechState } from '../../lib/yeoni/lip-sync-player';
import type { Viseme } from '../../lib/yeoni/lip-sync';
import { clockFixture } from './fixture';
import '../yeoni-poc/lab.css';
import './speech.css';

const labels: Record<SpeechState, string> = { empty: '샘플을 선택해 주세요', loading: '파일 확인 중', ready: '재생 준비 완료',
  playing: '재생 중', paused: '일시정지', ended: '재생 완료', error: '파일 확인 필요' };
function Lab() {
  const audio = useRef<HTMLAudioElement>(null);
  const player = useRef<LipSyncPlayer | null>(null);
  const audioFile = useRef<HTMLInputElement>(null), timingFile = useRef<HTMLInputElement>(null);
  const request = useRef({ generation: 0 });
  const [state, setState] = useState<SpeechState>('empty');
  const [message, setMessage] = useState('');
  const [text, setText] = useState('');
  const [alignment, setAlignment] = useState('');
  const [time, setTime] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [dark, setDark] = useState(false);
  const prefs = useYeoniPreferences();
  useEffect(() => {
    const pending = request.current;
    const instance = new LipSyncPlayer(audio.current!, () => {
      setState(instance.state); setMessage(instance.message);
      setText(instance.manifest?.spokenText ?? '');
      setAlignment(instance.manifest?.alignment ?? ''); setTime(instance.audio.currentTime);
    });
    player.current = instance;
    return () => { ++pending.generation; instance.dispose(); player.current = null; };
  }, []);
  const mouth = (): Viseme => player.current?.sample() ?? 'rest';
  function motion() {
    try { updateYeoniPreferences({ visible: true, motion: 'home' }); }
    catch { setMessage('움직임 설정을 저장하지 못했어요. 이번 화면에만 적용해요.'); }
  }
  async function fixture() {
    const token = ++request.current.generation;
    player.current?.reset();
    try {
      const sample = await clockFixture();
      if (token !== request.current.generation) return;
      motion(); await player.current?.load(sample.bytes, sample.manifest);
    } catch { if (token === request.current.generation) setMessage('이 브라우저에서 기술 샘플을 준비하지 못했어요. 다른 브라우저에서 파일을 열어 주세요.'); }
  }
  async function files() {
    const token = ++request.current.generation;
    player.current?.reset();
    const sound = audioFile.current?.files?.[0], timeline = timingFile.current?.files?.[0];
    if (!sound || !timeline) { setMessage('음성과 타임라인 파일을 모두 선택해 주세요.'); return; }
    if (sound.size > 8_000_000 || timeline.size > 1_000_000) { setMessage('음성은 8MB, 타임라인은 1MB 이하여야 해요.'); return; }
    try {
      const [bytes, json] = await Promise.all([sound.arrayBuffer(), timeline.text()]);
      if (token !== request.current.generation) return;
      motion(); await player.current?.load(bytes, JSON.parse(json), sound.type || 'audio/mpeg');
    } catch { if (token === request.current.generation) setMessage('파일 내용을 읽지 못했어요. JSON 형식을 확인해 주세요.'); }
  }
  const canPlay = !['empty', 'loading', 'error'].includes(state);
  return <main>
    <p className="eyebrow">AI 연이 · PHASE 5 개발 미리보기</p>
    <h1>발음마다 달라지는 입 모양</h1>
    <p className="intro">아, 오, 이, 그리고 입술 닫힘을 구분해요.<br />실제 한국어 음성과의 일치 검증은 대기 중이에요.</p>
    <section className={dark ? 'portrait dark' : 'portrait'} aria-label="고양이 연이">
      {mounted ? <CatAnimationStage assetUrl="/yeoni/cat/poc-speech-atlas-v1.png" mouth={mouth} /> : <p className="empty">연이가 잠시 쉬고 있어요.</p>}
    </section>
    <p className="sample-badge">{alignment === 'reviewed-phonemes' ? '불러온 음성 · 정렬 정확도는 별도 검토 필요' : '무음 기술 샘플 · 한국어 음성 시연이 아닙니다'}</p>
    <div className="controls">
      <button onClick={fixture}>무음 동작 샘플 불러오기</button>
      <button disabled={!canPlay} onClick={() => { motion(); void player.current?.play(); }}>재생</button>
      <button disabled={!canPlay} onClick={() => player.current?.pause()}>일시정지</button>
      <button disabled={!canPlay} onClick={() => player.current?.stop()}>처음으로</button>
    </div>
    <audio ref={audio} controls preload="metadata" aria-label="립싱크 음성" />
    <p className="notice" role="status" data-speech-state={state}>{message || labels[state]} · {time.toFixed(1)}초</p>
    {text && <p className="spoken">{text}</p>}
    <p className="caption">오디오의 실제 재생 위치를 따라가요. 무음 샘플은 재생·정지·탐색 동작을 확인하기 위한 것으로, 발음 타이밍을 검증하지 않아요.</p>
    <div className="controls">
      <button onClick={() => { player.current?.pause(); try { updateYeoniPreferences({ motion: prefs.motion === 'home' ? 'off' : 'home' }); } catch { setMessage('움직임 설정을 저장하지 못했어요. 이번 화면에만 적용해요.'); } }}>입 움직임 {prefs.motion === 'home' ? '끄기' : '켜기'}</button>
      <button onClick={() => { player.current?.pause(); setMounted(!mounted); }}>{mounted ? '화면 나가기' : '돌아오기'}</button>
      <button onClick={() => setDark(!dark)}>배경 바꾸기</button>
    </div>
    <details className="checks"><summary>실제 음성·타임라인 파일로 확인</summary>
      <p>파일은 이 화면에서만 읽어요. 외부로 전송하거나 저장하지 않아요. 파일을 바꾸거나 새로고침하면 다시 선택해 주세요.</p>
      <label>음성 파일 (최대 8MB)<input ref={audioFile} type="file" accept="audio/*" /></label>
      <label>발음 타임라인 JSON (최대 1MB)<input ref={timingFile} type="file" accept="application/json,.json" /></label>
      <button onClick={files}>선택한 파일 확인</button>
      <p>검토된 음소 시각과 음성·발화문 SHA-256이 필요해요. 파일 불일치나 지원하지 않는 음소를 추측해서 재생하지 않아요.</p>
    </details>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>);
