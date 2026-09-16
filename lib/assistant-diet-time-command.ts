import { isMealTime, parseFastingStart, fastingStartForDay } from './diet-time.ts';
export type DietTimeChange = { kind: 'time'; time: string };
export type DietTimeSnapshot = { record?: Record<string, unknown>; water?: number; meal?: Record<string, unknown>; dinnerTime?: string; fastingStart?: unknown };
export const DIET_TIME_STORE_KEYS = { meal: 'ai-fitness-diet-meal-log', dinnerTime: 'ai-fitness-diet-dinner-completed-time' } as const;
export const DIET_FASTING_KEY = 'ai-fitness-fasting-start-time';
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const optionalTime = (value: unknown) => value === undefined || value === '' || isMealTime(value);
export function isDietTimeChange(value: unknown): value is DietTimeChange {
  return object(value) && Object.keys(value).sort().join() === 'kind,time' && value.kind === 'time' && isMealTime(value.time);
}
export function isDietTimeSnapshot(value: DietTimeSnapshot, day?: string) {
  if ((value.meal !== undefined && !object(value.meal)) || !optionalTime(value.record?.lastMealTime) || !optionalTime(value.meal?.lastMealTime) || !optionalTime(value.dinnerTime)) return false;
  try { const parsed = parseFastingStart(value.fastingStart); return typeof parsed === 'string' || (Boolean(day) && optionalTime(parsed[day!])); }
  catch { return false; }
}
export function dietTimeNextSnapshot(before: DietTimeSnapshot, change: DietTimeChange, day?: string): DietTimeSnapshot {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !isDietTimeChange(change) || !isDietTimeSnapshot(before, day)) throw new Error('기존 식사 시각을 확인하지 못했습니다. 식단 화면에서 확인해 주세요.');
  const parsed = parseFastingStart(before.fastingStart);
  return { ...before,
    record: { ...before.record, lastMealTime: change.time, dinnerBefore1830: change.time <= '18:30' },
    meal: { ...before.meal, lastMealTime: change.time }, dinnerTime: change.time,
    fastingStart: { ...(typeof parsed === 'object' ? parsed : {}), [day]: change.time },
  };
}
export function describeDietTime(snapshot: DietTimeSnapshot, day?: string) {
  const values = [snapshot.record?.lastMealTime, snapshot.meal?.lastMealTime, snapshot.dinnerTime, fastingStartForDay(snapshot.fastingStart, day ?? '')];
  const times = [...new Set(values.filter(value => isMealTime(value)))];
  if (times.length <= 1) return `마지막 식사 ${times[0] ?? '시각 미기록'}`;
  return ['식단 요약', '끼니 기록', '저녁 기록', '공복 시작'].map((label, i) => `${label} ${values[i] || '미기록'}`).join(' · ');
}
