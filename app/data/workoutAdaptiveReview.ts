import { getWorkoutRecord, isWorkoutPerformed } from './workoutCompletion.ts';
import type { ExerciseRecord, WorkoutCompletionStore, WorkoutDayId, WorkoutDayRecord } from './workoutCompletion.ts';
import type { DailyConditionStore } from './recoveryMode.ts';
import type { UserWorkoutSettings, ExerciseTarget } from './userWorkoutSettings.ts';
import type { WorkoutMethodConfig } from './workoutMethods.ts';
import { CURRENT_WEEKLY_GROUPS, CURRENT_WEEKLY_METHODS } from './currentWorkoutDirection.ts';

export type AdaptiveReviewAction = 'maintain' | 'increase' | 'replace' | 'decrease' | 'hold';
export interface AdaptiveReviewDecision {
  id: string;
  action: AdaptiveReviewAction;
  decision: 'applied' | 'kept';
  decidedAt: string;
  decidedFor?: string;
  evidenceThrough: string;
  summary: string;
}
export interface AdaptiveReviewInput {
  settings: UserWorkoutSettings;
  workouts: WorkoutCompletionStore;
  conditions: DailyConditionStore;
  selectedPlanId: string;
  today: string;
}
interface PlanChange {
  dayId: WorkoutDayId;
  date: string;
  scope: 'weekly' | 'date';
  groupId?: string;
  method?: WorkoutMethodConfig;
  targets?: Record<string, ExerciseTarget>;
  previousTargets?: Record<string, ExerciseTarget>;
  before: string;
  after: string;
}
export interface AdaptiveWorkoutReview {
  id: string;
  action: AdaptiveReviewAction;
  title: string;
  reasons: string[];
  change?: PlanChange;
  preparation?: string;
  evidenceCount: number;
  strengthCount: number;
  evidenceThrough: string;
  latestBack: string;
  latestFatigue: string;
  lastDecision?: AdaptiveReviewDecision;
  alreadyReviewed: boolean;
}

const DAY_IDS: WorkoutDayId[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS: Record<WorkoutDayId, string> = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };
const BASE_GROUP = 'current-fullbody-strength-circuit';
const HAMSTRING_GROUP = 'current-fullbody-hamstring-circuit';
const CORE_GROUP = 'current-fullbody-antirotation-circuit';
const STRENGTH_GROUPS = new Set([BASE_GROUP, HAMSTRING_GROUP, CORE_GROUP]);
const RECOVERY_GROUP = 'current-fullbody-recovery-circuit';
const MAIN_EXERCISES = ['덤벨 고블릿 스쿼트', '밴드 로우', '덤벨 플로어프레스', '루프밴드 사이드워크', '버드독'];
const BAND_LEVELS = ['약', '중', '강'] as const;
const MAX_PLANNED_DUMBBELL_KG = 30;
const BACK_LABELS = { none: '불편 없음', stiff: '약간 뻐근함', pain: '통증 있음', worse: '운동 전보다 악화' };
const STOP_SIGNALS = new Set(['marked-back-pain', 'leg-numbness', 'radiating-leg-pain', 'leg-tingling', 'sensation-loss', 'leg-weakness', 'ankle-pain', 'dizziness', 'hand-tremor', 'cold-sweat', 'severe-headache']);

