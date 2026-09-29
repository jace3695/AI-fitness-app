/** Alignment input, not a Korean text-to-phoneme or timing estimator. */
export const VISEMES = ['rest', 'closed', 'small', 'open', 'round', 'wide'] as const;
export type Viseme = typeof VISEMES[number];
const phones: Record<string, Viseme> = {
  sil: 'rest', 'ㅁ': 'closed', 'ㅂ': 'closed', 'ㅃ': 'closed', 'ㅍ': 'closed',
  'ㅏ': 'open', 'ㅑ': 'open', 'ㅓ': 'open', 'ㅕ': 'open',
  'ㅗ': 'round', 'ㅛ': 'round', 'ㅜ': 'round', 'ㅠ': 'round',
  'ㅣ': 'wide', 'ㅔ': 'wide', 'ㅐ': 'wide', 'ㅖ': 'wide', 'ㅒ': 'wide',
  'ㅡ': 'small', 'ㄱ': 'small', 'ㄲ': 'small', 'ㅋ': 'small', 'ㄴ': 'small',
  'ㄷ': 'small', 'ㄸ': 'small', 'ㅌ': 'small', 'ㄹ': 'small', 'ㅅ': 'small',
  'ㅆ': 'small', 'ㅇ': 'small', 'ㅈ': 'small', 'ㅉ': 'small', 'ㅊ': 'small', 'ㅎ': 'small',
};
export type PhoneCue = Readonly<{ startMs: number; endMs: number; phone: string }>;
export type LipSyncManifest = Readonly<{
  version: 1; language: 'ko-KR'; voice: string; spokenText: string;
  audioSha256: string; textSha256: string; durationMs: number;
  alignment: 'reviewed-phonemes' | 'synthetic-clock-test';
  cues: readonly PhoneCue[];
}>;
const shaPattern = /^[a-f0-9]{64}$/;
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
export function phoneViseme(phone: string): Viseme {
  if (!Object.hasOwn(phones, phone)) throw new Error(`미지원 음소: ${phone}`);
  return phones[phone];
}

/** Reject bad alignment rather than inventing equal-length or volume-driven cues. */
export function parseLipSyncManifest(input: unknown): LipSyncManifest {
  if (!record(input) || input.version !== 1 || input.language !== 'ko-KR'
    || !['reviewed-phonemes', 'synthetic-clock-test'].includes(String(input.alignment))
    || typeof input.voice !== 'string' || !input.voice || input.voice.length > 100
    || typeof input.spokenText !== 'string' || !input.spokenText.trim() || Array.from(input.spokenText).length > 1200
    || typeof input.audioSha256 !== 'string' || !shaPattern.test(input.audioSha256)
    || typeof input.textSha256 !== 'string' || !shaPattern.test(input.textSha256)
    || typeof input.durationMs !== 'number' || !Number.isFinite(input.durationMs) || input.durationMs <= 0 || input.durationMs > 120_000
    || !Array.isArray(input.cues) || !input.cues.length || input.cues.length > 24_000) throw new Error('음성 타임라인 형식을 확인해 주세요.');
  if (input.alignment === 'reviewed-phonemes' && input.voice !== 'ko-KR-Chirp3-HD-Zephyr') throw new Error('연이의 Zephyr 음성 타임라인이 필요해요.');
  let end = 0;
  const cues = input.cues.map(cue => {
    if (!record(cue) || typeof cue.startMs !== 'number' || typeof cue.endMs !== 'number'
      || !Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs)
      || cue.startMs < end || cue.endMs <= cue.startMs || cue.endMs > Number(input.durationMs)
      || typeof cue.phone !== 'string') throw new Error('음소의 시작·종료 시각을 확인해 주세요.');
    phoneViseme(cue.phone); end = cue.endMs;
    return Object.freeze({ startMs: cue.startMs, endMs: cue.endMs, phone: cue.phone });
  });
  return Object.freeze({ version: 1, language: 'ko-KR', voice: input.voice, spokenText: input.spokenText,
    audioSha256: input.audioSha256, textSha256: input.textSha256, durationMs: input.durationMs,
    alignment: input.alignment as LipSyncManifest['alignment'], cues: Object.freeze(cues) });
}
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function verifyLipSyncPair(bytes: ArrayBuffer, input: unknown): Promise<LipSyncManifest> {
  if (!bytes.byteLength || bytes.byteLength > 8_000_000) throw new Error('음성 파일은 8MB 이하여야 해요.');
  const manifest = parseLipSyncManifest(input);
  const [audio, text] = await Promise.all([sha256(bytes), sha256(new TextEncoder().encode(manifest.spokenText).buffer)]);
  if (audio !== manifest.audioSha256 || text !== manifest.textSha256) throw new Error('음성·발화문과 타임라인이 일치하지 않아요.');
  return manifest;
}
/** Half-open intervals, silent gaps, random access for seeks/rate changes. */
export function visemeAt(manifest: LipSyncManifest, timeMs: number): Viseme {
  if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs >= manifest.durationMs) return 'rest';
  let low = 0, high = manifest.cues.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (manifest.cues[mid].endMs <= timeMs) low = mid + 1; else high = mid;
  }
  const cue = manifest.cues[low];
  return cue && cue.startMs <= timeMs ? phoneViseme(cue.phone) : 'rest';
}
