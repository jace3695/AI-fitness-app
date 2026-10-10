import { workoutHistoryPeriod } from './workoutTimeHistory.ts';

export const WORKOUT_PAIN_AREAS = ['허리', '골반', '무릎', '발목', '어깨', '손목', '기타'] as const;
export type WorkoutPainArea = typeof WORKOUT_PAIN_AREAS[number];
type FieldState = 'answered' | 'missing' | 'invalid';
type RecordMap = Record<string, unknown>;
export interface PainEvidenceSource {
  date: string;
  status: 'completed' | 'partial' | 'stopped' | 'unknown';
  rawStatus: unknown;
  rawDone: unknown;
  areaState: FieldState;
  pairState: FieldState;
  area: WorkoutPainArea | null;
  exercise: string | null;
  pairKey: string | null;
  rawArea: unknown;
  rawExercise: unknown;
  rawPainSet: unknown;
  painSet: number | null;
  rawPain: unknown;
  rawBack: unknown;
  rawNeurologicalSymptoms: unknown;
  linkedExercises: RecordMap[];
  invalidExerciseRecords: boolean;
  invalidRow: boolean;
}
export interface PainEvidenceCoverage {
  start: string; end: string; calendarDates: number;
  recorded: number; areaAnswered: number; areaMissing: number; areaInvalid: number;
  pairAnswered: number; pairMissing: number; pairInvalid: number;
  invalidRows: number; unrecorded: number;
}
export interface PainEvidencePair {
  key: string; area: WorkoutPainArea; exercise: string; dates: string[];
  recent: number; previous: number;
}
export interface WorkoutPainEvidenceSummary {
  today: string; total: PainEvidenceCoverage; recent: PainEvidenceCoverage; previous: PainEvidenceCoverage;
  sources: PainEvidenceSource[]; pairs: PainEvidencePair[]; repeated: PainEvidencePair[];
}

const feedbackFields = ['workoutPain', 'workoutBackStatus', 'workoutPainArea', 'workoutPainExercise', 'workoutPainSet',
  'workoutDifficulty', 'workoutFatigue', 'workoutLastSetRpe', 'workoutNeurologicalSymptoms'];
export const isPainEvidenceMap = (value: unknown): value is RecordMap => value !== null && typeof value === 'object' && !Array.isArray(value);
const missing = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && !value.trim());
export const positivePainSet = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const statusOf = (row: RecordMap): PainEvidenceSource['status'] => row.workoutStatus === 'completed' || row.workoutStatus === 'partial' || row.workoutStatus === 'stopped'
  ? row.workoutStatus : row.workoutDone === true ? 'completed' : 'unknown';

function sourceFor(date: string, value: unknown): PainEvidenceSource | null {
  if (value === false) return null;
  const invalidRow = value !== true && !isPainEvidenceMap(value);
  const row = isPainEvidenceMap(value) ? value : {};
  const records = row.workoutExerciseRecords;
  const invalidExerciseRecords = Object.hasOwn(row, 'workoutExerciseRecords') && !Array.isArray(records);
  if (!invalidRow && value !== true && statusOf(row) === 'unknown'
    && !feedbackFields.some(key => Object.hasOwn(row, key))
    && !(Array.isArray(records) && records.length) && !invalidExerciseRecords) return null;
  const rawArea = row.workoutPainArea, rawExercise = row.workoutPainExercise;
  const area = WORKOUT_PAIN_AREAS.includes(rawArea as WorkoutPainArea) ? rawArea as WorkoutPainArea : null;
  const exercise = typeof rawExercise === 'string' && rawExercise.trim() ? rawExercise.trim() : null;
  const areaState: FieldState = invalidRow ? 'invalid' : area ? 'answered' : missing(rawArea) ? 'missing' : 'invalid';
  const exerciseState: FieldState = invalidRow ? 'invalid' : exercise ? 'answered' : missing(rawExercise) ? 'missing' : 'invalid';
  const pairState = areaState === 'invalid' || exerciseState === 'invalid' ? 'invalid'
    : areaState === 'answered' && exerciseState === 'answered' ? 'answered' : 'missing';
  return {
    date, status: value === true ? 'completed' : statusOf(row), rawStatus: row.workoutStatus,
    rawDone: value === true ? true : row.workoutDone, areaState, pairState, area, exercise,
    pairKey: pairState === 'answered' ? JSON.stringify([area, exercise]) : null,
    rawArea, rawExercise, rawPainSet: row.workoutPainSet, painSet: positivePainSet(row.workoutPainSet) ? row.workoutPainSet : null,
    rawPain: row.workoutPain, rawBack: row.workoutBackStatus, rawNeurologicalSymptoms: row.workoutNeurologicalSymptoms,
    // Exact, trimmed-name identity only. Repeated rows/rounds are retained as candidates, never added to date counts.
    linkedExercises: Array.isArray(records) && exercise ? records.filter((item): item is RecordMap => isPainEvidenceMap(item)
      && typeof item.exerciseName === 'string' && item.exerciseName.trim() === exercise) : [],
    invalidExerciseRecords: invalidExerciseRecords || (Array.isArray(records) && records.some(item => !isPainEvidenceMap(item))), invalidRow,
  };
}

