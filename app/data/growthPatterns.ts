import type { GrowthSessionRow } from './growthPlatform.ts';

const DAY = 86_400_000;
function dateTime(key: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return NaN;
  const time = Date.parse(`${key}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === key ? time : NaN;
}
export function summarizeGrowthPatterns(sessions: GrowthSessionRow[], routineId: string, today: string) {
  const end = dateTime(today);
  if (!Number.isFinite(end)) throw new Error('올바른 기준 날짜가 필요합니다.');
  const start = end - 28 * DAY;
  const days = new Map<string, GrowthSessionRow['status']>();
  const rank = { stopped: 1, partial: 2, completed: 3 };
  for (const session of sessions) {
    const time = dateTime(session.session_date);
    if (session.routine_id !== routineId || !Number.isFinite(time) || time < start || time >= end || !Object.hasOwn(rank, session.status)) continue;
    const previous = days.get(session.session_date);
    if (!previous || rank[session.status] > rank[previous]) days.set(session.session_date, session.status);
  }
  const weekdays = Array.from({ length: 7 }, (_, index) => ({ day: index + 1, recorded: 0, completed: 0, partial: 0, stopped: 0 }));
  for (const [date, status] of days) {
    const day = new Date(dateTime(date)).getUTCDay() || 7;
    weekdays[day - 1].recorded++;
    weekdays[day - 1][status]++;
  }
  const groups = [weekdays.slice(0, 5), weekdays.slice(5)].map(group => group.reduce((total, day) => ({ recorded: total.recorded + day.recorded, completed: total.completed + day.completed, partial: total.partial + day.partial, stopped: total.stopped + day.stopped }), { recorded: 0, completed: 0, partial: 0, stopped: 0 }));
  const [weekday, weekend] = groups;
  let suggestion = '평일 4일·주말 3일 이상의 실행 기록이 모이면 두 기간을 비교해 안내해요.';
  if (weekday.recorded >= 4 && weekend.recorded >= 3) {
    const difference = weekend.completed / weekend.recorded - weekday.completed / weekday.recorded;
    suggestion = Math.abs(difference) >= 0.25
      ? `${difference > 0 ? '주말' : '평일'}의 기록일 중 완료 비율이 더 높았어요. 가능한 시간과 함께 루틴 요일을 검토해 보세요. 요일 때문에 차이가 났다고 단정할 수는 없어요.`
      : '평일·주말의 기록일 중 완료 비율 차이가 크지 않아요. 현재 일정을 유지하며 기록을 더 모아도 좋아요.';
  }
  return { start: new Date(start).toISOString().slice(0, 10), end: new Date(end - DAY).toISOString().slice(0, 10), recorded: days.size, unrecorded: 28 - days.size, weekdays, weekday, weekend, suggestion,
    days: [...days].sort(([a], [b]) => b.localeCompare(a)).map(([date, status]) => ({ date, status })),
  };
}