function dayNumber(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const time = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? time / 86400000 : NaN;
}
function datePlus(date: string, days: number) {
  return new Date((dayNumber(date) + days) * 86400000).toISOString().slice(0, 10);
}
export function isRecentTrainingDate(date: string, today: string, days = 28) {
  const age = dayNumber(today) - dayNumber(date);
  return Number.isFinite(age) && age >= 0 && age < days;
}
function fingerprint(value: unknown) {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, stable(val)])) : item;
  const json = JSON.stringify(stable(value));
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i), 16777619);
  return `review-v1-${(hash >>> 0).toString(16)}`;
}
function mainNames(groupId?: string) {
  return MAIN_EXERCISES.map((name) => groupId === HAMSTRING_GROUP && name === '루프밴드 사이드워크' ? '지지형 햄스트링 컬'
    : groupId === CORE_GROUP && name === '버드독' ? '밴드 팔로프 프레스' : name);
}
function mainRecords(record: WorkoutDayRecord) {
  const names = mainNames(record.workoutGroupId);
  return (record.workoutExerciseRecords ?? []).filter((exercise) => names.includes(exercise.exerciseName));
}
function setReps(set: NonNullable<ExerciseRecord['sets']>[number]) {
  return set.leftReps !== undefined || set.rightReps !== undefined
    ? Math.min(set.leftReps ?? 0, set.rightReps ?? 0) : set.reps ?? 0;
}
function normalizeBandLevel(value?: string) {
  const normalized = value?.trim().toLocaleLowerCase('ko-KR');
  if (!normalized) return undefined;
  if (['약', '가벼움', 'light'].includes(normalized)) return '약' as const;
  if (['중', '보통', 'medium'].includes(normalized)) return '중' as const;
  if (['강', '강함', 'heavy'].includes(normalized)) return '강' as const;
  return undefined;
}
function safeCompletion(record: WorkoutDayRecord) {
  const exercises = mainRecords(record);
  const rounds = record.workoutMethod?.rounds ?? 0;
  return record.workoutStatus === 'completed' && record.workoutBackStatus === 'none'
    && !record.workoutPain && !record.workoutNeurologicalSymptoms?.length
    && record.workoutFatigue !== undefined && record.workoutFatigue <= 2
    && record.workoutDifficulty !== undefined && record.workoutDifficulty !== 'hard'
    && record.workoutMethod?.method === 'circuit' && rounds >= 1
    && mainNames(record.workoutGroupId).every((name) => {
      const matching = exercises.filter((exercise) => exercise.exerciseName === name);
      const sets = matching.flatMap((exercise) => exercise.sets ?? []);
      return matching.length > 0 && matching.every((exercise) => exercise.status === 'completed' && !(exercise.painScore && exercise.painScore > 0))
        && sets.length >= rounds && sets.every((set) => set.completed && (set.plannedReps ?? 0) > 0 && setReps(set) >= (set.plannedReps ?? Infinity));
    });
}
function workloadSignature(record: WorkoutDayRecord) {
  return JSON.stringify({ group: record.workoutGroupId, method: record.workoutMethod,
    exercises: mainRecords(record).map((exercise) => ({ name: exercise.exerciseName, sets: (exercise.sets ?? []).map((set) => ({ planned: set.plannedReps, weight: set.weightKg, band: set.bandLevel })) })),
  });
}
export function hasComparablePerformanceDrop(records: WorkoutDayRecord[]) {
  const latest = records.find((record) => STRENGTH_GROUPS.has(record.workoutGroupId ?? '') && mainRecords(record).length > 0);
  if (!latest) return false;
  const signature = workloadSignature(latest);
  const previous = records.slice(records.indexOf(latest) + 1).find((record) => workloadSignature(record) === signature);
  if (!previous) return false;
  const output = (record: WorkoutDayRecord) => mainRecords(record).flatMap((exercise) => exercise.sets ?? []).reduce((sum, set) => sum + (set.completed ? setReps(set) : 0), 0);
  return output(previous) > 0 && output(latest) / output(previous) < 0.8;
}

