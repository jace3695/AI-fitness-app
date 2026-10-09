import { warpHumanPixels } from '../../lib/yeoni/human-renderer';
import { humanTransform } from '../../lib/yeoni/human-warp';
import { mouthKey, type MouthPose } from '../../lib/yeoni/mouth-motion';
import { HUMAN_MOUTH_RECT, HUMAN_MOUTH_GEOMETRY, morphMouthPixels } from '../../lib/yeoni/mouth-morph';
import type { Viseme } from '../../lib/yeoni/lip-sync';
import { renderHumanRig } from '../yeoni-human-rig/render.mjs';
type Sample = { media: number; rendered: number; width: number; height: number; shape: string; mouth: MouthPose; eye: string; angle: number; drop: number; png: string };
const samples: Sample[] = [];
let raf = 0, last = -1000;
export function snapshot(): Sample {
  const canvas = document.querySelector<HTMLCanvasElement>('.portrait canvas')!, audio = document.querySelector('audio')!;
  return { media: audio.currentTime * 1000, rendered: Number(canvas.dataset.speechTimeMs), width: canvas.width, height: canvas.height,
    shape: canvas.dataset.viseme!, mouth: JSON.parse(canvas.dataset.mouthPose!), eye: canvas.dataset.eyeArtwork!, angle: Number(canvas.dataset.angle), drop: Number(canvas.dataset.drop), png: canvas.toDataURL() };
}
export function record() {
  samples.length = 0; last = -1000; samples.push(snapshot());
  const tick = () => {
    const audio = document.querySelector('audio')!;
    if (!audio.paused && audio.currentTime * 1000 - last >= 65) { const s = snapshot(); samples.push(s); last = s.media; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
export function finish() { cancelAnimationFrame(raf); samples.push(snapshot()); return samples; }

type ComparisonInput = { samples: Sample[]; spec: { size: number[] }; assets: Record<string, string> };
/** Reassemble approved patches independently of createHumanArtwork. A rendered
 * frame carries both the raw phoneme shape and the visible interpolated pose.
 * Reuse the separately verified mesh/warp primitives, retaining exact RGB checks. */
export async function compare(input: ComparisonInput) {
  const images: Record<string, HTMLImageElement> = {};
  for (const [name, url] of Object.entries(input.assets)) { const img = new Image(); img.src = url; await img.decode(); images[name] = img; }
  const make = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const cache = new Map<string, Uint8ClampedArray>();
  const [mx, my, mw, mh] = HUMAN_MOUTH_RECT, endpoints = new Map<Viseme, ImageData>();
  const endpoint = (shape: Viseme) => {
    if (!endpoints.has(shape)) {
      const c = make(1024, 1536).getContext('2d')!;
      renderHumanRig(c, images, input.spec, 'open', shape, make);
      endpoints.set(shape, c.getImageData(mx, my, mw, mh));
    }
    return endpoints.get(shape)!;
  };
  const rows = [];
  for (const s of input.samples) {
    const { from, to, mix } = s.mouth;
    if (!(from in HUMAN_MOUTH_GEOMETRY) || !(to in HUMAN_MOUTH_GEOMETRY) || !Number.isFinite(mix) || mix < 0 || mix > 1) throw new Error('Invalid captured mouth pose');
    const key = s.eye + ':' + mouthKey(s.mouth) + ':' + s.width;
    if (!cache.has(key)) {
      const full = make(1024, 1536), reduced = make(s.width, s.height), c = reduced.getContext('2d', { willReadFrequently: true })!;
      const fullContext = full.getContext('2d')!;
      const shape = mix === 1 ? to : from;
      renderHumanRig(fullContext, images, input.spec, s.eye, shape, make);
      if (from !== to && mix > 0 && mix < 1) {
        const patch = fullContext.createImageData(mw, mh);
        morphMouthPixels(endpoint(from).data, endpoint(to).data, patch.data, mw, mh,
          HUMAN_MOUTH_GEOMETRY[from], HUMAN_MOUTH_GEOMETRY[to], mix);
        fullContext.putImageData(patch, mx, my);
      }
      c.imageSmoothingQuality = 'high'; c.drawImage(full, 0, 0, s.width, s.height); cache.set(key, c.getImageData(0, 0, s.width, s.height).data);
    }
    const expected = new Uint8ClampedArray(s.width * s.height * 4), pose = { angle: s.angle, drop: s.drop, breath: -s.drop / 240 };
    warpHumanPixels(cache.get(key)!, expected, s.width, s.height, pose);
    const img = new Image(); img.src = s.png; await img.decode();
    const c = make(s.width, s.height).getContext('2d', { willReadFrequently: true })!; c.drawImage(img, 0, 0);
    const actual = c.getImageData(0, 0, s.width, s.height).data;
    let opaqueChanged = 0, alphaMax = 0, neckMin = 255;
    for (let i = 0; i < expected.length; i += 4) {
      if (expected[i + 3] === 255 && (actual[i] !== expected[i] || actual[i + 1] !== expected[i + 1] || actual[i + 2] !== expected[i + 2])) opaqueChanged++;
      alphaMax = Math.max(alphaMax, Math.abs(expected[i + 3] - actual[i + 3]));
    }
    const transform = humanTransform(pose), scale = s.width / 1024;
    for (let y = 690; y <= 824; y += 2) for (let x = 440; x <= 590; x += 2) {
      const p = transform.forward(x, y), i = (Math.floor(p.y * scale) * s.width + Math.floor(p.x * scale)) * 4;
      neckMin = Math.min(neckMin, actual[i + 3]);
    }
    rows.push({ media: s.media, rendered: s.rendered, shape: s.shape, mouth: s.mouth, eye: s.eye, opaqueChanged, alphaMax, neckMin });
  }
  return rows;
}

/** Negative controls must still fail for the old raw-viseme expectation and
 * for changed pixels outside the mouth; no source asset is edited. */
export async function negativeControls(input: ComparisonInput) {
  const sample = input.samples.find(s => s.mouth.from !== s.mouth.to && s.mouth.mix > .1 && s.mouth.mix < .9);
  if (!sample) throw new Error('No intermediate mouth frame was captured');
  const wrongPose = { ...sample, mouth: { from: sample.shape as Viseme, to: sample.shape as Viseme, mix: 0 } };
  const canvas = document.createElement('canvas'); canvas.width = sample.width; canvas.height = sample.height;
  const c = canvas.getContext('2d')!, image = new Image(); image.src = sample.png; await image.decode(); c.drawImage(image, 0, 0);
  const x = Math.floor(sample.width / 2), y = Math.floor(sample.height / 4), pixel = c.getImageData(x, y, 1, 1);
  pixel.data[0] = 255 - pixel.data[0]; c.putImageData(pixel, x, y);
  const changedFace = { ...sample, png: canvas.toDataURL() };
  return compare({ ...input, samples: [wrongPose, changedFace] });
}
