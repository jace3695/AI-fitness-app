import { createHumanArtwork, HUMAN_IMAGE_NAMES } from '../../lib/yeoni/human-art';
import { createCatArtwork } from '../../lib/yeoni/cat-art';
import { mouthAt, type MouthPose } from '../../lib/yeoni/mouth-motion';
import { CAT_MOUTH_RECT, HUMAN_MOUTH_RECT } from '../../lib/yeoni/mouth-morph';
import { parseLipSyncManifest, visemeAt, VISEMES, type Viseme } from '../../lib/yeoni/lip-sync';
import timeline from '../../docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json';

const sources = window as unknown as Window & { CAT_OFFLINE_ASSET: string; HUMAN_OFFLINE_ASSETS: Record<string, string> };
const manifest = parseLipSyncManifest(timeline);
const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });
async function artwork(skin: string) {
  if (skin === 'cat') return createCatArtwork(await load(sources.CAT_OFFLINE_ASSET));
  return createHumanArtwork(new Map(await Promise.all(HUMAN_IMAGE_NAMES.map(async name => [name, await load(sources.HUMAN_OFFLINE_ASSETS[name])] as const))));
}
const rect = (skin: string) => skin === 'cat' ? CAT_MOUTH_RECT : HUMAN_MOUTH_RECT;
const hash = async (data: Uint8ClampedArray) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer))].map(n => n.toString(16).padStart(2, '0')).join('');

export async function endpoints() {
  const rows = [];
  for (const skin of ['cat', 'human']) {
    const art = await artwork(skin);
    try { for (const eye of ['open', 'eyesHalf', 'eyesClosed']) for (const mouth of VISEMES) {
      const canvas = art.frame(eye, mouth), data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      rows.push({ skin, eye, mouth, hash: await hash(data) });
    } } finally { art.dispose(); }
  }
  return rows;
}

export async function pixelReview() {
  const rows = [];
  for (const skin of ['cat', 'human']) {
    const art = await artwork(skin), [x, y, w, h] = rect(skin);
    try {
      const original = art.frame('open', 'rest'), context = original.getContext('2d')!;
      const baseline = context.getImageData(0, 0, original.width, original.height), roi = context.getImageData(x, y, w, h);
      const endpoints = new Map<Viseme, ImageData>();
      for (const shape of VISEMES) { art.frame('open', shape); endpoints.set(shape, context.getImageData(x, y, w, h)); }
      let outsideChanged = 0, endpointMismatches = 0, fullyOpaque = true, previousRaw: Uint8ClampedArray | null = null, previousSmooth: Uint8ClampedArray | null = null;
      const rawChanges: number[] = [], smoothChanges: number[] = [], costs: number[] = [];
      const delta = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let total = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) total += Math.abs(a[i] - b[i]); return total / (a.length / 4 * 3); };
      for (let time = 0; time <= manifest.durationMs; time += 1000 / 30) {
        const raw = endpoints.get(visemeAt(manifest, time))!.data, pose = mouthAt(manifest, time), start = performance.now();
        art.frame('open', visemeAt(manifest, time), pose); costs.push(performance.now() - start);
        const current = context.getImageData(x, y, w, h).data;
        if (previousRaw && previousSmooth) { rawChanges.push(delta(raw, previousRaw)); smoothChanges.push(delta(current, previousSmooth)); }
        previousRaw = raw; previousSmooth = current;
        if (pose.from === pose.to && delta(current, endpoints.get(pose.from)!.data) !== 0) endpointMismatches++;
        for (let i = 3; i < current.length; i += 4) fullyOpaque &&= current[i] === 255;
      }
      // Mouth-only edits must leave every original face/body/neck/background pixel intact.
      for (const pose of [{ from: 'a', to: 'o', mix: .5 }, { from: 'rest', to: 'a', mix: .5 }, { from: 'u', to: 'i', mix: .5 }] as MouthPose[]) {
        art.frame('open', 'rest', pose); const data = context.getImageData(0, 0, original.width, original.height).data;
        for (let yy = 0; yy < original.height; yy++) for (let xx = 0; xx < original.width; xx++) if (xx < x || xx >= x + w || yy < y || yy >= y + h) {
          const i = (yy * original.width + xx) * 4; for (let c = 0; c < 4; c++) if (data[i + c] !== baseline.data[i + c]) outsideChanged++;
        }
      }
      art.frame('open', 'rest'); const restored = context.getImageData(x, y, w, h).data;
      const stats = (a: number[]) => { const ordered = [...a].sort((a, b) => a - b); return { mean: a.reduce((a, b) => a + b, 0) / a.length, p95: ordered[Math.floor(ordered.length * .95)], maximum: Math.max(...a) }; };
      rows.push({ skin, outsideChanged, endpointMismatches, fullyOpaque, restoredExact: delta(restored, roi.data) === 0,
        rawChanges: stats(rawChanges), smoothChanges: stats(smoothChanges), drawCostMs: stats(costs) });
    } finally { art.dispose(); }
  }
  return rows;
}

export async function sheets() {
  const pairs: [Viseme, Viseme][] = [['rest', 'a'], ['a', 'e'], ['e', 'o'], ['o', 'small'], ['small', 'closed'], ['closed', 'u'], ['u', 'i'], ['o', 'rest']];
  for (const skin of ['cat', 'human']) {
    const art = await artwork(skin), [x, y, w, h] = rect(skin), scale = skin === 'cat' ? 4 : 1;
    const sheet = document.createElement('canvas'); sheet.id = `mouth-sheet-${skin}`; sheet.width = 1120; sheet.height = pairs.length * (h * scale + 30);
    const c = sheet.getContext('2d')!; c.fillStyle = '#eee'; c.fillRect(0, 0, sheet.width, sheet.height); c.font = '16px sans-serif';
    for (const [row, [from, to]] of pairs.entries()) for (const [col, mix] of [0, .25, .5, .75, 1].entries()) {
      c.fillStyle = '#111'; c.fillText(`${from} → ${to} / ${mix}`, col * 224 + 4, row * (h * scale + 30) + 20);
      c.drawImage(art.frame('open', from, { from, to, mix }), x, y, w, h, col * 224, row * (h * scale + 30) + 27, w * scale, h * scale);
    }
    document.body.append(sheet); art.dispose();
  }
}

export function expected(time: number) { return mouthAt(manifest, time); }
