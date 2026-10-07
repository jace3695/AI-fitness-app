import { warpHumanPixels } from '../../lib/yeoni/human-renderer';
import { humanTransform } from '../../lib/yeoni/human-warp';
import { renderHumanRig } from '../yeoni-human-rig/render.mjs';
type Sample = { media: number; rendered: number; width: number; height: number; shape: string; eye: string; angle: number; drop: number; png: string };
const samples: Sample[] = [];
let raf = 0, last = -1000;
export function snapshot(): Sample {
  const canvas = document.querySelector<HTMLCanvasElement>('.portrait canvas')!, audio = document.querySelector('audio')!;
  return { media: audio.currentTime * 1000, rendered: Number(canvas.dataset.speechTimeMs), width: canvas.width, height: canvas.height,
    shape: canvas.dataset.viseme!, eye: canvas.dataset.eyeArtwork!, angle: Number(canvas.dataset.angle), drop: Number(canvas.dataset.drop), png: canvas.toDataURL() };
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

/** Compare actual played frames to independently assembled approved patches.
 * The geometry is the validated PHASE 8 warp, not a second speech selector. */
export async function compare(input: { samples: Sample[]; spec: { size: number[] }; assets: Record<string, string> }) {
  const images: Record<string, HTMLImageElement> = {};
  for (const [name, url] of Object.entries(input.assets)) { const img = new Image(); img.src = url; await img.decode(); images[name] = img; }
  const make = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const cache = new Map<string, Uint8ClampedArray>();
  const rows = [];
  for (const s of input.samples) {
    const key = s.eye + ':' + s.shape + ':' + s.width;
    if (!cache.has(key)) {
      const full = make(1024, 1536), reduced = make(s.width, s.height), c = reduced.getContext('2d', { willReadFrequently: true })!;
      renderHumanRig(full.getContext('2d'), images, input.spec, s.eye, s.shape, make);
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
    rows.push({ media: s.media, rendered: s.rendered, shape: s.shape, eye: s.eye, opaqueChanged, alphaMax, neckMin });
  }
  return rows;
}
