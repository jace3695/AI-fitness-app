import { isRetiredGrowthRoutine } from '../app/data/growthRoutines.ts';

export const GROWTH_ROUTINE_FIELDS = 'id,title,category,target_minutes,preferred_days,target_sessions_per_week,enabled,updated_at';
export type GrowthRoutineSnapshot = {
  id: string; title: string; category: string; target_minutes: number;
  preferred_days: number[]; target_sessions_per_week: number; enabled: boolean; updated_at: string;
};
export type GrowthCompletion = { target: string; actualMinutes: number | null };
export type GrowthCommandProposal = {
  domain: 'growth'; ownerId: string; requestId: string; date: string;
  expected: GrowthRoutineSnapshot; actualMinutes: number | null;
  resetMarkers: { growth: string | null; assistant: string | null }; expiresAt: string;
};
export type GrowthCommandReceipt = {
  user_id: string; id: string; record_date: string; routine_snapshot: GrowthRoutineSnapshot;
  session_snapshot: { id: string; actual_minutes: number; metrics: Record<string, unknown> };
  created_at: string; undone_at: string | null;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
export function isGrowthCompletionIntent(message: string) {
  if (!/^(?:오늘\s*)?(?:자기계발|성장)\s+/.test(message) && /(할\s*일|일정|가계부|지출)/.test(message)) return false;
  return /(자기계발|성장|타자|손글씨|AI\s*허브|개발).*(완료|끝|마쳤|했어|했어요|했습니다)/.test(message);
}
export function parseGrowthCompletion(message: string): GrowthCompletion {
  if (/(어제|그제|내일|모레|지난|다음|\d\s*(월|일)|\d{4}[-./])/.test(message)) throw new Error('자기계발 완료 명령은 오늘 기록만 지원합니다. 과거 기록은 자기계발 화면에서 입력해 주세요.');
  const match = message.trim().match(/^(?:오늘\s*)?(?:(?:자기계발|성장)\s+)?(.+?)\s+(?:(\d+)\s*분\s*)?(?:완료(?:했(?:어|어요|습니다)|해\s*줘|해주세요)?|끝(?:냈(?:어|어요|습니다)|났(?:어|어요))|마쳤(?:어|어요|습니다)|(?:다\s*)?했(?:어|어요|습니다))(?:\s*(?:로\s*)?(?:기록|저장)(?:해\s*줘|해주세요|해요))?[.!。]*$/);
  if (!match || match[1].length > 60 || /(?:안\s*|못\s*|일부\s*)$/.test(match[1])) throw new Error('오늘의 루틴 하나를 완료했다는 명령을 입력해 주세요. 예: ‘오늘 타자 연습 완료했어’, ‘오늘 손글씨 15분 완료했어’.');
  const actualMinutes = match[2] === undefined ? null : Number(match[2]);
  if (actualMinutes !== null && (!Number.isInteger(actualMinutes) || actualMinutes < 1 || actualMinutes > 1440)) throw new Error('실제로 수행한 시간을 1~1,440분 사이의 정수로 말씀해 주세요.');
  return { target: match[1].trim(), actualMinutes };
}
export function selectGrowthRoutine(routines: GrowthRoutineSnapshot[], target: string): GrowthRoutineSnapshot {
  const available = routines.filter(row => row.enabled && !isRetiredGrowthRoutine(row));
  const exact = available.filter(row => row.title === target);
  const categories: Record<string, string> = { '타자': 'typing', '타자 연습': 'typing', '손글씨': 'handwriting', '손글씨 연습': 'handwriting', 'AI 허브': 'development', 'AI 허브 개발': 'development', '개발': 'development' };
  const candidates = exact.length ? exact : available.filter(row => categories[target] && row.category === categories[target]);
  if (candidates.length !== 1) throw new Error(candidates.length
    ? '해당하는 루틴이 여러 개입니다. 자기계발 화면의 루틴 이름을 정확히 말씀해 주세요.'
    : '완료할 자기계발 루틴을 찾지 못했습니다. 자기계발 화면에서 루틴 이름과 사용 여부를 확인해 주세요.');
  return candidates[0];
}
export function growthSessionTimeLabel(session: { actual_minutes: number; metrics: Record<string, unknown> }) {
  return session.metrics.actualMinutesRecorded === false ? '시간 미기록' : `${session.actual_minutes}분`;
}
export function isGrowthCommandProposal(value: unknown): value is GrowthCommandProposal {
  if (!object(value) || value.domain !== 'growth' || !uuid(value.ownerId) || !uuid(value.requestId)
    || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(Date.parse(value.date))
    || new Date(value.date).toISOString().slice(0, 10) !== value.date
    || !(value.actualMinutes === null || (Number.isInteger(value.actualMinutes) && Number(value.actualMinutes) >= 1 && Number(value.actualMinutes) <= 1440))
    || !object(value.resetMarkers) || Object.keys(value.resetMarkers).sort().join() !== 'assistant,growth'
    || !Object.values(value.resetMarkers).every(marker => marker === null || (typeof marker === 'string' && marker.length <= 120))
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) return false;
  const r = value.expected;
  return object(r) && Object.keys(r).sort().join() === GROWTH_ROUTINE_FIELDS.split(',').sort().join()
    && uuid(r.id) && typeof r.title === 'string' && r.title.trim().length > 0 && r.title.length <= 60
    && ['development','typing','handwriting','custom'].includes(String(r.category)) && r.enabled === true
    && Number.isInteger(r.target_minutes) && Number(r.target_minutes) >= 5 && Number(r.target_minutes) <= 240
    && Array.isArray(r.preferred_days) && r.preferred_days.length > 0 && r.preferred_days.length <= 7
    && new Set(r.preferred_days).size === r.preferred_days.length && r.preferred_days.every(day => Number.isInteger(day) && day >= 1 && day <= 7)
    && Number.isInteger(r.target_sessions_per_week) && Number(r.target_sessions_per_week) >= 1 && Number(r.target_sessions_per_week) <= r.preferred_days.length
    && typeof r.updated_at === 'string' && Number.isFinite(Date.parse(r.updated_at));
}
