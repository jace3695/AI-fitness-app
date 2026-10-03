import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SwitchableCharacterStage from '../../components/yeoni/SwitchableCharacterStage';
import type { CharacterEmotion, CharacterGesture, SpeechSnapshot } from '../../lib/yeoni/character-controller';
import SpeechLab from '../yeoni-speech-poc/SpeechLab';

const assets = (window as Window & { HUMAN_OFFLINE_ASSETS?: Record<string, string> }).HUMAN_OFFLINE_ASSETS;
function Character({ speech }: { speech: () => SpeechSnapshot }) {
  const [emotion, setEmotion] = useState<CharacterEmotion>('neutral');
  const [gesture, setGesture] = useState<{ id: number; kind: CharacterGesture } | null>(null);
  return <>
    <SwitchableCharacterStage speech={speech} assets={assets} emotion={emotion} gesture={gesture} />
    <details className="checks"><summary>표정과 몸짓도 이어서 확인하기</summary>
      <div className="controls">
        <button onClick={() => setEmotion('happy')}>기쁜 표정</button>
        <button onClick={() => setEmotion('neutral')}>기본 표정</button>
        <button onClick={() => setGesture(value => ({ id: (value?.id ?? 0) + 1, kind: 'greet' }))}>인사하기</button>
      </div>
    </details>
  </>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><SpeechLab Stage={Character} phase={11} characterName="외형 전환"
  heading="모습이 바뀌어도 이어지는 이야기"
  palette={<p className="caption">저장된 연이 음성을 재생한 뒤 고양이형·인간형 버튼을 눌러 보세요. 재생 위치와 표정, 진행 중인 몸짓이 이어집니다.</p>} /></StrictMode>);
