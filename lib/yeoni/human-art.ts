import spec from '../../public/yeoni/human/rig-v4/manifest.json';
import type { CharacterFrame } from './character-controller';
import type { MouthPose } from './mouth-motion';
import { createMouthMorph, HUMAN_MOUTH_RECT, HUMAN_MOUTH_GEOMETRY } from './mouth-morph';

export const HUMAN_ASSET_ROOT = '/yeoni/human/rig-v4/';
export const HUMAN_STATIC_PREVIEW = HUMAN_ASSET_ROOT + 'assembled-preview.webp';
export const HUMAN_IMAGE_NAMES = [...new Set([
  spec.layers.head.image, spec.layers.body.image,
  ...Object.values(spec.faceParts).flat().map(p => p.image),
])];
export function humanFace(frame: CharacterFrame) {
  return { eye: frame.blink === 'closed' ? 'eyesClosed' : frame.blink === 'half' ? 'eyesHalf' : 'open', mouth: frame.viseme };
}

/** Full-resolution original head/body and unchanged approved face patches. */
export function createHumanArtwork(images: ReadonlyMap<string, HTMLImageElement>) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1536;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
  const patches = new Map<string, { image: HTMLCanvasElement; x: number; y: number }[]>();
  for (const [id, list] of Object.entries(spec.faceParts)) patches.set(id, list.map(p => {
    const [x, y, w, h] = p.rect, layer = document.createElement('canvas'); layer.width = w; layer.height = h;
    const c = layer.getContext('2d'); if (!c) throw new Error('Canvas unavailable');
    c.drawImage(images.get(p.image)!, 0, 0); c.globalCompositeOperation = 'destination-in';
    for (const vertical of [false, true]) {
      const size = vertical ? h : w, gradient = c.createLinearGradient(0, 0, vertical ? 0 : w, vertical ? h : 0);
      for (const [at, color] of [[0, 'transparent'], [2 / size, 'transparent'], [p.feather / size, 'black'], [1 - p.feather / size, 'black'], [1 - 2 / size, 'transparent'], [1, 'transparent']] as const) gradient.addColorStop(at, color);
      c.fillStyle = gradient; c.fillRect(0, 0, w, h);
    }
    return { image: layer, x, y };
  }));
  let previous = '';
  const draw = (eye: string, mouth: string) => {
      const key = eye + ':' + mouth;
      if (previous !== key) {
        ctx.clearRect(0, 0, 1024, 1536);
        for (const id of ['body', 'head'] as const) { const p = spec.layers[id]; ctx.drawImage(images.get(p.image)!, p.rect[0], p.rect[1]); }
        for (const id of [eye, mouth]) for (const p of patches.get(id) ?? []) ctx.drawImage(p.image, p.x, p.y);
        previous = key;
      }
  };
  const [mx, my, mw, mh] = HUMAN_MOUTH_RECT;
  const morph = createMouthMorph(mw, mh, HUMAN_MOUTH_GEOMETRY, shape => { draw('open', shape); return ctx.getImageData(mx, my, mw, mh); });
  return {
    frame(eye: string, mouth: string, pose?: MouthPose) {
      if (!pose) { draw(eye, mouth); return canvas; }
      if (pose.from === pose.to || pose.mix === 0) { draw(eye, pose.from); return canvas; }
      if (pose.mix === 1) { draw(eye, pose.to); return canvas; }
      const image = morph.frame(pose); draw(eye, mouth); ctx.putImageData(image, mx, my); previous = '';
      return canvas;
    },
    dispose() { morph.dispose(); for (const list of patches.values()) for (const p of list) p.image.width = p.image.height = 0; patches.clear(); canvas.width = canvas.height = 0; },
  };
}
