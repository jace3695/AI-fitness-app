import { parseCurrencyBackup, type ApprovedCurrency } from './currency-backup.ts';
import { sha256 } from './lip-sync.ts';
import { validateReplyAlignment } from './speech-alignment.ts';

export const CURRENCY_IMPORT_MAX_BYTES = 128 * 1024;
// Pinned to the independently recovered 2026-10-09 recording and existing alignment.
// Manifest digest uses JSON.stringify(parseLipSyncManifest(original.alignment)).
const AUDIO_SHA256 = '32bcb9f42d01ed8669dd3cbd5a4ce7604b9ce9cc9267090bef165dae6384488e';
const MANIFEST_SHA256 = 'c1c6aa7131795b9b9d1f838bd999b38f7d0ee5d2ebd667c91985ae61a51f1797';

/** Local file -> verified playback only. No storage, fetch, synthesis or alignment job. */
export async function parseCurrencyPlaybackFile(raw: string, approved: ApprovedCurrency) {
  if (!raw || raw.length > CURRENCY_IMPORT_MAX_BYTES
    || new TextEncoder().encode(raw).byteLength > CURRENCY_IMPORT_MAX_BYTES) {
    throw new Error('금액 음성 백업 JSON 파일(128KB 이하)을 선택해 주세요.');
  }
  parseCurrencyBackup(raw, approved);
  const row = JSON.parse(raw) as { audioContent: string; alignment?: unknown };
  if (!row.alignment) throw new Error('정렬 정보가 포함된 백업 파일을 선택해 주세요. 음성을 다시 생성하거나 정렬할 필요는 없어요.');
  const audio = Uint8Array.from(atob(row.audioContent), char => char.charCodeAt(0)).buffer;
  if (await sha256(audio) !== AUDIO_SHA256) throw new Error('보관된 금액 원본 음성과 다른 파일이에요. 기존 결과는 그대로 유지해요.');
  const manifest = await validateReplyAlignment(audio, approved.text, row.alignment);
  if (await sha256(new TextEncoder().encode(JSON.stringify(manifest)).buffer) !== MANIFEST_SHA256) {
    throw new Error('보관된 금액 원본 정렬과 다른 파일이에요. 정렬을 다시 실행하지 말고 원본 백업을 선택해 주세요.');
  }
  return { audio, manifest, text: approved.text, displayText: approved.requestText };
}
