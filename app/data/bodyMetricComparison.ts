import type { InbodyRecordStore } from './recordStorage';

export type ComparableBodyMetric = 'bodyFatPercent' | 'musclePercent' | 'skeletalMuscleMass' | 'muscleMass' | 'fatMass' | 'trunkMuscleMass' | 'trunkFatMass';
function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const time = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
}
export function latestBodyMeasurementDate(records: InbodyRecordStore, cutoff?: string) {
  return Object.entries(records).filter(([date, record]) => validDate(date) && (!cutoff || date <= cutoff) &&
    Object.values(record).some(value => typeof value === 'number' && Number.isFinite(value) && value > 0))
    .map(([date]) => date).sort().at(-1);
}

/** Retain stored values; only comparable, positive observations enter a chart. */
export function getBodyMetricSeries(records: InbodyRecordStore, key: ComparableBodyMetric, limit = 12, cutoff?: string) {
  const expectedUnit = key === 'bodyFatPercent' || key === 'musclePercent' ? '%' : 'kg';
  const observations = Object.entries(records).filter(([date, record]) => validDate(date) && (!cutoff || date <= cutoff) &&
    typeof record[key] === 'number' && Number.isFinite(record[key]) && record[key]! > 0 && (expectedUnit !== '%' || record[key]! <= 100) &&
    (!record.metricSources?.[key]?.originalUnit || record.metricSources[key]!.originalUnit === expectedUnit))
    .sort(([a], [b]) => a.localeCompare(b)).map(([dateKey, record]) => {
      const source = record.metricSources?.[key];
      const identity = source?.device && source.originalLabel && source.originalUnit === expectedUnit && source.mappingVersion ? JSON.stringify([source.device, source.originalLabel, source.originalUnit, source.mappingVersion]) : undefined;
      return { dateKey, value: record[key]!, identity };
    });
  const latest = observations.at(-1);
  if (!latest) return { points: [] as { dateKey: string; value: number }[], sourceVerified: false, note: '미제공 또는 유효한 기록 없음 · 0으로 대신하지 않아요.' };
  let start = observations.length - 1;
  while (start > 0 && observations[start - 1].identity === latest.identity) start--;
  const points = observations.slice(start).slice(-limit).map(({dateKey,value}) => ({dateKey,value}));
  const note = latest.identity ? '지표·기기 출처 표기·원문 단위가 같은 기록만 연결했어요. 측정 조건까지 같다는 뜻은 아니에요.' : '출처 미확인 기록의 수치 차이입니다. 같은 기기인지 확인해 주세요.';
  return { points, sourceVerified: Boolean(latest.identity), note: note + (start ? ' 출처가 바뀐 이전 기록은 연결하지 않아요.' : '') };
}

/** Descriptive endpoint comparison, never a clinical or tissue-change judgment. */
export function getWholeMuscleTrend(records: InbodyRecordStore, cutoff?: string) {
  const mass = getBodyMetricSeries(records, 'muscleMass', 12, cutoff);
  const percent = getBodyMetricSeries(records, 'musclePercent', 12, cutoff);
  const summarize = (series: typeof mass, unit: string) => {
    const first = series.points[0];
    const last = series.points.at(-1);
    const delta = first && last && series.points.length >= 2 ? Math.round((last.value - first.value) * 10) / 10 : undefined;
    const direction = delta === undefined ? 'unknown' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
    const label = !last ? '미제공' : delta === undefined ? '1회 기록 · 비교 자료 부족' : !series.sourceVerified ? '출처 미확인 · 비교 자료 부족' : direction === 'up' ? '기록 수치 증가' : direction === 'down' ? '기록 수치 감소' : '표시상 동일';
    return { ...series, first, last, delta, direction, label, unit };
  };
  const kg = summarize(mass, 'kg');
  const rate = summarize(percent, '%p');
  const samePeriod = kg.first?.dateKey === rate.first?.dateKey && kg.last?.dateKey === rate.last?.dateKey;
  const massSource = kg.last && records[kg.last.dateKey].metricSources?.muscleMass;
  const rateSource = rate.last && records[rate.last.dateKey].metricSources?.musclePercent;
  const paired = samePeriod && kg.sourceVerified && rate.sourceVerified && kg.delta !== undefined && rate.delta !== undefined && massSource?.device === rateSource?.device && massSource?.mappingVersion === rateSource?.mappingVersion;
  const divergent = paired && kg.direction !== rate.direction;
  const latestRecord = latestBodyMeasurementDate(records, cutoff);
  const historical = Boolean(kg.last && kg.last.dateKey !== latestRecord);
  return {
    kg, rate, paired, divergent, historical,
    explanation: divergent
      ? 'kg와 %의 변화 방향이 다릅니다. 근육 증가·유지·손실을 단정하지 않아요.'
      : !paired ? 'kg와 %를 함께 해석할 비교 자료가 부족해요. 같은 기간·기기 출처인지 확인해 주세요.'
      : '같은 기간의 kg와 % 기록을 나란히 비교합니다. 실제 근육 조직의 변화를 확정하지 않아요.',
    limitation: '측정 조건 미확인 · 실제 근육 변화 판단에는 자료가 부족해요. 근육률 상승은 체중·지방 변화로도 생길 수 있고, 근육량 추정치는 수분 상태와 측정 조건의 영향을 받을 수 있어요. 골격근량으로 환산하지 않습니다.',
    criteria: '표시 기준: 각 지표에서 출처 표기가 이어지는 마지막 최대 12회 중 첫 값과 끝 값의 차이를 소수 첫째 자리로 표시합니다. 양수는 수치 증가, 음수는 수치 감소, 0은 표시상 동일이며 임상 기준이나 유지 판정이 아닙니다. 최근은 저장 날짜 순서이며 오늘의 상태를 뜻하지 않습니다. 0·누락·잘못된 날짜·단위 불일치는 제외하고, 출처가 바뀌면 연결하지 않습니다.',
  };
}
