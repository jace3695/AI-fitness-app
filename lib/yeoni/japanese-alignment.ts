import { parseLipSyncManifest, sha256, type LipSyncManifest } from './lip-sync.ts';

export type LabelTimeUnit = 'seconds' | 'hts-100ns';

/** Imports already measured monophone intervals. Never obtains timing from G2P or kana length. */
export async function japaneseTimelineFromLabels(bytes: ArrayBuffer, spokenText: string, labels: string,
  unit: LabelTimeUnit, durationMs: number): Promise<LipSyncManifest> {
  if (unit !== 'seconds' && unit !== 'hts-100ns') throw new Error('라벨 시간 단위를 명시해 주세요.');
  if (!bytes.byteLength || bytes.byteLength > 8_000_000) throw new Error('음성 파일은 8MB 이하여야 해요.');
  if (!labels.trim() || labels.length > 1_000_000) throw new Error('음소 라벨은 1MB 이하여야 해요.');
  const lines = labels.trim().split(/\r?\n/);
  if (lines.length > 24_000) throw new Error('음소 라벨이 너무 많아요.');
  const numeric = unit === 'hts-100ns' ? /^\d+$/ : /^(?:\d+(?:\.\d+)?|\.\d+)$/;
  const cues = lines.map((line, i) => {
    const values = line.trim().split(/\s+/);
    if (values.length !== 3 || !numeric.test(values[0]) || !numeric.test(values[1])) throw new Error(`${i + 1}행: 시작·종료·음소 3열을 확인해 주세요.`);
    const [start, end] = values.slice(0, 2).map(Number);
    if (![start, end].every(Number.isFinite) || unit === 'hts-100ns' && ![start, end].every(Number.isSafeInteger)) throw new Error('라벨 시각 범위를 확인해 주세요.');
    return { startMs: unit === 'seconds' ? start * 1000 : start / 10000,
      endMs: unit === 'seconds' ? end * 1000 : end / 10000, phone: values[2] };
  });
  const owned = bytes.slice(0);
  return parseLipSyncManifest({ version: 2, language: 'ja-JP', phoneSet: 'openjtalk-v1', voice: 'ja-JP-Chirp3-HD-Zephyr',
    spokenText, durationMs, alignment: 'automatic-phonemes', cues,
    audioSha256: await sha256(owned), textSha256: await sha256(new TextEncoder().encode(spokenText).buffer) });
}
