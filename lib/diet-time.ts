export const isMealTime = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

// Historical clients stored either a raw clock, a JSON clock, or a date map.
export function parseFastingStart(value: unknown): string | Record<string, unknown> {
  if (value === undefined || value === '') return '';
  let parsed = value;
  if (typeof value === 'string' && !isMealTime(value)) {
    try { parsed = JSON.parse(value); } catch { throw new Error('기존 공복 시작 시각을 식단 화면에서 확인해 주세요.'); }
  }
  if (parsed === '' || isMealTime(parsed) || object(parsed)) return parsed;
  throw new Error('기존 공복 시작 시각을 식단 화면에서 확인해 주세요.');
}
export function fastingStartForDay(value: unknown, day: string): string {
  try {
    const parsed = parseFastingStart(value);
    const time = typeof parsed === 'string' ? parsed : parsed[day];
    return isMealTime(time) ? time : '';
  } catch { return ''; }
}

export function assertPastMealTime(day: string, time: string, now = Date.now()) {
  const instant = Date.parse(`${day}T${time}:00+09:00`);
  if (!isMealTime(time) || !Number.isFinite(instant) || instant > now) throw new Error('아직 지나지 않은 시각입니다. 오늘 실제로 마지막 음식을 드신 시각을 24시간제로 입력해 주세요.');
}