export function buildAdaptiveWorkoutReview(input: AdaptiveReviewInput): AdaptiveWorkoutReview {
  const { settings, workouts, conditions, selectedPlanId, today } = input;
  const entries = Object.entries(workouts).filter(([date]) => isRecentTrainingDate(date, today))
    .sort(([a], [b]) => b.localeCompare(a)).flatMap(([date, value]) => {
      const record = getWorkoutRecord(value);
      return isWorkoutPerformed(value) || record.workoutStatus ? [{ date, record }] : [];
    });
  const strength = entries.filter(({ record }) => STRENGTH_GROUPS.has(record.workoutGroupId ?? ''));
  const recentConditions = Object.entries(conditions).filter(([date]) => isRecentTrainingDate(date, today, 7)).sort(([a], [b]) => b.localeCompare(a));
  const decisions = [...settings.adaptiveReviewDecisions ?? []].filter((item) => Number.isFinite(Date.parse(item.decidedAt))).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  const lastApplied = decisions.find((item) => item.decision === 'applied' && item.action !== 'maintain');
  const lastAppliedDate = lastApplied?.decidedFor ?? lastApplied?.decidedAt.slice(0, 10);
  const evidenceThrough = entries[0]?.date ?? today;
  const id = fingerprint({ today, selectedPlanId, entries, recentConditions, settings: { ...settings, adaptiveReviewDecisions: undefined }, lastApplied });
  const common = {
    id, evidenceCount: entries.length, strengthCount: strength.length, evidenceThrough,
    latestBack: entries[0]?.record.workoutBackStatus ? BACK_LABELS[entries[0].record.workoutBackStatus] : '미기록',
    latestFatigue: entries[0]?.record.workoutFatigue !== undefined ? `${entries[0].record.workoutFatigue}/5` : '미기록',
    lastDecision: decisions[0], alreadyReviewed: decisions.some((item) => item.id === id),
  };
  const review = (action: AdaptiveReviewAction, title: string, reasons: string[], change?: PlanChange, preparation?: string): AdaptiveWorkoutReview => ({ ...common, action, title, reasons, change, preparation });
  const safetyRecords = entries.filter(({ date }) => isRecentTrainingDate(date, today, 14));
  const hasSafetySignal = safetyRecords.some(({ record }) => record.workoutBackStatus === 'worse' || record.workoutBackStatus === 'pain'
    || record.workoutPain || record.workoutNeurologicalSymptoms?.length || (record.workoutExerciseRecords ?? []).some((exercise) => (exercise.painScore ?? 0) > 0))
    || recentConditions.some(([, condition]) => condition.signals.some((signal) => STOP_SIGNALS.has(signal)));
  if (hasSafetySignal) return review('hold', '운동 변경 보류 · 증상 확인 우선', [
    '최근 14일 운동 기록 또는 최근 7일 컨디션에 통증·악화·저림 등의 신호가 있습니다. 강도 증가와 새 운동 도입을 보류합니다.',
    '증상을 유발하는 운동을 중단하고, 증상이 지속되거나 심해지면 의료 평가를 받으세요. 회복형 운동도 자동으로 안전하다고 판단하지 않습니다.',
  ]);
  if (selectedPlanId !== 'five-day-fullbody-circuit') return review('maintain', '직접 선택한 프로그램 유지', ['현재 제안은 주 5일 전신 서킷에 맞춰 제공됩니다. 다른 프로그램은 직접 설정한 내용을 유지합니다.']);

  const nextDay = (strengthOnly: boolean) => {
    for (let offset = 0; offset < 7; offset++) {
      const date = datePlus(today, offset);
      const dayId = DAY_IDS[new Date(`${date}T12:00:00Z`).getUTCDay()];
      const groupId = settings.weeklyGroups[dayId] ?? CURRENT_WEEKLY_GROUPS[dayId];
      if (settings.dateOverrides[date] || settings.weeklyEdits[dayId] || workouts[date]) continue;
      const method = settings.weeklyMethods[dayId] ?? CURRENT_WEEKLY_METHODS[dayId];
      if (method.method !== 'circuit') continue;
      if (STRENGTH_GROUPS.has(groupId) || (!strengthOnly && groupId === RECOVERY_GROUP)) return { date, dayId, groupId, method };
    }
  };
  const recent = entries.filter(({ date }) => isRecentTrainingDate(date, today, 7)).slice(0, 3);
  const performanceDrop = recent.length > 0 && hasComparablePerformanceDrop(strength.map(({ record }) => record));
  const fatigue = recent.some(({ record }) => (record.workoutFatigue ?? 0) >= 4 || record.workoutStatus === 'partial' || record.workoutStatus === 'stopped' || record.workoutBackStatus === 'stiff')
    || recentConditions.some(([, condition]) => condition.signals.length > 0 || condition.recommendation !== 'normal');
  if (fatigue || performanceDrop) {
    const next = nextDay(false);
    if (!next) return review('maintain', '회복 우선 · 직접 편집한 일정 확인', ['피로·뻐근함·완료율 또는 같은 운동의 수행 저하 신호가 있습니다. 날짜별 예외와 직접 편집한 일정은 자동 변경하지 않으므로 다음 운동량을 확인하세요.']);
    const sameEvidenceAlreadyReduced = lastApplied?.action === 'decrease' && lastApplied.evidenceThrough >= evidenceThrough
      && lastAppliedDate! >= (recentConditions[0]?.[0] ?? evidenceThrough);
    if (sameEvidenceAlreadyReduced) return review('maintain', '확인한 회복 조정 유지', ['같은 피로 기록으로 여러 날을 연속해서 줄이지 않습니다. 다음 운동과 컨디션 기록을 보고 다시 검토합니다.']);
    const rest = next.method.rounds <= 1;
    const method = { ...next.method, rounds: Math.max(1, next.method.rounds - 1), restSeconds: Math.max(90, next.method.restSeconds) };
    return review('decrease', '다음 운동 한 번의 부담 낮추기', [
      performanceDrop ? '같은 운동·라운드·계획 반복수·기록된 저항 조건에서 실제 수행량이 감소했습니다.' : '최근 높은 피로·뻐근함·미완료 또는 컨디션 저하가 기록됐습니다.',
      '이번 날짜에만 적용합니다. 주간 기본표는 유지하고 다음 기록에서 회복을 다시 확인합니다.',
    ], { ...next, scope: 'date', groupId: rest ? 'rest' : next.groupId, method: rest ? { ...method, method: 'standard' } : method,
      before: `${next.date}(${DAY_LABELS[next.dayId]}) ${next.method.rounds}라운드 · 라운드 휴식 ${next.method.restSeconds}초`,
      after: rest ? '이번 운동 휴식' : `${method.rounds}라운드 · 라운드 휴식 ${method.restSeconds}초 (필요하면 더 휴식)`,
    });
  }
  const weekStart = datePlus(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  if (!strength[0] || !isRecentTrainingDate(strength[0].date, today, 7)) return review('maintain', '최근 근력 기록부터 확인', ['지난 7일의 근력 수행 기록이 없어 이전 기록만으로 증가·교체하지 않습니다. 현재 구성으로 컨디션과 자세를 확인하며 기록을 남겨 주세요.']);
  if (lastApplied && lastAppliedDate! >= weekStart) return review('maintain', '이번 주 적용한 변화에 적응하기', ['이번 주에 이미 한 번 조정했습니다. 추가 증가·교체는 다음 주 이후 새 기록을 보고 검토합니다. 피로·통증 신호는 먼저 확인합니다.']);
  const eligibleStrength = strength.filter(({ date }) => !lastApplied || date > lastApplied.evidenceThrough && date > lastAppliedDate!);
  const missingFeedback = eligibleStrength.slice(0, 3).flatMap(({ date, record }) => {
    const missing = [!record.workoutBackStatus && '허리 상태', record.workoutFatigue === undefined && '피로도', !record.workoutDifficulty && '체감 난이도'].filter(Boolean);
    return missing.length ? [`${date}: ${missing.join('·')}가 미응답입니다.`] : [];
  });
  if (eligibleStrength.length < 3 || !eligibleStrength.slice(0, 3).every(({ record }) => safeCompletion(record))) return review('maintain', '현재 구성으로 적응 상태 확인', [
    '현재 계획 또는 마지막 변경 이후 근력 운동 3회의 반복수·완료율·피로·허리 상태가 충분히 확인될 때까지 유지합니다.',
    ...missingFeedback,
    '회복형 운동이 쉬웠다는 기록이나 주가 바뀌었다는 이유만으로 근력 운동량을 올리지 않습니다.',
  ]);
  const next = nextDay(true);
  if (!next) return review('maintain', '직접 편집한 일정 유지', ['다음 근력일에 날짜별 예외·직접 편집 또는 이미 작성한 기록이 있어 변경을 제안하지 않습니다.']);
  const groups = Object.values({ ...CURRENT_WEEKLY_GROUPS, ...settings.weeklyGroups });
  const safeStrength = strength.filter(({ record }) => safeCompletion(record));
  const enoughPractice = safeStrength.length >= 6 && dayNumber(today) - dayNumber(safeStrength.at(-1)!.date) >= 13;
  const hamstringEstablished = groups.includes(HAMSTRING_GROUP) && safeStrength.filter(({ record }) => record.workoutGroupId === HAMSTRING_GROUP).length >= 3;
  const replacement = next.groupId === BASE_GROUP && enoughPractice
    ? !groups.includes(HAMSTRING_GROUP) ? 'hamstring' : hamstringEstablished && !groups.includes(CORE_GROUP) ? 'core' : undefined
    : undefined;
  if (replacement) {
    const hamstring = replacement === 'hamstring';
    const rounds = Math.min(2, next.method.rounds);
    return review('replace', hamstring ? '허벅지 뒤쪽 운동 한 가지 도입 검토' : '회전 저항 코어 한 가지 도입 검토', [
      '약 2주 이상에 걸친 근력 운동에서 안정적인 수행 기록이 쌓였습니다. 효과가 없다는 뜻이 아니라 운동 자극을 보완하는 선택입니다.',
      '한 근력 요일에서 한 동작만 교체해 본 운동은 5개로 유지합니다. 첫 도입은 2라운드 이하로 시작합니다.',
    ], { ...next, scope: 'weekly', groupId: hamstring ? HAMSTRING_GROUP : CORE_GROUP, method: { ...next.method, rounds },
      targets: { [hamstring ? '지지형 햄스트링 컬' : '밴드 팔로프 프레스']: { reps: hamstring ? 8 : 6, sets: 1 } },
      before: `${DAY_LABELS[next.dayId]}요일 · ${hamstring ? '루프밴드 사이드워크' : '버드독'} · ${next.method.rounds}라운드`,
      after: `${hamstring ? '지지형 햄스트링 컬 좌우 8회 (맨몸)' : '밴드 팔로프 프레스 좌우 6회 (약한 밴드)'} · 전체 ${rounds}라운드 · ${next.date}부터 매주`,
    }, hamstring ? '흔들리지 않는 지지대가 있고, 자세 안내를 확인했으며 현재 통증·저림이 없습니다.' : '약한 밴드를 안전하게 고정할 수 있고, 자세 안내를 확인했으며 현재 통증·저림이 없습니다.');
  }
  const expectedReps = (name: string) => settings.weeklyExerciseTargets?.[next.dayId]?.[name]?.reps ?? settings.exerciseTargets[name]?.reps
    ?? (name === '밴드 로우' ? 10 : name === '버드독' || name === '밴드 팔로프 프레스' ? 6 : 8);
  const comparable = eligibleStrength.filter(({ record }) => record.workoutGroupId === next.groupId
    && record.workoutMethod?.rounds === next.method.rounds
    && mainRecords(record).every((exercise) => (exercise.sets ?? []).every((set) => set.plannedReps === expectedReps(exercise.exerciseName)))).slice(0, 3);
  if (comparable.length !== 3 || !comparable.every(({ record }) => safeCompletion(record) && record.workoutDifficulty === 'easy')
    || !comparable.every(({ record }) => workloadSignature(record) === workloadSignature(comparable[0].record))
    || comparable[0].record.workoutMethod?.rounds !== next.method.rounds) return review('maintain', '현재 자극 유지 · 같은 조건의 기록 더 확인', ['같은 근력 루틴을 같은 계획·저항으로 여유 있게 완료한 최근 3회가 확인되면 한 항목의 반복수를 소폭 높입니다.']);

  if ((next.groupId === HAMSTRING_GROUP || next.groupId === CORE_GROUP) && next.method.rounds === 2) {
    const method = { ...next.method, rounds: next.method.rounds + 1 };
    return review('increase', '새 근력 루틴의 라운드 1회 증가 검토', [
      '새 동작이 포함된 같은 근력 루틴을 같은 반복수·저항으로 최근 3회 여유 있게 완료했습니다.',
      '반복수와 중량·밴드 장력은 그대로 두고 전체 라운드만 1회 높입니다. 3라운드를 넘겨 제안하지 않습니다.',
    ], { ...next, scope: 'weekly', method,
      before: `${DAY_LABELS[next.dayId]}요일 · ${next.method.rounds}라운드`,
      after: `${method.rounds}라운드 · 반복수와 저항 유지 · ${next.date}부터 매주`,
    }, '현재 통증·저림이 없고, 한 라운드를 더 진행할 시간과 회복 여유가 있습니다.');
  }

  const exercises = MAIN_EXERCISES.slice(0, 3);
  for (const name of exercises) {
    const target = settings.weeklyExerciseTargets?.[next.dayId]?.[name] ?? settings.exerciseTargets[name];
    const from = target?.reps ?? (name === '밴드 로우' ? 10 : 8);
    const matchingSets = comparable.flatMap(({ record }) => mainRecords(record).filter((exercise) => exercise.exerciseName === name).flatMap((exercise) => exercise.sets ?? []));
    const loadRecorded = matchingSets.length > 0 && matchingSets.every((set) => name === '밴드 로우' ? Boolean(set.bandLevel?.trim()) : (set.weightKg ?? 0) > 0);
    if (!loadRecorded || !matchingSets.every((set) => set.plannedReps === from && setReps(set) >= from)) continue;
    if (from < 12) return review('increase', '근력일 한 운동의 반복수만 1회 증가', [
        '같은 근력 루틴의 최근 3회에서 계획 반복수를 여유 있게 완료했고 피로가 낮으며 허리 불편이 없었습니다.',
        '기록한 중량·밴드 장력·라운드·휴식은 유지합니다. 다른 요일과 화·목 회복형 운동에는 적용하지 않습니다.',
      ], { dayId: next.dayId, date: next.date, scope: 'weekly', targets: { [name]: { ...target, reps: from + 1 } }, previousTargets: { [name]: { ...target, reps: from } },
        before: `${DAY_LABELS[next.dayId]}요일 · ${name} ${from}회/라운드`,
        after: `${name} ${from + 1}회/라운드 · ${next.method.rounds}라운드 유지 · ${next.date}부터 매주`,
      });

    if (name.includes('덤벨')) {
      const weights = matchingSets.map((set) => set.weightKg ?? 0);
      const currentWeight = weights[0];
      if (currentWeight > 0 && currentWeight < MAX_PLANNED_DUMBBELL_KG && weights.every((weight) => weight === currentWeight)) {
        const weightKg = Math.round((currentWeight + 0.5) * 2) / 2;
        return review('increase', '근력일 한 운동의 중량 0.5kg 증가 검토', [
          '계획 반복수 상한인 12회를 같은 중량으로 최근 3회 여유 있게 완료했고 피로가 낮으며 허리 불편이 없었습니다.',
          '반복수·라운드·휴식은 유지하고 이 운동의 기록 중량만 한 단계 높입니다.',
        ], { dayId: next.dayId, date: next.date, scope: 'weekly', targets: { [name]: { ...target, reps: from, weightKg } }, previousTargets: { [name]: { ...target, reps: from } },
          before: `${DAY_LABELS[next.dayId]}요일 · ${name} ${from}회 · ${currentWeight}kg`,
          after: `${name} ${from}회 · ${weightKg}kg · ${next.method.rounds}라운드 유지 · ${next.date}부터 매주`,
        }, `${weightKg}kg 덤벨을 안전하게 준비할 수 있고, 현재 통증·저림이 없습니다.`);
      }
    }

    if (name.includes('밴드')) {
      const levels = matchingSets.map((set) => normalizeBandLevel(set.bandLevel));
      const currentLevel = levels[0];
      const levelIndex = currentLevel ? BAND_LEVELS.indexOf(currentLevel) : -1;
      if (currentLevel && levelIndex >= 0 && levelIndex < BAND_LEVELS.length - 1 && levels.every((level) => level === currentLevel)) {
        const bandLevel = BAND_LEVELS[levelIndex + 1];
        return review('increase', '근력일 한 운동의 밴드 강도 증가 검토', [
          '계획 반복수 상한인 12회를 같은 밴드 강도로 최근 3회 여유 있게 완료했고 피로가 낮으며 허리 불편이 없었습니다.',
          '반복수·라운드·휴식은 유지하고 이 운동의 밴드 강도만 한 단계 높입니다.',
        ], { dayId: next.dayId, date: next.date, scope: 'weekly', targets: { [name]: { ...target, reps: from, bandLevel } }, previousTargets: { [name]: { ...target, reps: from } },
          before: `${DAY_LABELS[next.dayId]}요일 · ${name} ${from}회 · 밴드 ${currentLevel}`,
          after: `${name} ${from}회 · 밴드 ${bandLevel} · ${next.method.rounds}라운드 유지 · ${next.date}부터 매주`,
        }, `${bandLevel} 강도의 밴드를 안전하게 고정할 수 있고, 현재 통증·저림이 없습니다.`);
      }
    }
  }
  return review('maintain', '현재 계획 유지 · 저항과 수행 기록 확인', ['같은 조건의 기록이 부족하거나 안전한 증가 범위에 도달했습니다. 반복수·중량·밴드·라운드를 임의로 올리지 않고 다음 기록을 확인합니다.']);
}

export function decideAdaptiveWorkoutReview(input: AdaptiveReviewInput, reviewId: string, decision: 'applied' | 'kept', now: string, prepared = false): UserWorkoutSettings {
  const review = buildAdaptiveWorkoutReview(input);
  if (review.id !== reviewId) throw new Error('기록이나 계획이 바뀌었습니다. 최신 제안을 다시 확인해 주세요.');
  if (review.alreadyReviewed) throw new Error('이미 확인한 제안입니다.');
  if (review.action === 'hold') throw new Error('증상 확인이 먼저 필요합니다. 운동 변경을 적용하지 않았습니다.');
  if (decision === 'applied' && review.preparation && !prepared) throw new Error('운동 자세와 준비 조건을 먼저 확인해 주세요.');
  const change = decision === 'applied' ? review.change : undefined;
  const settings = input.settings;
  let next: UserWorkoutSettings = { ...settings };
  if (change?.scope === 'date') {
    next.dateOverrides = { ...settings.dateOverrides, [change.date]: { ...settings.dateOverrides[change.date], groupId: change.groupId, method: change.method } };
  } else if (change) {
    // Preserve the previous occurrence shown in this week's calendar.
    const previousDate = datePlus(change.date, -7);
    if (!settings.dateOverrides[previousDate]) next.dateOverrides = { ...settings.dateOverrides, [previousDate]: {
      groupId: settings.weeklyGroups[change.dayId] ?? CURRENT_WEEKLY_GROUPS[change.dayId],
      method: settings.weeklyMethods[change.dayId] ?? CURRENT_WEEKLY_METHODS[change.dayId],
      exerciseTargets: { ...settings.exerciseTargets, ...settings.weeklyExerciseTargets?.[change.dayId], ...change.previousTargets },
    } };
    if (change.groupId) next.weeklyGroups = { ...settings.weeklyGroups, [change.dayId]: change.groupId };
    if (change.method) next.weeklyMethods = { ...settings.weeklyMethods, [change.dayId]: change.method };
    if (change.targets) next.weeklyExerciseTargets = { ...settings.weeklyExerciseTargets, [change.dayId]: { ...settings.weeklyExerciseTargets?.[change.dayId], ...change.targets } };
  }
  const entry: AdaptiveReviewDecision = { id: review.id, action: review.action, decision, decidedAt: now, decidedFor: input.today, evidenceThrough: review.evidenceThrough,
    summary: change ? `${change.before} → ${change.after}` : '재민님 확인 · 현재 계획 유지',
  };
  next = { ...next, adaptiveReviewDecisions: [entry, ...(settings.adaptiveReviewDecisions ?? [])].slice(0, 20) };
  return next;
}
