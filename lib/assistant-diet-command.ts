import { DIET_TIME_STORE_KEYS, DIET_FASTING_KEY, dietTimeNextSnapshot, describeDietTime, isDietTimeChange, isDietTimeSnapshot, type DietTimeChange, type DietTimeSnapshot } from './assistant-diet-time-command.ts';
import { DIET_MEAL_STORE_KEYS, dietMealNextSnapshot, describeDietMeal, isDietMealChange, isDietMealSnapshot, type DietMealChange, type DietMealSnapshot } from './assistant-diet-meal-command.ts';

export const DIET_RECORD_KEY = 'ai-fitness-diet-completed-days';
export const DIET_WATER_KEY = 'ai-fitness-water-intake';
export type DietDaySnapshot = DietMealSnapshot & DietTimeSnapshot;
export type DietCommandChange = { kind: 'water'; totalMl: number } | { kind: 'memo'; text: string } | DietMealChange | DietTimeChange;
export type DietCommandProposal = {
  domain: 'diet'; ownerId: string; requestId: string; date: string; change: DietCommandChange; expected: DietDaySnapshot;
  resetMarkers: { diet: string | null; assistant: string | null }; expiresAt: string;
};
export type DietCommandReceipt = {
  user_id: string; id: string; record_date: string; change: DietCommandChange;
  before_values: DietDaySnapshot; after_values: DietDaySnapshot; created_at: string; undone_at: string | null;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const waterValue = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function isDietSnapshot(value: unknown, kind?: DietCommandChange['kind'], day?: string): value is DietDaySnapshot {
  return object(value) && Object.keys(value).every(key => key === 'record' || key === 'water' || (kind === 'meal' && Object.hasOwn(DIET_MEAL_STORE_KEYS, key)) || (kind === 'time' && (Object.hasOwn(DIET_TIME_STORE_KEYS, key) || key === 'fastingStart')))
    && (!Object.hasOwn(value, 'record') || object(value.record))
    && (!Object.hasOwn(value, 'water') || waterValue(value.water)) && (kind !== 'meal' || isDietMealSnapshot(value)) && (kind !== 'time' || isDietTimeSnapshot(value, day));
}
export function dietDaySnapshot(state: Record<string, unknown>, date: string, change?: DietCommandChange): DietDaySnapshot {
  const snapshot: Record<string, unknown> = {};
  const keys = { record: DIET_RECORD_KEY, water: DIET_WATER_KEY, ...(change?.kind === 'meal' ? DIET_MEAL_STORE_KEYS : change?.kind === 'time' ? DIET_TIME_STORE_KEYS : {}) };
  for (const [field, key] of Object.entries(keys)) {
    const raw = state[key];
    let store: unknown;
    try { store = raw === undefined ? {} : typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch { throw new Error('식단 기록 형식을 확인하지 못했습니다. 식단 화면에서 확인해 주세요.'); }
    if (!object(store)) throw new Error('식단 기록 형식을 확인하지 못했습니다. 식단 화면에서 확인해 주세요.');
    if (Object.hasOwn(store, date)) snapshot[field] = store[date];
  }
  if (change?.kind === 'time' && Object.hasOwn(state, DIET_FASTING_KEY)) snapshot.fastingStart = state[DIET_FASTING_KEY];
  if (!isDietSnapshot(snapshot, change?.kind, date)) throw new Error('오늘 식단 기록을 확인하지 못했습니다. 식단 화면에서 확인해 주세요.');
  return snapshot;
}
export function isDietChange(value: unknown): value is DietCommandChange {
  if (isDietMealChange(value) || isDietTimeChange(value)) return true;
  return object(value) && (value.kind === 'water'
    ? Object.keys(value).sort().join() === 'kind,totalMl' && waterValue(value.totalMl) && value.totalMl <= 10000
    : value.kind === 'memo' && Object.keys(value).sort().join() === 'kind,text' && typeof value.text === 'string'
      && value.text.trim() === value.text && value.text.length > 0 && value.text.length <= 400 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.text));
}
export function dietNextSnapshot(before: DietDaySnapshot, change: DietCommandChange, day?: string): DietDaySnapshot {
  if (!isDietChange(change)) throw new Error('기록할 수분량이나 메모를 다시 확인해 주세요.');
  if (change.kind === 'time') return dietTimeNextSnapshot(before, change, day);
  if (change.kind === 'meal') return dietMealNextSnapshot(before, change);
  if (change.kind === 'water') return { ...before, water: change.totalMl, record: { ...before.record, waterMl: change.totalMl, water2l: change.totalMl >= 2000 } };
  const previous = before.record?.dietMemo;
  if (previous !== undefined && typeof previous !== 'string') throw new Error('기존 식단 메모 형식을 식단 화면에서 확인해 주세요.');
  const memo = previous ? `${previous}\n${change.text}` : change.text;
  if (memo.length > 4000) throw new Error('메모가 길어 추가하지 못했습니다. 식단 화면에서 기존 메모를 확인해 주세요.');
  return { ...before, record: { ...before.record, dietMemo: memo } };
}
export const isDietMemoCommand = (message: string) => /^(?:오늘\s*)?식단\s*메모\s*추가\s*[:：]/.test(message.trim());
export const isDietRecordIntent = (message: string) => /^(?:(?:오늘|어제|그제|내일|모레)\s*)?(?:(?:식단|물|수분)(?:\s|을|은|섭취|총|메모|완료|$)|(?:점심|저녁)\s+(?:식품\s*)?(?:단백질|밥)|마지막\s*(?:식사|음식))/.test(message.trim());
export function parseDietCommand(message: string): DietCommandChange {
  const text = message.trim();
  const memo = text.match(/^(?:오늘\s*)?식단\s*메모\s*추가\s*[:：]\s*([\s\S]+)$/);
  if (memo) {
    const change: DietCommandChange = { kind: 'memo', text: memo[1].trim() };
    if (!isDietChange(change)) throw new Error('추가할 식단 메모는 1~400자로 입력해 주세요.');
    return change;
  }
  const time = text.match(/^(?:오늘\s*)?(?:식단\s*)?마지막\s*식사(?:\s*(?:시각|시간))?\s+(\d{1,2}):(\d{2})(?:으로|로)?\s*(?:기록|저장)(?:해\s*줘|해주세요|해요)[.!。]*$/);
  if (time) {
    const change: DietTimeChange = { kind: 'time', time: `${time[1].padStart(2, '0')}:${time[2]}` };
    if (!isDietTimeChange(change)) throw new Error('마지막 식사 시각은 00:00~23:59의 24시간제로 입력해 주세요.');
    return change;
  }
  const meal = text.match(/^(?:오늘\s*)?(?:식단\s*)?(점심|저녁)\s+(?:식품\s*)?(단백질|밥(?:량)?)\s*(\d+)\s*(?:g|G|그램)(?:으로|로)?\s*(?:기록|저장)(?:해\s*줘|해주세요|해요)[.!。]*$/);
  if (meal) {
    const change: DietMealChange = { kind: 'meal', slot: meal[1] === '점심' ? 'lunch' : 'dinner', field: meal[2] === '단백질' ? 'protein' : 'rice', grams: Number(meal[3]) };
    if (!isDietMealChange(change)) throw new Error('식품 단백질은 0~100g, 조리된 밥량은 0~1,000g 사이의 정수로 입력해 주세요.');
    return change;
  }
  const water = text.match(/^(?:오늘\s*)?(?:물|수분)\s*총\s*(\d+(?:\.\d{1,3})?)\s*(ml|mL|ML|밀리리터|L|l|리터)(?:로)?\s*(?:기록|저장)(?:해\s*줘|해주세요|해요)[.!。]*$/);
  if (water) {
    const amount = Number(water[1]) * (/^(L|l|리터)$/.test(water[2]) ? 1000 : 1);
    const totalMl = Math.round(amount);
    const change: DietCommandChange = { kind: 'water', totalMl };
    if (Math.abs(amount - totalMl) > 0.000001 || !isDietChange(change)) throw new Error('물 총량은 0~10,000mL 사이의 정수로 입력해 주세요.');
    return change;
  }
  throw new Error('오늘 기록만 지원합니다. 예: ‘오늘 물 총 500ml 기록해줘’, ‘오늘 점심 단백질 30g 기록해줘’, ‘오늘 저녁 밥 80g 기록해줘’, ‘오늘 마지막 식사 18:30 기록해줘’, ‘오늘 식단 메모 추가: 점심 닭가슴살’. 물은 오늘 총량, 단백질·밥량은 해당 끼니의 총량으로 말씀해 주세요.');
}
export function isDietCommandProposal(value: unknown): value is DietCommandProposal {
  const valid = object(value) && value.domain === 'diet' && typeof value.ownerId === 'string'
    && typeof value.requestId === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value.requestId)
    && typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && Number.isFinite(Date.parse(value.date))
    && new Date(value.date).toISOString().slice(0, 10) === value.date
    && isDietChange(value.change) && isDietSnapshot(value.expected, value.change.kind, value.date) && JSON.stringify(value.expected).length <= 200000
    && object(value.resetMarkers) && Object.keys(value.resetMarkers).sort().join() === 'assistant,diet'
    && Object.values(value.resetMarkers).every(marker => marker === null || (typeof marker === 'string' && marker.length <= 120))
    && typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt));
  if (!valid) return false;
  try { dietNextSnapshot(value.expected as DietDaySnapshot, value.change as DietCommandChange, value.date as string); return true; }
  catch { return false; }
}
export function describeDietSnapshot(snapshot: DietDaySnapshot, change: DietCommandChange | 'water' | 'memo', day?: string) {
  if (typeof change === 'object' && change.kind === 'time') return describeDietTime(snapshot, day);
  if (typeof change === 'object' && change.kind === 'meal') return describeDietMeal(snapshot, change);
  const kind = typeof change === 'string' ? change : change.kind;
  if (kind === 'memo') return typeof snapshot.record?.dietMemo === 'string' && snapshot.record.dietMemo ? snapshot.record.dietMemo : '메모 없음';
  // Match the existing diet screen's fallback, but display both saved fields if they disagree.
  const water = snapshot.water, recordWater = snapshot.record?.waterMl;
  if (water !== undefined && recordWater !== undefined && water !== recordWater) return `수분 입력 ${water}mL · 식단 기록 ${String(recordWater)}mL`;
  const value = water ?? recordWater;
  return value === undefined ? '수분 미기록' : `오늘 총 ${String(value)}mL`;
}
export function dietCommandLabel(change: DietCommandChange) {
  return change.kind === 'time' ? '마지막 식사 시각' : change.kind === 'meal' ? `${change.slot === 'lunch' ? '점심' : '저녁'} ${change.field === 'protein' ? '식품 단백질' : '밥량'}` : change.kind === 'water' ? '수분 총량' : '식단 메모 추가';
}
