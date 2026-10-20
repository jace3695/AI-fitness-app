import type { InbodyRecord } from '../data/recordStorage';

export const OA_CORRECTION_FIELDS = [
  ['bodyFatPercent', '체지방률', '%'], ['muscleMass', '근육량', 'kg'],
  ['musclePercent', '근육률', '%'], ['fatMass', '지방량', 'kg'],
] as const;

/** The caller must obtain explicit confirmation; never infer missing provenance. */
export function oaCorrectionKeys(record: InbodyRecord) {
  return OA_CORRECTION_FIELDS.filter(([key, label, unit]) => {
    const source = record.metricSources?.[key], value = record[key];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && (unit !== '%' || value <= 100)
      && source?.device === 'OA long report' && source.originalLabel === label
      && source.originalUnit === unit && source.mappingVersion === 'oa-pro-v1'
      && ['ocr', 'ocr-edited'].includes(source.method);
  }).map(([key]) => key);
}

export function correctOaSourceDevice(record: InbodyRecord): InbodyRecord {
  const metricSources = { ...record.metricSources };
  for (const key of oaCorrectionKeys(record)) metricSources[key] = { ...metricSources[key]!, device: 'OA Smart Scale PRO' };
  return { ...record, metricSources };
}
