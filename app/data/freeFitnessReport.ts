type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;

export function buildFreeFitnessReport(value: unknown, scope: 'latest' | 'weekly' | 'monthly' | 'longTerm') {
  const snapshot = object(value);
  const today = typeof snapshot.generatedFor === 'string' ? snapshot.generatedFor : '';
  const dateTime = Date.parse(today + 'T12:00:00Z');
  const entries = (Array.isArray(snapshot.recentSessions) ? snapshot.recentSessions.map(object) : [])
    .filter(row => row.performed === true && typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .filter(row => { const age = (dateTime - Date.parse(String(row.date) + 'T12:00:00Z')) / 86_400_000; return Number.isFinite(age) && age >= 0 && age < (scope === 'weekly' ? 7 : 28); })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const recent = scope === 'latest' ? entries.slice(0, 1) : scope === 'monthly' ? entries.filter(row => String(row.date).slice(0, 7) === today.slice(0, 7)) : entries;
  const painDays = recent.filter(row => row.pain === true || number(row.painScore) > 0 || ['pain', 'worse'].includes(String(row.backStatus))).length;
  const fatigueDays = recent.filter(row => number(row.fatigue) >= 4).length;
  const missing = recent.filter(row => !row.backStatus || row.backStatus === 'unknown' || typeof row.fatigue !== 'number').length;
  const complete = recent.filter(row => row.status === 'completed').length;
  const label = { latest: '최근 운동', weekly: '최근 7일', monthly: '이번 달', longTerm: '최근 28일' }[scope];
  const monthly = object(snapshot.monthly);
  // The snapshot retains only 28 detailed days. The monthly aggregate covers
  // the complete calendar month, so don't present 28 days as a whole month.
  const monthlyDays = scope === 'monthly' ? number(monthly.workoutDays) : recent.length;
  const longTerm = object(snapshot.longTerm);
  const previous = object(longTerm.previous28Days);
  const current = object(longTerm.recent28Days);
  const total = scope === 'monthly' ? monthlyDays : scope === 'longTerm' ? number(current.workoutDays) : recent.length;
  const comparison = scope === 'longTerm' && number(previous.workoutDays) > 0
    ? `최근 28일 운동 ${number(current.workoutDays)}일 · 이전 28일 ${number(previous.workoutDays)}일입니다.` : '';
  return {
    overview: total ? `${label} 운동을 ${total}일 기록했어요.${scope === 'latest' || scope === 'weekly' ? ` 이 중 완료 기록은 ${complete}일이에요.` : ''}` : `${label}에 실제 수행한 운동 기록이 없어요. 기록을 더 모으면 변화를 비교할 수 있어요.`,
    positives: total ? [comparison || '실제로 기록한 날을 기준으로 정리했어요.'] : [],
    cautions: [painDays ? `최근 상세 기록 중 불편·통증 신호 ${painDays}일` : '', fatigueDays ? `높은 피로 기록 ${fatigueDays}일` : '', missing ? `허리 상태 또는 피로 미응답 ${missing}일 · 양호한 상태로 추정하지 않아요.` : ''].filter(Boolean),
    nextSession: [painDays || fatigueDays ? '강도를 올리지 말고 운동 홈에서 회복 조정 제안을 확인해 주세요.' : '운동 홈의 기록 기반 조정에서 같은 루틴의 수행 기록과 준비 조건을 확인해 주세요.'],
    rationale: '저장된 수치를 계산한 요약입니다. 기록이 없는 날의 상태나 운동 효과를 추정하지 않아요.',
    safety: '불편이 있으면 해당 동작을 멈추고 상태를 먼저 확인하세요.',
    confidence: '낮음',
  };
}
