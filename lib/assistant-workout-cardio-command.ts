import type { WorkoutDaySnapshot } from './assistant-workout-command.ts';

export const CARDIO_COMMAND_TYPES = ['실내 걷기', '야외 걷기', '제자리 걷기', '스트레칭 + 가벼운 움직임', '고정식 자전거', '가벼운 계단 오르기', '슬라이딩보드', '기타'] as const;
export type WorkoutCardioChange = { kind: 'cardio'; type: typeof CARDIO_COMMAND_TYPES[number]; minutes: number };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function isWorkoutCardioChange(value: unknown): value is WorkoutCardioChange {
  return object(value) && Object.keys(value).sort().join() === 'kind,minutes,type' && value.kind === 'cardio'
    && CARDIO_COMMAND_TYPES.some(type => type === value.type)
    && typeof value.minutes === 'number' && Number.isInteger(value.minutes) && value.minutes >= 1 && value.minutes <= 300;
}

export function isWorkoutCardioSnapshot(value: unknown): value is WorkoutDaySnapshot {
  if (!object(value) || Object.keys(value).some(key => key !== 'record')) return false;
  if (!Object.hasOwn(value, 'record') || typeof value.record === 'boolean') return true;
  if (!object(value.record)) return false;
  const record = value.record;
  return (!Object.hasOwn(record, 'cardioDone') || typeof record.cardioDone === 'boolean')
    && (!Object.hasOwn(record, 'cardioType') || typeof record.cardioType === 'string' && record.cardioType.length <= 200)
    && (!Object.hasOwn(record, 'cardioMinutes') || typeof record.cardioMinutes === 'number' && Number.isFinite(record.cardioMinutes) && record.cardioMinutes >= 0);
}

export function nextWorkoutCardioSnapshot(before: WorkoutDaySnapshot, change: WorkoutCardioChange): WorkoutDaySnapshot {
  if (!isWorkoutCardioChange(change)) throw new Error('유산소 종류와 오늘 총시간을 다시 확인해 주세요. 시간은 1~300분의 정수로 입력해 주세요.');
  if (!isWorkoutCardioSnapshot(before)) throw new Error('오늘 유산소 기록 형식을 확인하지 못했습니다. 운동 화면에서 확인해 주세요.');
  const record = typeof before.record === 'boolean' ? { workoutDone: before.record } : before.record ?? {};
  return { record: { ...record, cardioDone: true, cardioType: change.type, cardioMinutes: change.minutes } };
}

export function describeWorkoutCardio(snapshot: WorkoutDaySnapshot): string {
  const record = snapshot.record;
  if (!object(record)) return '유산소 기록 없음';
  const details = [record.cardioType, typeof record.cardioMinutes === 'number' ? `총 ${record.cardioMinutes}분` : null].filter(Boolean).join(' · ');
  if (record.cardioDone === true) return details || '유산소 완료 · 종류·시간 미기록';
  return details ? `완료 미기록 (${details})` : '유산소 기록 없음';
}

export function isWorkoutCardioIntent(message: string): boolean {
  return /유산소/.test(message) && /(기록|저장|완료|했)/.test(message);
}

export function parseWorkoutCardioCommand(message: string): WorkoutCardioChange {
  if (/(어제|그제|내일|모레|지난|다음|\d\s*(월|일)|\d{4}[-./])/.test(message)) throw new Error('유산소 명령은 오늘 기록만 지원합니다. 오늘의 종류와 총시간을 말씀해 주세요.');
  const match = /^(?:오늘\s*)?유산소\s+(.+?)\s+총\s*(\d{1,3})\s*분\s*(?:기록|저장)(?:해\s*줘|해주세요|해요)[.!。]*$/.exec(message.trim());
  const change = match ? { kind: 'cardio', type: match[1], minutes: Number(match[2]) } : null;
  if (!isWorkoutCardioChange(change)) throw new Error('유산소 종류와 오늘 총시간을 함께 입력해 주세요. 예: ‘오늘 유산소 실내 걷기 총 20분 기록해줘’. 시간은 1~300분의 정수만 지원합니다.');
  return change;
}
