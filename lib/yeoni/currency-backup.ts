export const CURRENCY_BACKUP_KEY = 'yeoni-approved-currency-20261009:currency-20261009';

export type ApprovedCurrency = {
  id: string; text: string; requestText: string; requestId: string; voice: string;
};

/** Read one existing result without touching its bytes, attempt receipt or other keys. */
export function readCurrencyBackup(storage: Pick<Storage, 'getItem'>, approved: ApprovedCurrency) {
  const raw = storage.getItem(CURRENCY_BACKUP_KEY);
  if (raw === null) throw new Error('이 브라우저에서 저장된 금액 음성을 찾지 못했어요. 원래 음성 탭을 열어 둔 채 이 메시지를 알려 주세요.');
  return parseCurrencyBackup(raw, approved);
}

/** Shared metadata/base64 checks; importing a file never needs browser storage. */
export function parseCurrencyBackup(raw: string, approved: ApprovedCurrency) {
  if (raw.length > 2_200_000) throw new Error('저장 결과의 크기를 확인할 수 없어 중단했어요. 원본은 그대로 두었어요.');
  let row: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    row = parsed as Record<string, unknown>;
  } catch {
    throw new Error('저장 결과를 읽을 수 없어요. 원래 음성 탭을 열어 둔 채 이 메시지를 알려 주세요.');
  }
  if (row.id !== approved.id || row.text !== approved.text || row.requestId !== approved.requestId
    || row.voice !== approved.voice || row.requestText !== approved.requestText
    || row.responseSpokenText !== approved.text || row.reservedCharacters !== 17) {
    throw new Error('저장 결과가 승인된 금액 음성과 일치하지 않아 중단했어요. 원본은 그대로 두었어요.');
  }
  const audio = row.audioContent;
  if (typeof audio !== 'string' || !audio || audio.length > 2_000_000 || audio.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
    throw new Error('저장된 음성 데이터의 형식을 확인할 수 없어요. 원본은 그대로 두었어요.');
  }
  const decoded = atob(audio);
  if (btoa(decoded) !== audio) throw new Error('저장된 음성 데이터의 형식을 확인할 수 없어요. 원본은 그대로 두었어요.');
  // Return the exact stored JSON, including any existing extra metadata. Never re-encode audio.
  return { json: raw, audioBytes: decoded.length };
}
