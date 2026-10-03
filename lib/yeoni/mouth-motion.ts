import { phoneViseme, type LipSyncManifest, type Viseme } from './lip-sync.ts';
import { JAPANESE_GLIDES, JAPANESE_VOWELS } from './japanese-phones.ts';

/** Visual coarticulation only. The source phonemes, boundaries and audio stay intact. */
export type MouthPose = Readonly<{ from: Viseme; to: Viseme; mix: number }>;
type Anchor = Readonly<{ time: number; shape: Viseme }>;
const vowels = new Set(['ɐ', 'ʌ', 'ʌː', 'i', 'iː', 'u', 'uː', 'e', 'eː', 'ɛ', 'ɛː', 'o', 'oː', 'ɨ', 'ɨː',
  'ㅏ', 'ㅑ', 'ㅓ', 'ㅕ', 'ㅣ', 'ㅜ', 'ㅠ', 'ㅔ', 'ㅐ', 'ㅖ', 'ㅒ', 'ㅗ', 'ㅛ', 'ㅡ']);
const glides = new Set(['j', 'w', 'ɥ']);
const cache = new WeakMap<LipSyncManifest, readonly Anchor[]>();
const stills = Object.freeze(Object.fromEntries(['rest', 'closed', 'small', 'a', 'i', 'u', 'e', 'o']
  .map(shape => [shape, Object.freeze({ from: shape, to: shape, mix: 0 })])) as Record<Viseme, MouthPose>);
export const REST_MOUTH = stills.rest;

function anchorsFor(manifest: LipSyncManifest): readonly Anchor[] {
  const cached = cache.get(manifest); if (cached) return cached;
  const vowelPhones = manifest.language === 'ja-JP' ? JAPANESE_VOWELS : vowels;
  const glidePhones = manifest.language === 'ja-JP' ? JAPANESE_GLIDES : glides;
  const anchors: Anchor[] = [];
  const add = (time: number, shape: Viseme) => {
    // Same-time silence/closure at a boundary takes precedence over open shapes.
    const previous = anchors.at(-1);
    if (previous?.time === time) anchors.pop();
    anchors.push(Object.freeze({ time, shape }));
  };
  let end = 0;
  add(0, 'rest');
  for (const cue of manifest.cues) {
    if (cue.startMs > end) { add(end, 'rest'); add(cue.startMs, 'rest'); }
    const shape = phoneViseme(cue.phone, manifest.language), duration = cue.endMs - cue.startMs;
    if (shape === 'rest' || shape === 'closed') {
      // Full measured closure and silence survive coarticulation, even when short.
      add(cue.startMs, shape); add(cue.endMs, shape);
    } else if (vowelPhones.has(cue.phone) || shape !== 'small' && !(glidePhones.has(cue.phone) && duration < 30)) {
      const edge = Math.min(60, duration / 2);
      add(cue.startMs + edge, shape); add(cue.endMs - edge, shape);
    } else if (shape === 'small' && duration >= 180) {
      // Long consonants still relax the mouth; brief ones share the adjacent vowel motion.
      add((cue.startMs + cue.endMs) / 2, 'small');
    }
    end = cue.endMs;
  }
  add(end, 'rest'); add(manifest.durationMs, 'rest');
  const result = Object.freeze(anchors); cache.set(manifest, result); return result;
}

/** Pure random access from the audio clock: no accumulated lag, cue timers or seek history. */
export function mouthAt(manifest: LipSyncManifest, timeMs: number): MouthPose {
  if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs >= manifest.durationMs) return REST_MOUTH;
  const anchors = anchorsFor(manifest);
  let low = 0, high = anchors.length;
  while (low < high) { const mid = (low + high) >>> 1; if (anchors[mid].time <= timeMs) low = mid + 1; else high = mid; }
  const a = anchors[Math.max(0, low - 1)], b = anchors[low];
  if (!b || a.shape === b.shape || timeMs <= a.time) return stills[a.shape];
  const t = (timeMs - a.time) / (b.time - a.time), mix = t * t * (3 - 2 * t);
  return Object.freeze({ from: a.shape, to: b.shape, mix });
}

export function mouthKey(pose: MouthPose) { return `${pose.from}:${pose.to}:${pose.mix}`; }
