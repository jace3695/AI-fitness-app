import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CatAnimationStage from '../../components/yeoni/CatAnimationStage';
import type { SpeechSnapshot } from '../../lib/yeoni/character-controller';
import SpeechLab from './SpeechLab';
import MouthPalette from './MouthPalette';
function CatStage({ speech }: { speech: () => SpeechSnapshot }) {
  return <CatAnimationStage assetUrl="/yeoni/cat/preserved-motion-v3.png" speech={speech} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><SpeechLab Stage={CatStage} palette={<MouthPalette />} /></StrictMode>);
