import spec from '../../public/yeoni/cat/preserved-motion-v3.json';
import type { CharacterFrame } from './character-controller';
import type { Viseme } from './lip-sync';

export const CAT_MOTION_ASSET = '/yeoni/cat/preserved-motion-v3.png';
export function catFace(frame: CharacterFrame, expressive: boolean, speechMouth: boolean) {
  const e = frame.expression;
  const eye = frame.blink === 'closed' || expressive && e.eyeSmile >= .7 ? 'eyesClosed'
    : frame.blink === 'half' || expressive && e.eyeOpen < .65 ? 'eyesHalf' : 'open';
  // Silence, stop and phoneme closure retain the approved closed cat mouth.
  const mouth: Viseme = speechMouth ? frame.viseme : 'rest';
  return { eye, mouth };
}

/** Reuses the approved crop and feathered patches; no painting or vector replacement. */
export function createCatArtwork(image: CanvasImageSource) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const patches = new Map<string, { image: HTMLCanvasElement; x: number; y: number }[]>();
  let previous = '';
  for (const [id, list] of Object.entries(spec.parts)) {
    patches.set(id, list.map(p => {
      const [sx, sy, sw, sh] = p.source, [x, y, w, h] = p.rect;
      const layer = document.createElement('canvas'); layer.width = w; layer.height = h;
      const c = layer.getContext('2d'); if (!c) throw new Error('Canvas unavailable');
      c.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
      c.globalCompositeOperation = 'destination-in';
      for (const vertical of [false, true]) {
        const size = vertical ? h : w;
        const g = c.createLinearGradient(0, 0, vertical ? 0 : w, vertical ? h : 0);
        for (const [at, color] of [[0, 'transparent'], [2 / size, 'transparent'], [p.feather / size, 'black'], [1 - p.feather / size, 'black'], [1 - 2 / size, 'transparent'], [1, 'transparent']] as const) g.addColorStop(at, color);
        c.fillStyle = g; c.fillRect(0, 0, w, h);
      }
      return { image: layer, x, y };
    }));
  }
  return {
    frame(eye: string, mouth: string) {
      const key = eye + ':' + mouth;
      if (previous !== key) {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 360, 360);
        ctx.drawImage(image, 0, 0, 313, 313, 24, 24, 313, 313);
        for (const id of [eye, mouth]) for (const p of patches.get(id) ?? []) ctx.drawImage(p.image, p.x + 24, p.y + 24);
        previous = key;
      }
      return canvas;
    },
    dispose() { for (const list of patches.values()) for (const p of list) p.image.width = p.image.height = 0; patches.clear(); canvas.width = canvas.height = 0; },
  };
}
