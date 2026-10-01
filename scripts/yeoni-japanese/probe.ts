import { japaneseClockFixture } from './fixture';
import { parseLipSyncManifest, visemeAt, type LipSyncManifest } from '../../lib/yeoni/lip-sync';
import { mouthAt } from '../../lib/yeoni/mouth-motion';
import timeline from '../../docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json';

const ko = parseLipSyncManifest(timeline);
let ja: LipSyncManifest;
export async function init() { ja = (await japaneseClockFixture()).manifest; }
export function expected(time: number, language: 'ko-KR' | 'ja-JP') {
  const m = language === 'ko-KR' ? ko : ja;
  return { viseme: visemeAt(m, time), mouth: mouthAt(m, time) };
}
export function koreanFrames() {
  const rows = [];
  for (let time = 0; time <= ko.durationMs + 10; time += 7) rows.push({ time, ...expected(time, 'ko-KR') });
  return rows;
}
export async function fileFixture() { const { bytes, manifest } = await japaneseClockFixture(); return { bytes: Array.from(new Uint8Array(bytes)), manifest }; }
