import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CatAnimationStage from '../../components/yeoni/CatAnimationStage';
import HumanAnimationStage from '../../components/yeoni/HumanAnimationStage';
import type { SpeechSnapshot } from '../../lib/yeoni/character-controller';
import SpeechLab from '../yeoni-speech-poc/SpeechLab';
import '../yeoni-control/control.css';

const assets = (window as Window & { HUMAN_OFFLINE_ASSETS?: Record<string, string> }).HUMAN_OFFLINE_ASSETS;
function Pair({ speech }: { speech: () => SpeechSnapshot }) {
  const [mode, setMode] = useState<'smooth' | 'direct'>('smooth');
  const source = (): SpeechSnapshot => ({ ...speech(), mouthMotion: mode });
  return <>
    <div className="controls" aria-label="입 움직임 비교">
      <button aria-pressed={mode === 'smooth'} onClick={() => setMode('smooth')}>부드러운 전환</button>
      <button aria-pressed={mode === 'direct'} onClick={() => setMode('direct')}>기존 전환</button>
    </div>
    <p className="caption">{mode === 'smooth' ? '발음 사이의 입 움직임을 이어서 보여줘요.' : '이전처럼 입 모양을 바로 교체해요.'} 재생 중에도 바꿔 비교할 수 있어요.</p>
    <div className="pair-boards">
      <section aria-label="고양이 모습"><h2>고양이 연이</h2><CatAnimationStage speech={source} /></section>
      <section aria-label="인간형 모습"><h2>인간형 연이</h2><HumanAnimationStage speech={source} assets={assets} /></section>
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><SpeechLab Stage={Pair} phase={10} characterName="두 모습의"
  palette={<p className="caption">입 움직임 보완 검토본 · 기존 음성과 외형을 사용해요. 정상 속도에서 두 전환 방식을 비교해 주세요.</p>} /></StrictMode>);
