import type { BodyMetricSources } from '../data/recordStorage';
import type { OaDraftMeasurement, OaReportResult } from './oaReportParser';

export const OA_TRUNK_ROWS = [
  ['trunkMuscleMass', '신체 근육량'], ['trunkFatMass', '체지방량'],
] as const;

export function oaSourceMeasurements(result: OaReportResult): OaDraftMeasurement[] {
  return OA_TRUNK_ROWS.flatMap(([key, label]) => {
    const reference = result.unmappedMeasurements?.find(item => item.label === label);
    if (reference) return [{ ...reference }];
    const value = result.values[key];
    return value !== undefined && result.metricSources?.[key]?.originalLabel === label
      ? [{ source: 'OA' as const, label, value, unit: 'kg' as const }] : [];
  });
}

type MappingDraft = {
  patch: Record<string, string>;
  metricSources: BodyMetricSources;
  sourceMeasurements: OaDraftMeasurement[];
  unmappedMeasurements: OaDraftMeasurement[];
  autoMappedKeys: string[];
};

/** Only this draft's untouched automatic mappings may be removed or replaced. */
export function setOaProMapping<T extends MappingDraft>(draft: T, confirmed: boolean): T {
  const patch = { ...draft.patch }, metricSources = { ...draft.metricSources };
  const autoMappedKeys = new Set(draft.autoMappedKeys);
  const unmappedMeasurements: OaDraftMeasurement[] = [];
  for (const item of draft.sourceMeasurements) {
    const key = OA_TRUNK_ROWS.find(([, label]) => label === item.label)?.[0];
    if (!key) continue;
    if (confirmed && (!Object.hasOwn(patch, key) || autoMappedKeys.has(key))) {
      patch[key] = String(item.value);
      metricSources[key] = { device: 'OA Smart Scale PRO', originalLabel: item.label, originalUnit: item.unit,
        originalText: `${item.value}${item.unit}`, method: 'ocr', mappingVersion: 'oa-pro-v1' };
      autoMappedKeys.add(key);
    } else if (!confirmed && autoMappedKeys.has(key)) {
      delete patch[key]; delete metricSources[key]; autoMappedKeys.delete(key);
      unmappedMeasurements.push(item);
    } else if (!autoMappedKeys.has(key)) {
      if (!confirmed && metricSources[key]) metricSources[key] = { ...metricSources[key], device: 'OA long report' };
      unmappedMeasurements.push(item);
    }
  }
  return { ...draft, patch, metricSources, autoMappedKeys: [...autoMappedKeys], unmappedMeasurements };
}
