import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SwitchableCharacterStage from '../../components/yeoni/SwitchableCharacterStage';
import type { SpeechSnapshot } from '../../lib/yeoni/character-controller';
import SpeechLab from '../yeoni-speech-poc/SpeechLab';
import audioBase64 from '../../docs/yeoni-voice-comparison/media/gemini-zephyr-ja-user.wav';
import timeline from '../../docs/yeoni-phase12/gemini-candidate/alignment/timeline.json';

const assets = (window as Window & { HUMAN_OFFLINE_ASSETS?: Record<string, string> }).HUMAN_OFFLINE_ASSETS;
const sample = { label: '후보 일본어 불러오기', async load() {
  return { bytes: Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0)).buffer, manifest: timeline, mime: 'audio/wav' };
} };
function Character({ speech }: { speech: () => SpeechSnapshot }) {
  return <SwitchableCharacterStage speech={speech} assets={assets} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><SpeechLab Stage={Character} phase={12} characterName="기존 한국어·후보 일본어"
  heading="연이, 한국어에서 일본어로" extraSample={sample}
  intro={<>익숙한 기존 한국어와 선택한 일본어 후보를 캐릭터와 함께 들어보세요.<br />일본어의 입 움직임은 새 음성에 맞춘 자동 정렬 초안입니다.</>}
  palette={<div className="caption"><p>한국어: ‘저장된 연이 음성 불러오기’ → ‘재생’<br />일본어: ‘후보 일본어 불러오기’ → ‘재생’</p><p>재생 중 고양이형·인간형을 바꿔도 같은 음성이 이어져요. 언어를 바꾸면 정지한 상태에서 처음부터 준비합니다.</p><p>기존 한국어는 Chirp3-HD Zephyr, 일본어 후보는 제공해 주신 Gemini Zephyr 5.08초 WAV입니다. 음성은 가공하지 않았습니다. 입 움직임과 쉼이 자연스러운지 확인해 주세요.</p></div>} /></StrictMode>);
