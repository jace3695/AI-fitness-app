import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CatAnimationStage from '../../components/yeoni/CatAnimationStage';
import HumanAnimationStage from '../../components/yeoni/HumanAnimationStage';
import type { SpeechSnapshot } from '../../lib/yeoni/character-controller';
import SpeechLab from '../yeoni-speech-poc/SpeechLab';
import './control.css';

const assets = (window as Window & { HUMAN_OFFLINE_ASSETS?: Record<string, string> }).HUMAN_OFFLINE_ASSETS;
function Pair({ speech }: { speech: () => SpeechSnapshot }) {
  const [revision, setRevision] = useState(0), [gestureId, setGestureId] = useState(0);
  const [catBroken, setCatBroken] = useState(false), [humanBroken, setHumanBroken] = useState(false);
  return <>
    <div className="pair-boards">
      <section aria-label="고양이 모습"><h2>고양이 연이</h2><CatAnimationStage speech={speech}
        assetUrl={catBroken ? '/missing-cat.png' : '/yeoni/cat/preserved-motion-v3.png'}
        gesture={gestureId ? { id: gestureId, kind: 'nod' } : null} /></section>
      <section aria-label="인간형 모습"><h2>인간형 연이</h2><HumanAnimationStage speech={speech} assets={assets} broken={humanBroken} /></section>
    </div>
    <details className="pair-tools"><summary>연결 동작 확인</summary><div className="controls">
      <button onClick={() => setRevision(value => value + 1)}>화면 갱신 {revision}</button>
      <button onClick={() => setGestureId(value => value + 1)}>고양이 끄덕임 요청</button>
      <button onClick={() => setCatBroken(value => !value)}>{catBroken ? '고양이 이미지 복구' : '고양이 오류 확인'}</button>
      <button onClick={() => setHumanBroken(value => !value)}>{humanBroken ? '인간형 이미지 복구' : '인간형 오류 확인'}</button>
    </div></details>
  </>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><SpeechLab Stage={Pair} phase={10} characterName="두 모습의"
  palette={<p className="caption">하나의 저장 음성과 발음 시각으로 두 모습을 함께 확인해요. 외형을 바꾸며 계속 말하는 기능은 다음 단계예요. 실제 청취 확인은 대기 중입니다.</p>} /></StrictMode>);
