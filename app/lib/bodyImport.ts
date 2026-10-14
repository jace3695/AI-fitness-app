import type { InbodyRecordStore, WeightRecordStore } from '../data/recordStorage';

export function validMeasurementDate(value: string, today: string) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value) || value > today) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function bodyForm(weights: WeightRecordStore, inbody: InbodyRecordStore, date: string): Record<string, string> {
  const values = Object.fromEntries(Object.entries(inbody[date] || {}).map(([key, value]) => [key, String(value)]));
  if (weights[date]) values.weight = String(weights[date].weight);
  return values;
}

/** Only recognized or explicitly edited fields belong to an import patch. */
export function mergeBodyImport(weights: WeightRecordStore, inbody: InbodyRecordStore, date: string, patch: Record<string, string>, today: string) {
  if (!validMeasurementDate(date, today)) throw new Error('실제 측정 날짜를 확인해 주세요. 미래 날짜는 저장할 수 없습니다.');
  const nextWeights = { ...weights };
  const record = { ...inbody[date] };
  for (const [key, raw] of Object.entries(patch)) {
    const input = raw.trim();
    if (key === 'memo') { record.memo = input; continue; }
    const value = Number(input);
    if (input && (!Number.isFinite(value) || value < 0 || (key === 'weight' && value === 0))) throw new Error('수치를 0 이상의 숫자로 확인해 주세요. 체중은 0보다 커야 합니다.');
    if (key === 'weight') {
      const rounded = Math.round(value * 10) / 10;
      if (input && (!Number.isFinite(rounded) || rounded <= 0)) throw new Error('체중은 소수 첫째 자리 반올림 후에도 0보다 커야 합니다.');
      if (input) nextWeights[date] = { weight: rounded, recordedAt: new Date().toISOString() };
      else delete nextWeights[date];
      delete record.weight;
    } else if (input) Object.assign(record, { [key]: value });
    else delete record[key as keyof typeof record];
  }
  const nextInbody = { ...inbody };
  if (Object.keys(record).length) nextInbody[date] = record;
  else delete nextInbody[date];
  return { weights: nextWeights, inbody: nextInbody };
}

// Includes the epoch so sign-out/sign-in to the same account invalidates work too.
export function bodyImportOwner(storage: Pick<Storage, 'getItem'>) {
  return JSON.stringify([storage.getItem('fitness-cloud-sync-user'), storage.getItem('fitness-cloud-sync-epoch')]);
}
