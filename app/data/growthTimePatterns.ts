import type { GrowthSessionRow } from './growthPlatform.ts';

const slots = [
  { label: '새벽', range: '00:00~05:59' },
  { label: '오전', range: '06:00~11:59' },
  { label: '오후', range: '12:00~17:59' },
  { label: '저녁', range: '18:00~23:59' },
];
type Day = { date: string; status: GrowthSessionRow['status'] };

// Require an explicit offset. Never substitute insertion time or planned duration.
function timestamp(value: unknown) {
  if (typeof value !== 'string') return NaN;
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts || +parts[2] > 23 || +parts[3] > 59 || +parts[4] > 59) return NaN;
  const date = Date.parse(`${parts[1]}T12:00:00Z`);
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== parts[1]) return NaN;
  return Date.parse(value);
}

export function summarizeGrowthTimePatterns(sessions: readonly GrowthSessionRow[], routineId: string, days: readonly Day[]) {
  const groups = slots.map(slot => ({ ...slot, recorded: 0, completed: 0, partial: 0, stopped: 0 }));
  const byDate = new Map<string, GrowthSessionRow[]>();
  for (const session of sessions) {
    if (session.routine_id !== routineId) continue;
    const sameDate = byDate.get(session.session_date) ?? [];
    sameDate.push(session);
    byDate.set(session.session_date, sameDate);
  }
  const evidence = days.map(day => {
    // Use only records that establish this day's displayed status. An earlier
    // stopped timer cannot supply the time for an untimed completion.
    const rows = (byDate.get(day.date) ?? []).filter(row => row.status === day.status);
    const starts = rows.map(row => timestamp(row.started_at));
    let reason = '';
    if (!rows.length || rows.some(row => row.started_at == null)) reason = '시각 미기록';
    else if (starts.some(time => !Number.isFinite(time)) || rows.some((row, i) => row.ended_at != null && (!Number.isFinite(timestamp(row.ended_at)) || timestamp(row.ended_at) < starts[i]))) reason = '시각 확인 필요';
    const korean = reason ? [] : starts.map(time => new Date(time + 9 * 3_600_000).toISOString());
    if (!reason && korean.some(value => value.slice(0, 10) !== day.date)) reason = '시작 날짜 다름';
    const indices = korean.map(value => Math.floor(Number(value.slice(11, 13)) / 6));
    if (!reason && new Set(indices).size > 1) reason = '여러 시간대';
    const index = reason ? null : indices[0];
    if (index != null) { groups[index].recorded++; groups[index][day.status]++; }
    const clocks = reason ? [] : [...new Set(korean.map(value => value.slice(11, 16)))].sort();
    return { ...day, slot: index == null ? null : slots[index].label, reason, clock: clocks.length > 1 ? `${clocks[0]} 외 ${clocks.length - 1}개 시각` : clocks[0] ?? '' };
  });
  const recorded = groups.reduce((sum, group) => sum + group.recorded, 0);
  const eligible = groups.filter(group => group.recorded >= 4);
  let suggestion = '서로 다른 시간대에 기록일이 각각 4일 이상 모이면 완료 비율을 비교해 안내해요.';
  if (eligible.length >= 2) {
    const rates = eligible.map(group => group.completed / group.recorded);
    const high = Math.max(...rates); const low = Math.min(...rates);
    suggestion = high - low >= 0.25
      ? `${eligible.filter((_, i) => rates[i] === high).map(group => group.label).join('·')}의 기록일 중 완료 비율이 더 높았어요. 실제로 여유가 있는 시간과 함께 일정을 검토해 보세요.`
      : '충분히 기록된 시간대 사이의 완료 비율 차이가 크지 않아요. 현재 일정을 유지하며 기록을 더 모아도 좋아요.';
  }
  return { groups, evidence, recorded, unconfirmed: days.length - recorded, suggestion };
}
