import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import HumanAnimationStage from '../../components/yeoni/HumanAnimationStage';
import type { SpeechSnapshot } from '../../lib/yeoni/character-controller';
import SpeechLab from '../yeoni-speech-poc/SpeechLab';
import HumanMouthPalette from './HumanMouthPalette';
import './speech.css';

const assets = (window as Window & { HUMAN_OFFLINE_ASSETS?: Record<string, string> }).HUMAN_OFFLINE_ASSETS;
function HumanStage({ speech }: { speech: () => SpeechSnapshot }) {
  return <HumanAnimationStage assets={assets} speech={speech} />;
}
const original = <figure className="original-reference"><div role="img" aria-label="승인된 인간형 원본 A안"
  style={{ backgroundImage: `url("${assets?.['../reference-v3/base.png'] ?? '/yeoni/human/reference-v3/base.png'}")` }} /><figcaption>승인 원본 A안</figcaption></figure>;
createRoot(document.getElementById('root')!).render(<StrictMode><SpeechLab Stage={HumanStage} phase={9} characterName="인간형"
  original={original} palette={<HumanMouthPalette assets={assets} />} /></StrictMode>);
