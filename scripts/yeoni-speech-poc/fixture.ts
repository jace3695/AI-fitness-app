import { sha256, type LipSyncManifest } from '../../lib/yeoni/lip-sync';

/** Silent PCM for deterministic media-clock tests. This contains NO Korean speech. */
export async function clockFixture() {
  const sampleRate = 8000, seconds = 8, size = sampleRate * seconds * 2;
  const bytes = new ArrayBuffer(44 + size); const view = new DataView(bytes);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + size, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, size, true);
  const spokenText = '기술 점검용 무음 파일입니다. 한국어 발화가 아닙니다.';
  const manifest: LipSyncManifest = { version: 1, language: 'ko-KR', voice: 'NO-VOICE-silent-clock-fixture',
    spokenText, audioSha256: await sha256(bytes), textSha256: await sha256(new TextEncoder().encode(spokenText).buffer),
    durationMs: 8000, alignment: 'synthetic-clock-test', cues: [
      { startMs: 450, endMs: 1150, phone: 'ㅏ' },
      { startMs: 1350, endMs: 2300, phone: 'ㅗ' },
      { startMs: 2550, endMs: 3450, phone: 'ㅣ' },
      { startMs: 3600, endMs: 4200, phone: 'ㅁ' },
      { startMs: 4600, endMs: 5100, phone: 'ㄱ' },
      { startMs: 5500, endMs: 6350, phone: 'ㅜ' },
      { startMs: 6500, endMs: 7550, phone: 'ㅏ' },
    ] };
  return { bytes, manifest };
}
