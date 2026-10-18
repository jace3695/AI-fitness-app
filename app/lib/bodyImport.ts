import type { InbodyRecord, InbodyRecordStore, WeightRecordStore, BodyMetricSources } from '../data/recordStorage';

/** Preserve fields a particular editor does not own, including future fields. */
export function mergeBodyFields(previous: InbodyRecord | undefined, patch: Record<string, string>, sources: BodyMetricSources = {}) {
  const record = { ...previous };
  const metricSources = { ...previous?.metricSources };
  for (const [key, raw] of Object.entries(patch)) {
    if (key === 'metricSources') continue;
    const input = raw.trim();
    if (key === 'memo') { if (input) record.memo = input; else delete record.memo; continue; }
    const textField = ['reportedBodyAgeUnit', 'bodyShape', 'measurementTime'].includes(key);
    if (key === 'measurementTime' && input && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(input)) throw new Error('측정 시간을 00:00:00–23:59:59 범위로 입력해 주세요.');
    if (textField && input.length > 80) throw new Error('원문은 80자 이내로 입력해 주세요.');
    const value = textField ? input : Number(input);
    if (!textField && input && (!Number.isFinite(value) || Number(value) < 0)) throw new Error('수치를 0 이상의 숫자로 확인해 주세요.');
    if (!input) delete metricSources[key];
    else if (sources[key]) metricSources[key] = { ...sources[key] };
    else if (previous?.[key as keyof InbodyRecord] !== value && metricSources[key]) metricSources[key] = { ...metricSources[key], method: 'ocr-edited' };
    if (input) Object.assign(record, { [key]: value });
    else delete record[key as keyof InbodyRecord];
    if (key === 'reportedBodyAgeUnit' && previous?.reportedBodyAgeUnit !== input && metricSources.reportedBodyAge && !sources.reportedBodyAge) metricSources.reportedBodyAge = { ...metricSources.reportedBodyAge, method: 'ocr-edited' };
  }
  if (Object.keys(metricSources).length) record.metricSources = metricSources;
  else delete record.metricSources;
  return record;
}

export function validMeasurementDate(value: string, today: string) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value) || value > today) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function bodyForm(weights: WeightRecordStore, inbody: InbodyRecordStore, date: string): Record<string, string> {
  const values = Object.fromEntries(Object.entries(inbody[date] || {}).filter(([key]) => key !== 'metricSources').map(([key, value]) => [key, String(value)]));
  if (weights[date]) values.weight = String(weights[date].weight);
  return values;
}

/** Only recognized or explicitly edited fields belong to an import patch. */
export function mergeBodyImport(weights: WeightRecordStore, inbody: InbodyRecordStore, date: string, patch: Record<string, string>, today: string, sources: BodyMetricSources = {}) {
  if (!validMeasurementDate(date, today)) throw new Error('실제 측정 날짜를 확인해 주세요. 미래 날짜는 저장할 수 없습니다.');
  const nextWeights = { ...weights };
  const { weight: _weight, ...bodyPatch } = patch;
  void _weight;
  const record = mergeBodyFields(inbody[date], bodyPatch, sources);
  for (const key of ['weight', 'measurementDate']) {
    if (sources[key]) record.metricSources = { ...record.metricSources, [key]: { ...sources[key], ...(key === 'measurementDate' && sources[key].originalText !== date ? { method: 'ocr-edited' as const } : {}) } };
  }
  for (const [key, raw] of Object.entries(patch)) {
    const input = raw.trim();
    if (key !== 'weight') continue;
    const value = Number(input);
    if (input && (!Number.isFinite(value) || value < 0 || (key === 'weight' && value === 0))) throw new Error('수치를 0 이상의 숫자로 확인해 주세요. 체중은 0보다 커야 합니다.');
    if (key === 'weight') {
      const rounded = Math.round(value * 10) / 10;
      if (input && (!Number.isFinite(rounded) || rounded <= 0)) throw new Error('체중은 소수 첫째 자리 반올림 후에도 0보다 커야 합니다.');
      if (input) nextWeights[date] = { weight: rounded, recordedAt: new Date().toISOString() };
      else {
        delete nextWeights[date];
        if (record.metricSources) delete record.metricSources.weight;
      }
      delete record.weight;
    }
  }
  const nextInbody = { ...inbody };
  if (record.metricSources && !Object.keys(record.metricSources).length) delete record.metricSources;
  if (Object.keys(record).length) nextInbody[date] = record;
  else delete nextInbody[date];
  return { weights: nextWeights, inbody: nextInbody };
}

// Includes the epoch so sign-out/sign-in to the same account invalidates work too.
export function bodyImportOwner(storage: Pick<Storage, 'getItem'>) {
  return JSON.stringify([storage.getItem('fitness-cloud-sync-user'), storage.getItem('fitness-cloud-sync-epoch')]);
}
