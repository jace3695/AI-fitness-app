import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SwitchableCharacterStage from '../../components/yeoni/SwitchableCharacterStage';
import type { SpeechSnapshot } from '../../lib/yeoni/character-controller';
import SpeechLab from '../yeoni-speech-poc/SpeechLab';
import audioBase64 from '../../docs/yeoni-phase12/media/yeoni-zephyr-ja-approved.mp3';
import timeline from '../../docs/yeoni-phase12/alignment/timeline.json';

const assets = (window as Window & { HUMAN_OFFLINE_ASSETS?: Record<string, string> }).HUMAN_OFFLINE_ASSETS;
const sample = { label: '일본어 실제 음성 불러오기', async load() {
  return { bytes: Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0)).buffer, manifest: timeline, mime: 'audio/mpeg' };
} };
function Character({ speech }: { speech: () => SpeechSnapshot }) {
  return <SwitchableCharacterStage speech={speech} assets={assets} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><SpeechLab Stage={Character} phase={12} characterName="한국어·일본어"
  heading="일본어 실제 음성과 입 움직임" extraSample={sample}
  intro={<>받은 일본어 음성으로 고양이형·인간형의 입 움직임을 확인해요.<br />자동 정렬 초안이며 발음 경계와 자연스러움은 검토 중입니다.</>}
  palette={<p className="caption">‘일본어 실제 음성 불러오기’ → ‘재생’을 눌러 주세요. 재생 중 고양이형·인간형으로 바꿀 수 있어요. 저장된 4.056초 MP3를 재사용하며 새 음성 요청은 없습니다.</p>} /></StrictMode>);
