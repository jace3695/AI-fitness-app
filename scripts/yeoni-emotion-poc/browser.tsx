import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CatAnimationStage from '../../components/yeoni/CatAnimationStage';
import { updateYeoniPreferences } from '../../components/useYeoniPreferences';
import { CHARACTER_EMOTIONS, CHARACTER_GESTURES, type CharacterEmotion, type CharacterGesture } from '../../lib/yeoni/character-expression';
import { EMPTY_PLAYBACK } from '../../lib/yeoni/character-controller';
import { LipSyncPlayer, type SpeechState } from '../../lib/yeoni/lip-sync-player';
import { realFixture } from '../yeoni-speech-poc/real-fixture';
import '../yeoni-poc/lab.css';
import './emotion.css';

const labels: Record<CharacterEmotion, string> = { neutral: '기본', smile: '미소', happy: '기쁨', proud: '뿌듯함', encouraging: '응원', concerned: '걱정', surprised: '놀람', thinking: '생각 중', serious: '진지함', disappointed: '아쉬움', sleepy: '졸림', comforting: '위로' };
const gestures: Record<CharacterGesture, string> = { nod: '끄덕이기', tilt: '갸웃하기', greet: '꾸벅 인사', cheer: '가벼운 응원' };
function Lab() {
  const [emotion, setEmotion] = useState<CharacterEmotion>('neutral');
  const [gesture, setGesture] = useState<{ id: number; kind: CharacterGesture } | null>(null);
  const sequence = useRef(0);
  const [motion, setMotion] = useState(false), [mounted, setMounted] = useState(true), [dark, setDark] = useState(false);
  const [muted, setMuted] = useState(true), [state, setState] = useState<SpeechState>('empty'), [message, setMessage] = useState('');
  const audio = useRef<HTMLAudioElement>(null), player = useRef<LipSyncPlayer | null>(null);
  useEffect(() => {
    const instance = new LipSyncPlayer(audio.current!, () => { setState(instance.state); setMessage(instance.message); });
    player.current = instance;
    return () => { instance.dispose(); player.current = null; };
  }, []);
  function motionToggle() {
    player.current?.pause(); setGesture(null);
    try { updateYeoniPreferences({ visible: true, motion: motion ? 'off' : 'home' }); }
    catch { setMessage('설정은 저장하지 못했지만 현재 화면에는 적용했어요.'); }
    setMotion(!motion);
  }
  function showCat() { document.querySelector('.emotion-portrait')?.scrollIntoView({ behavior: 'instant', block: 'start' }); }
  const canPlay = !['empty', 'loading', 'error'].includes(state);
  return <main>
    <p className="eyebrow">AI 연이 · PHASE 6 개발 미리보기</p>
    <h1>표정과 몸짓으로 전하는 마음</h1>
    <p className="intro">소리 없이 표정부터 살펴보세요.<br />동작은 한 번씩 재생하고 기본 자세로 돌아와요.</p>
    <section className={`emotion-portrait${dark ? ' dark' : ''}`} aria-label="고양이 연이">
      {mounted ? <CatAnimationStage expressive assetUrl="/yeoni/cat/preserved-motion-v3.png" paused={!motion} emotion={emotion} gesture={gesture}
        speech={() => ({ manifest: player.current?.manifest ?? null, playback: player.current?.snapshot() ?? EMPTY_PLAYBACK })} /> : <p className="empty">연이가 잠시 쉬고 있어요.</p>}
    </section>
    <p className="emotion-label" aria-live="polite">지금 표정: {labels[emotion]}</p>
    <div className="controls">
      <button onClick={motionToggle}>{motion ? '움직임 멈추기' : '움직임 켜기'}</button>
      <button onClick={() => { setEmotion('neutral'); setGesture(null); }}>기본으로</button>
      <button onClick={() => { player.current?.pause(); setGesture(null); setMounted(!mounted); }}>{mounted ? '화면 나가기' : '돌아오기'}</button>
    </div>
    <section className="emotion-options" aria-labelledby="emotions-title"><h2 id="emotions-title">열두 가지 표정</h2>
      <div>{CHARACTER_EMOTIONS.map(value => <button key={value} aria-pressed={value === emotion} onClick={() => { setEmotion(value); showCat(); }}>{labels[value]}</button>)}</div>
    </section>
    <section className="gesture-options" aria-labelledby="gestures-title"><h2 id="gestures-title">마음을 담은 몸짓</h2>
      <p>움직임을 켠 뒤 눌러보세요. 다른 몸짓을 누르면 새 동작으로 바뀌어요.</p>
      <div>{CHARACTER_GESTURES.map(value => <button key={value} disabled={!motion || !mounted}
        onClick={() => { showCat(); setGesture({ id: ++sequence.current, kind: value }); }}>{gestures[value]}</button>)}</div>
    </section>
    <details className="checks"><summary>기존 음성과 함께 보기</summary>
      <p>이미 저장된 39자 음성을 사용해요. 처음에는 음소거이며 소리는 직접 켜야 들려요. 실제 발음·자연스러움 청취 확인은 보류 중이에요.</p>
      <div className="controls">
        <button onClick={() => { const sample = realFixture(); void player.current?.load(sample.bytes, sample.manifest, 'audio/mpeg'); }}>저장 음성 불러오기</button>
        <button disabled={!canPlay || !motion || !mounted} onClick={() => { showCat(); void player.current?.play(); }}>립싱크 함께 보기</button>
        <button disabled={!canPlay} onClick={() => player.current?.pause()}>음성 멈추기</button>
        <button onClick={() => setMuted(!muted)}>{muted ? '소리 켜기' : '소리 끄기'}</button>
      </div>
      <audio ref={audio} muted={muted} onVolumeChange={event => setMuted(event.currentTarget.muted)} controls preload="metadata" aria-label="저장된 연이 음성" />
      <p data-speech-state={state} role="status">{message || (state === 'empty' ? '음성을 불러오면 준비돼요.' : `음성 상태: ${state}`)} · {muted ? '음소거' : '소리 켜짐'}</p>
    </details>
    <div className="controls secondary"><button onClick={() => setDark(!dark)}>배경 바꾸기</button></div>
    <p className="caption">표정·몸짓은 직접 고르는 개발 시연이에요. 실제 AI 응답 연결은 후속 단계입니다. 기기의 ‘동작 줄이기’ 설정에서는 표정만 표시해요.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>);
