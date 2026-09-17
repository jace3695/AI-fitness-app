import type { GrowthSessionStatus } from './growthPlatform.ts';

type Day = { date: string; status: GrowthSessionStatus };
const flags = ['workoutDone', 'cardioDone', 'rosaryCardioDone', 'postWorkoutCardioDone', 'pullupDone'];
const statuses = ['completed', 'partial', 'stopped'];
const emptyCounts = () => ({ recorded: 0, completed: 0, partial: 0, stopped: 0 });

// Only explicit execution markers count. A plan, memo, duration or missing entry
// does not establish whether the user exercised. Never migrate or write here.
function hasWorkoutRecord(value: unknown): boolean | null {
  if (value === undefined || value === null || value === false) return false;
  if (value === true) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (flags.some(key => record[key] != null && typeof record[key] !== 'boolean')) return null;
  if (record.workoutStatus != null && !statuses.includes(String(record.workoutStatus))) return null;
  return flags.some(key => record[key] === true) || statuses.includes(String(record.workoutStatus));
}

export function summarizeGrowthWorkoutPatterns(days: readonly Day[], raw: unknown) {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (value == null) value = {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const store = value as Record<string, unknown>;
  const withWorkout = emptyCounts();
  const unconfirmed = emptyCounts();
  const evidence = [];
  for (const day of days) {
    const workoutRecorded = hasWorkoutRecord(Object.hasOwn(store, day.date) ? store[day.date] : undefined);
    if (workoutRecorded === null) return null;
    const group = workoutRecorded ? withWorkout : unconfirmed;
    group.recorded++;
    group[day.status]++;
    evidence.push({ ...day, workoutRecorded });
  }
  let suggestion = '두 묶음에 루틴 기록이 각각 4일 이상 모이면 완료 비율을 비교해 안내해요.';
  if (withWorkout.recorded >= 4 && unconfirmed.recorded >= 4) {
    const difference = withWorkout.completed / withWorkout.recorded - unconfirmed.completed / unconfirmed.recorded;
    suggestion = difference <= -0.25
      ? '운동 기록이 함께 있는 날의 루틴 완료 비율이 더 낮았어요. 그날의 여유 시간을 살펴보고 목표 시간이나 요일을 검토해 보세요.'
      : difference >= 0.25
        ? '운동 기록이 함께 있는 날의 루틴 완료 비율이 더 높았어요. 목표를 늘리기보다 현재 일정이 편한지 먼저 살펴보세요.'
        : '두 묶음의 루틴 완료 비율 차이가 크지 않아요. 현재 일정을 유지하며 기록을 더 모아도 좋아요.';
  }
  return { withWorkout, unconfirmed, evidence, suggestion };
}
