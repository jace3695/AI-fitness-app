import type { BodyMetricSources } from '../data/recordStorage';
import type { OaDraftMeasurement, OaReportResult } from './oaReportParser';
import { OA_REPORT_INVENTORY } from './oaReportInventory.ts';

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
  // These sources belong to the active photo draft, never to stored records.
  // Confirmation changes device provenance, not values or metric equivalence.
  for (const [key, label, unit] of OA_REPORT_INVENTORY) {
    const source = metricSources[key];
    if (!source || !['OA long report', 'OA Smart Scale PRO'].includes(source.device)
      || source.originalLabel !== label || source.originalUnit !== unit
      || source.mappingVersion !== 'oa-pro-v1' || !['ocr', 'ocr-edited'].includes(source.method)) continue;
    metricSources[key] = { ...source, device: confirmed ? 'OA Smart Scale PRO' : 'OA long report' };
  }
  const autoMappedKeys = new Set(draft.autoMappedKeys);
  const unmappedMeasurements: OaDraftMeasurement[] = [];
  for (const item of draft.sourceMeasurements) {
    if (item.source !== 'OA' || item.unit !== 'kg') { unmappedMeasurements.push(item); continue; }
    const key = OA_TRUNK_ROWS.find(([, label]) => label === item.label)?.[0];
    if (!key) { unmappedMeasurements.push(item); continue; }
    if (confirmed && (!Object.hasOwn(patch, key) || autoMappedKeys.has(key))) {
      patch[key] = String(item.value);
      metricSources[key] = { device: 'OA Smart Scale PRO', originalLabel: item.label, originalUnit: item.unit,
        originalText: `${item.value}${item.unit}`, method: 'ocr', mappingVersion: 'oa-pro-v1' };
      autoMappedKeys.add(key);
    } else if (!confirmed && autoMappedKeys.has(key)) {
      delete patch[key]; delete metricSources[key]; autoMappedKeys.delete(key);
      unmappedMeasurements.push(item);
    } else if (!autoMappedKeys.has(key)) {
      unmappedMeasurements.push(item);
    }
  }
  return { ...draft, patch, metricSources, autoMappedKeys: [...autoMappedKeys], unmappedMeasurements };
}
