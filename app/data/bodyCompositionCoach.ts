import type { RecordStores } from './recordStorage.ts';
import { OA_REPORT_INVENTORY } from '../lib/oaReportInventory.ts';
import { validMeasurementDate } from '../lib/bodyImport.ts';
import { getWorkoutRecord } from './workoutCompletion.ts';

// Display freshness policy, not a medical threshold or a measurement prescription.
export const BODY_COACH_RECENT_DAYS = 30;
const METRICS = [
  ['bodyFatPercent', '체지방률', '%'],
  ['fatMass', '지방량', 'kg'],
  ['muscleMass', '전체 근육량 추정치', 'kg'],
  ['musclePercent', '근육률', '%'],
  ['skeletalMuscleMass', '골격근량', 'kg'],
  ['trunkMuscleMass', '몸통 근육량 추정치', 'kg'],
  ['trunkFatMass', '몸통 지방량 추정치', 'kg'],
  ['bmi', 'BMI', ''],
] as const;
type MetricKey = typeof METRICS[number][0];
// OA transcription bounds already used by oaReportParser; not healthy ranges.
// Skeletal muscle is display-only legacy data (OA does not provide its mapping).
const NUMERIC_BOUNDS: Record<MetricKey, readonly [number, number]> = {
  bodyFatPercent: [1, 80], fatMass: [.1, 150], muscleMass: [5, 200],
  musclePercent: [1, 90], skeletalMuscleMass: [.1, 200],
  trunkMuscleMass: [1, 100], trunkFatMass: [.1, 80], bmi: [5, 80],
};
function validNumber(value: unknown, key: MetricKey): value is number {
  const [min, max] = NUMERIC_BOUNDS[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
type Status = 'missing' | 'invalid' | 'unverified' | 'stale' | 'historical' | 'single' | 'comparable';
export type BodyCoachMetric = {
  key: MetricKey; label: string; unit: string; status: Status;
  date?: string; value?: number; ageDays?: number; device?: string;
  fromDate?: string; delta?: number; count: number;
};
const dayNumber = (date: string) => Date.parse(date + 'T00:00:00Z') / 86_400_000;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function dateConflicts(record: Record<string, unknown>, date: string) {
  const source = object(object(record.metricSources).measurementDate);
  return source.method === 'ocr' && Boolean(source.originalText) && source.originalText !== date;
}

function sourceIdentity(record: Record<string, unknown>, key: MetricKey, unit: string) {
  const source = object(object(record.metricSources)[key]);
  const expectedLabel = OA_REPORT_INVENTORY.find(row => row[0] === key)?.[1];
  if (!expectedLabel || source.originalLabel !== expectedLabel || source.originalUnit !== unit ||
    !['OA Smart Scale PRO', 'OA long report'].includes(String(source.device)) ||
    source.mappingVersion !== 'oa-pro-v1' || !['ocr', 'ocr-edited'].includes(String(source.method)) ||
    (key.startsWith('trunk') && source.device !== 'OA Smart Scale PRO')) return undefined;
  return JSON.stringify([source.device, source.originalLabel, source.originalUnit, source.mappingVersion]);
}

/** Pure local read: no inferred values, conversions, writes or remote payload. */
export function buildBodyCompositionReview(
  stores: Pick<RecordStores, 'inbody' | 'workouts'>,
  today: string,
) {
  const validToday = validMeasurementDate(today, today);
  const entries = Object.entries(object(stores.inbody)).map(([date, row]) => [date, object(row)] as const);
  const valid = entries.filter(([date]) => validToday && validMeasurementDate(date, today)).sort(([a], [b]) => a.localeCompare(b));
  const relevant = ([, row]: typeof valid[number]) => METRICS.some(([key]) => key in row || key in object(row.metricSources));
  const latestDate = valid.filter(relevant).at(-1)?.[0];
  const metrics: BodyCoachMetric[] = METRICS.map(([key, label, unit]) => {
    // A missing latest metric is historical, never silently a current observation.
    const observations = valid.filter(([, row]) => key in row || key in object(row.metricSources));
    const latest = observations.at(-1);
    const base: BodyCoachMetric = { key, label, unit, status: 'missing', count: 0 };
    if (!latest) return base;
    const [date, row] = latest;
    if (dateConflicts(row, date)) {
      return { ...base, date, status: 'invalid' };
    }
    const value = row[key];
    const ageDays = dayNumber(today) - dayNumber(date);
    if (!validNumber(value, key)) return { ...base, date, ageDays, status: value === undefined ? 'missing' : 'invalid' };
    const identity = sourceIdentity(row, key, unit);
    const measured = { ...base, date, ageDays, value, count: 1 };
    if (!identity) return { ...measured, status: 'unverified' };
    const device = String(object(object(row.metricSources)[key]).device);
    const sourced = { ...measured, device };
    if (ageDays > BODY_COACH_RECENT_DAYS) return { ...sourced, status: 'stale' };
    if (date !== latestDate) return { ...sourced, status: 'historical' };
    const points: {date: string; value: number}[] = [];
    for (const [priorDate, prior] of [...observations].reverse()) {
      const v = prior[key];
      if (dayNumber(today) - dayNumber(priorDate) > BODY_COACH_RECENT_DAYS || dateConflicts(prior, priorDate) ||
        sourceIdentity(prior, key, unit) !== identity || !validNumber(v, key)) break;
      points.unshift({ date: priorDate, value: v });
      if (points.length === 12) break;
    }
    if (points.length < 2) return { ...sourced, status: 'single' };
    return { ...sourced, status: 'comparable', count: points.length, fromDate: points[0].date,
      delta: Math.round((value - points[0].value) * 10) / 10 };
  });
  const recentWorkouts = Object.entries(stores.workouts).filter(([date]) => validToday &&
    validMeasurementDate(date, today) && dayNumber(today) - dayNumber(date) < 7).map(([, row]) => getWorkoutRecord(row));
  const pain = recentWorkouts.some(row => row.workoutPain || row.workoutBackStatus === 'pain' ||
    row.workoutBackStatus === 'worse' || row.workoutNeurologicalSymptoms?.length ||
    row.pullupPain || row.foamRollerPain || row.workoutExerciseRecords?.some(exercise => (exercise.painScore ?? 0) > 0));
  const fatigue = recentWorkouts.some(row => (row.workoutFatigue ?? 0) >= 4 || row.workoutStatus === 'stopped');
  const comparable = metrics.filter(row => row.status === 'comparable' && row.key !== 'bmi');
  const kg = metrics.find(row => row.key === 'muscleMass')!;
  const percent = metrics.find(row => row.key === 'musclePercent')!;
  const paired = kg.status === 'comparable' && percent.status === 'comparable' &&
    kg.date === percent.date && kg.fromDate === percent.fromDate && kg.device === percent.device;
  const divergent = paired && Math.sign(kg.delta!) !== Math.sign(percent.delta!);
  const decreasingEstimate = comparable.some(row => row.key === 'muscleMass' && row.delta! < 0);
  const nextAction = pain
    ? '통증·허리 악화·신경 증상 기록을 먼저 확인하세요. 체성분 변화로 운동 강도를 올리지 말고 증상을 유발하는 동작은 중단하세요. 기존 중단 기준을 우선합니다.'
    : fatigue
      ? '높은 피로 또는 중단 기록이 있습니다. 체성분보다 회복 상태를 먼저 확인하고 운동 홈의 조정 제안을 검토하세요.'
      : !comparable.length
        ? '비교 가능한 최근 체성분 자료가 부족합니다. 날짜·기기·단위를 확인하고, 운동 조정은 실제 수행 기록·통증·피로를 기준으로 검토하세요.'
        : divergent || decreasingEstimate
          ? '근육량 추정치의 감소나 kg·% 방향 차이를 근손실로 단정하지 않습니다. 측정 조건과 같은 루틴의 수행·피로 기록을 함께 확인하세요. 이를 보상하려고 운동량을 늘리지 않습니다.'
          : '비교 가능한 체성분 수치가 있습니다. 변화의 원인을 운동 효과로 단정하지 않고, 운동 홈에서 같은 루틴의 수행·통증·피로와 함께 계획을 검토하세요.';
  return {
    today, latestDate, metrics, divergent, nextAction,
    priority: pain ? 'pain' as const : fatigue ? 'fatigue' as const : 'body-context' as const,
    excludedDateCount: entries.filter(row => relevant(row) && (!validToday || !validMeasurementDate(row[0], today))).length,
    limitation: '수치는 기기 추정치이며 측정 조건은 확인되지 않았습니다. 근육량·근육률을 골격근량으로 환산하지 않으며 의료 진단이나 허리 질환 적합성 판단에 사용하지 않습니다.',
    criteria: `최근 표시는 기준일로부터 ${BODY_COACH_RECENT_DAYS}일 이내라는 앱 표시 기준입니다. 같은 항목·기기·원문 단위·매핑의 연속 기록 최대 12회 첫 값과 끝 값을 비교하며, 출처 변경·잘못된 값에서는 연결을 끊습니다. 운동 강도 기준이 아닙니다.`,
  };
}

export type BodyCompositionReview = ReturnType<typeof buildBodyCompositionReview>;
