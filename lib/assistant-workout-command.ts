import { isWorkoutCardioChange, isWorkoutCardioSnapshot, type WorkoutCardioChange } from './assistant-workout-cardio-command.ts';

export const WORKOUT_RECORD_KEY = 'ai-fitness-workout-completed-days';
export type WorkoutDaySnapshot = { record?: boolean | Record<string, unknown> };
export type WorkoutCommandProposal = {
  domain: 'workout'; ownerId: string; requestId: string; date: string; expected: WorkoutDaySnapshot;
  resetMarkers: { fitness: string | null; assistant: string | null }; expiresAt: string;
  change?: WorkoutCardioChange;
};
export type WorkoutCommandReceipt = {
  user_id: string; id: string; record_date: string; before_values: WorkoutDaySnapshot; after_values: WorkoutDaySnapshot;
  created_at: string; undone_at: string | null;
  command_kind?: 'completion' | 'cardio';
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function workoutDaySnapshot(state: Record<string, unknown>, date: string): WorkoutDaySnapshot {
  const raw = state[WORKOUT_RECORD_KEY];
  const store = raw === undefined ? {} : typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!object(store)) throw new Error('운동 기록 형식을 확인하지 못했습니다. 운동 화면에서 확인해 주세요.');
  const snapshot = Object.hasOwn(store, date) ? { record: store[date] } : {};
  if (!isWorkoutSnapshot(snapshot)) throw new Error('오늘 운동 기록을 확인하지 못했습니다. 운동 화면에서 확인해 주세요.');
  return snapshot;
}
function isWorkoutSnapshot(value: unknown): value is WorkoutDaySnapshot {
  return object(value) && Object.keys(value).every(key => key === 'record')
    && (!Object.hasOwn(value, 'record') || typeof value.record === 'boolean' || object(value.record));
}
export function workoutRecordStatus(snapshot: WorkoutDaySnapshot): 'empty' | 'completed' | 'detailed' {
  const record = snapshot.record;
  if (record === undefined || record === false) return 'empty';
  if (record === true) return 'completed';
  if (record.workoutStatus === 'partial' || record.workoutStatus === 'stopped') return 'detailed';
  if (record.workoutDone === true || record.workoutStatus === 'completed') return 'completed';
  return Object.keys(record).some(key => key === 'exerciseRecords' || (key.startsWith('workout') && !(key === 'workoutDone' && record[key] === false))) ? 'detailed' : 'empty';
}
export function parseWorkoutCompletion(message: string): void {
  if (/(어제|그제|내일|모레|지난|다음|\d\s*(월|일)|\d{4}[-./])/.test(message)) throw new Error('완료 명령은 오늘 운동만 기록합니다. 오늘 완료한 운동을 말씀해 주세요.');
  if (!/^(?:오늘\s*)?운동(?:을)?\s*(?:완료(?:했(?:어|어요|습니다))?|끝(?:냈(?:어|어요|습니다)|났(?:어|어요))|마쳤(?:어|어요|습니다)|(?:다\s*)?했(?:어|어요|습니다))(?:\s*(?:로\s*)?(?:기록|저장)(?:해\s*줘|해주세요|해요))?[.!。]*$/.test(message.trim())) {
    throw new Error('오늘 운동을 모두 완료했다는 명령만 지원합니다. 예: ‘오늘 운동 완료했어’. 일부 완료·중단·세트·통증은 운동 화면에서 기록해 주세요.');
  }
}
export function isWorkoutCommandProposal(value: unknown): value is WorkoutCommandProposal {
  return object(value) && value.domain === 'workout' && typeof value.ownerId === 'string'
    && typeof value.requestId === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value.requestId)
    && typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && Number.isFinite(Date.parse(value.date))
    && new Date(value.date).toISOString().slice(0, 10) === value.date
    && isWorkoutSnapshot(value.expected) && JSON.stringify(value.expected).length <= 200000
    && (!Object.hasOwn(value, 'change') || isWorkoutCardioChange(value.change) && isWorkoutCardioSnapshot(value.expected))
    && object(value.resetMarkers) && Object.keys(value.resetMarkers).sort().join() === 'assistant,fitness'
    && Object.values(value.resetMarkers).every(marker => marker === null || (typeof marker === 'string' && marker.length <= 120))
    && typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt));
}
