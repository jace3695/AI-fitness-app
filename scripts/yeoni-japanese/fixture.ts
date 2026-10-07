import { parseLipSyncManifest, sha256 } from '../../lib/yeoni/lip-sync';
import { clockFixture } from '../yeoni-speech-poc/fixture';

/** Reuses the existing silent PCM clock. These are synthetic test intervals, NOT speech alignment. */
export async function japaneseClockFixture() {
  const { bytes } = await clockFixture();
  const spokenText = '日本語の音声ではありません。口の動作を確認する無音テストです。';
  const intervals: [number, number, string][] = [
    [0, 200, 'sil'], [200, 800, 'a'], [800, 1200, 'a'], [1200, 1750, 'i'], [1750, 2200, 'U'],
    [2200, 2700, 'e'], [2700, 3200, 'o'], [3200, 3500, 'pau'], [3500, 3700, 'm'], [3700, 4200, 'a'],
    [4200, 4400, 'N'], [4400, 4560, 'k'], [4560, 4900, 'cl'], [4900, 5400, 'o'], [5400, 5520, 'j'],
    [5520, 5800, 'a'], [5800, 5820, 'y'], [5820, 6450, 'u'], [6450, 6580, 'py'], [6580, 7100, 'I'], [7100, 8000, 'sil'],
  ];
  return { bytes, manifest: parseLipSyncManifest({ version: 2, language: 'ja-JP', phoneSet: 'openjtalk-v1',
    voice: 'NO-VOICE-silent-clock-fixture', spokenText, audioSha256: await sha256(bytes),
    textSha256: await sha256(new TextEncoder().encode(spokenText).buffer), durationMs: 8000, alignment: 'synthetic-clock-test',
    cues: intervals.map(([startMs, endMs, phone]) => ({ startMs, endMs, phone })),
  }) };
}
