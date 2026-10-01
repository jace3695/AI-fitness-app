import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SwitchableCharacterStage from '../../components/yeoni/SwitchableCharacterStage';
import type { SpeechSnapshot } from '../../lib/yeoni/character-controller';
import SpeechLab from '../yeoni-speech-poc/SpeechLab';
import { japaneseClockFixture } from './fixture';

const assets = (window as Window & { HUMAN_OFFLINE_ASSETS?: Record<string, string> }).HUMAN_OFFLINE_ASSETS;
const sample = { label: '일본어 입 모양 점검 (무음)', load: japaneseClockFixture };
function Character({ speech }: { speech: () => SpeechSnapshot }) {
  return <SwitchableCharacterStage speech={speech} assets={assets} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><SpeechLab Stage={Character} phase={12} characterName="한국어·일본어"
  heading="일본어 입 움직임 연결하기" extraSample={sample}
  intro={<>한국어는 저장된 실제 음성으로, 일본어는 무음 동작으로 확인해요.<br />일본어 실제 목소리·발음 시각 검증은 다음 작업입니다.</>}
  palette={<p className="caption">일본어 점검은 아·이·우·에·오, 닫힘, 긴 모음·쉼을 확인하는 기술 샘플이에요. 글자 수로 발음 시각을 나눈 음성 시연이 아닙니다. 실제 일본어 음성과 해당 파일에 맞춘 타임라인이 준비되면 아래 파일 선택에서 불러올 수 있어요.</p>} /></StrictMode>);