function coverage(sources: PainEvidenceSource[], start: string, end: string, calendarDates: number): PainEvidenceCoverage {
  const rows = sources.filter(source => source.date >= start && source.date <= end);
  const valid = rows.filter(source => !source.invalidRow);
  const count = (field: 'areaState' | 'pairState', state: FieldState) => valid.filter(source => source[field] === state).length;
  return { start, end, calendarDates, recorded: valid.length, areaAnswered: count('areaState', 'answered'), areaMissing: count('areaState', 'missing'),
    areaInvalid: count('areaState', 'invalid'), pairAnswered: count('pairState', 'answered'), pairMissing: count('pairState', 'missing'),
    pairInvalid: count('pairState', 'invalid'), invalidRows: rows.length - valid.length, unrecorded: calendarDates - rows.length };
}

/** Stored-date input facts only. Does not infer exposure, no-pain answers, diagnosis, causes or actual occurrence dates. */
export function workoutPainEvidence(store: unknown, today: string): WorkoutPainEvidenceSummary | null {
  const period = workoutHistoryPeriod(today);
  if (!period || !isPainEvidenceMap(store)) return null;
  const anchor = Date.parse(`${today}T12:00:00Z`);
  const offset = (days: number) => new Date(anchor - days * 86400000).toISOString().slice(0, 10);
  const recentStart = offset(14), previousEnd = offset(15);
  const sources = Object.entries(store).filter(([date]) => date >= period.start && date <= period.end && workoutHistoryPeriod(date))
    .map(([date, row]) => sourceFor(date, row)).filter((source): source is PainEvidenceSource => source !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
  const groups = new Map<string, PainEvidencePair>();
  for (const source of sources) {
    if (!source.pairKey || !source.area || !source.exercise) continue;
    const pair = groups.get(source.pairKey) ?? { key: source.pairKey, area: source.area, exercise: source.exercise, dates: [], recent: 0, previous: 0 };
    pair.dates.push(source.date);
    if (source.date >= recentStart) pair.recent++; else pair.previous++;
    groups.set(source.pairKey, pair);
  }
  const pairs = [...groups.values()].sort((a, b) => b.dates[0].localeCompare(a.dates[0])
    || WORKOUT_PAIN_AREAS.indexOf(a.area) - WORKOUT_PAIN_AREAS.indexOf(b.area) || (a.exercise < b.exercise ? -1 : a.exercise > b.exercise ? 1 : 0));
  return { today, total: coverage(sources, period.start, period.end, 28), recent: coverage(sources, recentStart, period.end, 14),
    previous: coverage(sources, period.start, previousEnd, 14), sources, pairs, repeated: pairs.filter(pair => pair.dates.length >= 2) };
}

/** Never invoke the general guide fallback for an unregistered/prototype name. */
export function exactPainEvidenceGuide<T>(dictionary: Record<string, T>, name: string): T | null {
  return Object.hasOwn(dictionary, name) ? dictionary[name] : null;
}

/** Text projection only: React escapes it. Invalid values remain distinguishable from missing answers. */
export function painEvidenceRawText(value: unknown): string {
  if (value === undefined) return '미입력';
  if (typeof value === 'string') return value.length ? JSON.stringify(value) : '빈 문자열';
  try { return JSON.stringify(value) ?? String(value); } catch { return '값 확인불가'; }
}
