import { getWorkoutGroupById, workoutGroupToDayWorkout } from "./workoutGroups.ts";
import { dayIdToKoreanLabel, dayIdToPlanKey, getWeeklyWorkoutPlanById } from "./workoutPlans.ts";
import { applyDayRoutineEdit, applyExerciseTargets } from "./userWorkoutSettings.ts";
import type { UserWorkoutSettings } from "./userWorkoutSettings.ts";
import { getWorkoutMethodLabel, normalizeWorkoutMethod } from "./workoutMethods.ts";
import type { WorkoutDayId } from "./workoutCompletion.ts";

const PROGRAM_DAY_IDS: WorkoutDayId[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

type ProgramFocus = "upperPush" | "upperPull" | "lowerBody" | "core" | "cardio";

const PROGRAM_FOCUS_LABELS: Record<ProgramFocus, string> = {
  upperPush: "상체 밀기",
  upperPull: "상체 당기기",
  lowerBody: "하체",
  core: "코어 안정화",
  cardio: "유산소",
};

const PROGRAM_FOCUS_BY_EXERCISE: Record<string, ProgramFocus[]> = {
  "dumbbell-floor-press": ["upperPush"],
  "longband-lat-pulldown": ["upperPull"],
  "band-row": ["upperPull"],
  "one-arm-dumbbell-row-supported": ["upperPull"],
  "longband-face-pull": ["upperPull"],
  "band-pull-apart": ["upperPull"],
  "dumbbell-goblet-squat": ["lowerBody"],
  "loopband-sidewalk": ["lowerBody"],
  "loopband-monster-walk": ["lowerBody"],
  "bird-dog": ["core"],
  "dead-bug": ["core"],
  "pelvic-tilt": ["core"],
  "knee-side-plank": ["core"],
  "ab-slider-ready-position": ["core"],
  "cat-cow": ["core"],
  "sliding-board-cardio": ["cardio"],
  "pre-rosary-sliding-board": ["cardio"],
  "rosary-sliding-board": ["cardio"],
  "post-sliding-board": ["cardio"],
  "indoor-walk": ["cardio"],
  "outdoor-walk": ["cardio"],
};

export type WorkoutProgramReviewTone = "good" | "watch" | "adjust";
export type WorkoutProgramReviewStatus = "기본 계획 유지" | "조정 확인" | "회복 우선" | "기록 확인 필요";

export interface WorkoutProgramReviewCard {
  label: string;
  value: string;
  detail: string;
  tone: WorkoutProgramReviewTone;
}

export interface WorkoutProgramAiReview {
  status: WorkoutProgramReviewStatus;
  summary: string;
  cards: WorkoutProgramReviewCard[];
  priorities: string[];
}

export interface WorkoutProgramContext {
  selectedPlan: {
    id: string;
    name: string;
    weekLabel: string;
    description: string;
    recommendedFor: string;
  };
  summary: {
    plannedWorkoutDays: number;
    strengthDays: number;
    cardioDays: number;
    coreDays: number;
    recoveryDays: number;
    restDays: number;
    estimatedMinutes: number;
    plannedWorkBlocks: number;
    focusDays: Record<ProgramFocus, number>;
    focusSets: Record<ProgramFocus, number>;
    focusExerciseCount: Record<ProgramFocus, number>;
  };
  days: Array<{
    dayId: WorkoutDayId;
    dayLabel: string;
    groupId: string;
    groupName: string;
    category: string;
    intensity: string;
    estimatedMinutes: number;
    method: string;
    methodLabel: string;
    rounds: number;
    restSeconds: number;
    workSeconds: number;
    plannedWorkBlocks: number;
    exercises: Array<{
      order: number;
      id: string;
      name: string;
      plannedSets: number;
      restSeconds: number;
      meta: string;
      focus: string[];
    }>;
  }>;
  notes: string[];
}

function safeText(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function estimatedMinutes(value: string) {
  const match = value.match(/(\d+)(?:\s*~\s*(\d+))?\s*분/);
  if (!match) return 0;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  return Number.isFinite(min) && Number.isFinite(max) ? Math.round((min + max) / 2) : 0;
}

function getFocus(exerciseId: string, name: string): ProgramFocus[] {
  const byId = PROGRAM_FOCUS_BY_EXERCISE[exerciseId];
  if (byId) return byId;
  const source = `${exerciseId} ${name}`.toLowerCase();
  if (/로우|랫풀|페이스풀|풀어파트/.test(source)) return ["upperPull"];
  if (/프레스/.test(source)) return ["upperPush"];
  if (/스쿼트|사이드워크|몬스터워크/.test(source)) return ["lowerBody"];
  if (/버드독|데드버그|플랭크|골반|캣카우|ab 슬라이더/.test(source)) return ["core"];
  if (/슬라이딩|걷기|산책|유산소/.test(source)) return ["cardio"];
  return [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function baseSettings(value?: UserWorkoutSettings | null): UserWorkoutSettings {
  const raw = objectValue(value);
  return {
    weeklyGroups: objectValue(raw.weeklyGroups) as UserWorkoutSettings["weeklyGroups"],
    exerciseTargets: objectValue(raw.exerciseTargets) as UserWorkoutSettings["exerciseTargets"],
    weeklyEdits: objectValue(raw.weeklyEdits) as UserWorkoutSettings["weeklyEdits"],
    weeklyMethods: objectValue(raw.weeklyMethods) as UserWorkoutSettings["weeklyMethods"],
    dateOverrides: objectValue(raw.dateOverrides) as UserWorkoutSettings["dateOverrides"],
  };
}

export function buildWorkoutProgramContext(input: {
  selectedPlanId?: string | null;
  userSettings?: UserWorkoutSettings | null;
}): WorkoutProgramContext {
  const selectedPlan = getWeeklyWorkoutPlanById(input.selectedPlanId);
  const settings = baseSettings(input.userSettings);
  const focusDays: Record<ProgramFocus, number> = { upperPush: 0, upperPull: 0, lowerBody: 0, core: 0, cardio: 0 };
  const focusSets: Record<ProgramFocus, number> = { upperPush: 0, upperPull: 0, lowerBody: 0, core: 0, cardio: 0 };
  const focusExerciseCount: Record<ProgramFocus, number> = { upperPush: 0, upperPull: 0, lowerBody: 0, core: 0, cardio: 0 };
  let plannedWorkoutDays = 0;
  let strengthDays = 0;
  let cardioDays = 0;
  let coreDays = 0;
  let recoveryDays = 0;
  let restDays = 0;
  let totalMinutes = 0;
  let plannedWorkBlocks = 0;

  const days = PROGRAM_DAY_IDS.map((dayId) => {
    const groupId = settings.weeklyGroups[dayId] || selectedPlan.days[dayIdToPlanKey[dayId]];
    const group = getWorkoutGroupById(groupId);
    const method = normalizeWorkoutMethod(settings.weeklyMethods[dayId]);
    const baseDay = workoutGroupToDayWorkout(group, dayId, dayIdToKoreanLabel[dayId]);
    const editedDay = applyDayRoutineEdit(baseDay, settings.weeklyEdits[dayId]);
    const day = applyExerciseTargets(editedDay, settings.exerciseTargets);
    const exercises = day.phases.flatMap((phase) => phase.exercises).map((exercise, index) => {
      const plannedSets = Math.max(0, Number(exercise.sets) || 0);
      const focusIds = getFocus(exercise.exerciseId || "", exercise.name);
      return {
        order: index + 1,
        id: exercise.exerciseId || exercise.name,
        name: exercise.name,
        plannedSets,
        restSeconds: Math.max(0, Number(exercise.restSeconds) || 0),
        meta: safeText(exercise.meta, 100),
        focus: focusIds.map((item) => PROGRAM_FOCUS_LABELS[item]),
        focusIds,
      };
    });
    const activeExercises = exercises.filter((exercise) => exercise.plannedSets > 0);
    const activeFocus = new Set(activeExercises.flatMap((exercise) => exercise.focusIds));
    activeFocus.forEach((focus) => { focusDays[focus] += 1; });
    activeExercises.forEach((exercise) => {
      const effectiveSets = method.method === "standard" || method.method === "free" ? exercise.plannedSets : method.rounds;
      exercise.focusIds.forEach((focus) => {
        focusSets[focus] += effectiveSets;
        focusExerciseCount[focus] += 1;
      });
    });
    const workExerciseCount = exercises.filter((exercise) => exercise.plannedSets > 0).length;
    const baseBlocks = exercises.reduce((sum, exercise) => sum + exercise.plannedSets, 0);
    const dayWorkBlocks = method.method === "standard" || method.method === "free"
      ? baseBlocks
      : workExerciseCount * method.rounds;
    const duration = estimatedMinutes(group.duration);
    totalMinutes += duration;
    plannedWorkBlocks += dayWorkBlocks;
    if (group.category === "rest") restDays += 1;
    else {
      plannedWorkoutDays += 1;
      if (group.category === "strength") strengthDays += 1;
      if (group.category === "cardio") cardioDays += 1;
      if (group.category === "core") coreDays += 1;
      if (group.category === "recovery") recoveryDays += 1;
    }
    return {
      dayId,
      dayLabel: dayIdToKoreanLabel[dayId],
      groupId: group.id,
      groupName: group.name,
      category: group.category,
      intensity: group.intensity,
      estimatedMinutes: duration,
      method: method.method,
      methodLabel: getWorkoutMethodLabel(method.method),
      rounds: method.rounds,
      restSeconds: method.restSeconds,
      workSeconds: method.workSeconds,
      plannedWorkBlocks: dayWorkBlocks,
      exercises: exercises.map(({ focusIds: _focusIds, ...exercise }) => exercise),
    };
  });

  const notes = [
    "기본 주간 계획과 매주 저장한 요일·운동량·방식 설정을 기준으로 계산합니다.",
    "이번 주만 또는 오늘만 바꾼 임시 일정은 장기 프로그램 점검에 포함하지 않습니다.",
    "예상 시간과 작업 묶음은 계획값이며 실제 완료 기록과는 다를 수 있습니다.",
  ];

  return {
    selectedPlan: {
      id: selectedPlan.id,
      name: selectedPlan.name,
      weekLabel: selectedPlan.weekLabel,
      description: selectedPlan.description,
      recommendedFor: selectedPlan.recommendedFor,
    },
    summary: {
      plannedWorkoutDays,
      strengthDays,
      cardioDays,
      coreDays,
      recoveryDays,
      restDays,
      estimatedMinutes: totalMinutes,
      plannedWorkBlocks,
      focusDays,
      focusSets,
      focusExerciseCount,
    },
    days,
    notes,
  };
}

function recentSafetySignals(snapshot: unknown) {
  const root = snapshot && typeof snapshot === "object" ? snapshot as Record<string, unknown> : {};
  const sessions = Array.isArray(root.recentSessions) ? root.recentSessions.slice(0, 7) : [];
  const normalized = sessions.filter((session): session is Record<string, unknown> => Boolean(session) && typeof session === "object");
  const pain = normalized.filter((session) => session.pain === true || Number(session.painScore) > 0).length;
  const fatigue = normalized.filter((session) => Number(session.fatigue) >= 4).length;
  const stopped = normalized.filter((session) => session.status === "stopped").length;
  return { sessionCount: normalized.length, pain, fatigue, stopped, needsRecovery: pain + fatigue + stopped > 0 };
}

export function buildWorkoutProgramReviewCards(
  context: WorkoutProgramContext,
  snapshot?: unknown,
): WorkoutProgramReviewCard[] {
  const signals = recentSafetySignals(snapshot);
  const summary = context.summary;
  const adaptationWeek = context.selectedPlan.id === "week1-cardio-back";
  const pullPushTone: WorkoutProgramReviewTone = adaptationWeek || summary.focusSets.upperPull === summary.focusSets.upperPush
    ? "good"
    : summary.focusSets.upperPull === 0 || summary.focusSets.upperPush === 0 ? "watch" : "adjust";
  const lowerCoreTone: WorkoutProgramReviewTone = adaptationWeek || (summary.focusSets.lowerBody > 0 && summary.focusSets.core > 0)
    ? "good"
    : "watch";
  const weeklyComposition = `근력 ${summary.strengthDays}일 · 유산소 ${summary.cardioDays}일 · 코어 ${summary.coreDays}일`;

  return [
    { label: "주간 구성", value: weeklyComposition, detail: `휴식 ${summary.restDays}일 · 회복 ${summary.recoveryDays}일`, tone: signals.needsRecovery ? "watch" : "good" },
    { label: "상체 균형", value: `당기기 ${summary.focusSets.upperPull}세트 · 밀기 ${summary.focusSets.upperPush}세트`, detail: "준비·자세 연습을 제외한 본운동 세트 기준", tone: pullPushTone },
    { label: "하체·코어", value: `하체 ${summary.focusSets.lowerBody}세트 · 코어 ${summary.focusSets.core}세트`, detail: "준비·자세 연습을 제외한 본운동 세트 기준", tone: lowerCoreTone },
    { label: "예상 운동량", value: `${summary.plannedWorkoutDays}일 · 약 ${summary.estimatedMinutes}분`, detail: `계획 작업 묶음 ${summary.plannedWorkBlocks}개`, tone: summary.plannedWorkoutDays ? "good" : "watch" },
  ];
}

export function buildLocalWorkoutProgramReview(
  context: WorkoutProgramContext,
  snapshot?: unknown,
): WorkoutProgramAiReview {
  const signals = recentSafetySignals(snapshot);
  const summary = context.summary;
  const adaptationWeek = context.selectedPlan.id === "week1-cardio-back";
  const pullPushTone: WorkoutProgramReviewTone = adaptationWeek || summary.focusSets.upperPull === summary.focusSets.upperPush
    ? "good"
    : summary.focusSets.upperPull === 0 || summary.focusSets.upperPush === 0 ? "watch" : "adjust";
  const lowerCoreTone: WorkoutProgramReviewTone = adaptationWeek || (summary.focusSets.lowerBody > 0 && summary.focusSets.core > 0)
    ? "good"
    : "watch";
  const needsBalanceCheck = pullPushTone !== "good" || lowerCoreTone !== "good";
  const status: WorkoutProgramReviewStatus = signals.needsRecovery
    ? "회복 우선"
    : needsBalanceCheck ? "조정 확인" : "기본 계획 유지";
  const priorities = signals.needsRecovery
    ? ["최근 통증·높은 피로·중단 기록이 있어 이번 주는 강도 증가보다 회복일 확보를 먼저 확인하세요."]
    : adaptationWeek
      ? ["현재 1주차 적응 목적에 맞춰 근력운동을 급하게 추가하지 말고 통증 없는 완료 기록을 먼저 쌓으세요."]
      : ["현재 계획의 균형은 미리보기입니다. 실제 완료 기록과 통증·피로를 함께 보고 한 항목만 조정하세요."];
  return {
    status,
    summary: signals.needsRecovery
      ? "최근 회복 신호가 있어 프로그램의 균형보다 회복과 통증 없는 수행을 먼저 확인하는 것이 안전합니다."
      : adaptationWeek
        ? "현재 1주차 적응 계획은 허리 안정화와 저강도 유산소를 우선하도록 설계되어 있습니다."
        : "현재 주간 기본 계획의 운동 구성과 방식입니다. 실제 기록과 함께 보면 더 정확한 조정이 가능합니다.",
    cards: buildWorkoutProgramReviewCards(context, snapshot),
    priorities,
  };
}

function isTone(value: unknown): value is WorkoutProgramReviewTone {
  return value === "good" || value === "watch" || value === "adjust";
}

function isStatus(value: unknown): value is WorkoutProgramReviewStatus {
  return value === "기본 계획 유지" || value === "조정 확인" || value === "회복 우선" || value === "기록 확인 필요";
}

export function sanitizeWorkoutProgramReview(value: unknown): WorkoutProgramAiReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const cards = Array.isArray(raw.cards)
    ? raw.cards.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const card = item as Record<string, unknown>;
      const label = safeText(card.label, 40);
      const detail = safeText(card.detail, 220);
      const cardValue = safeText(card.value, 80);
      if (!label || !cardValue || !detail) return [];
      return [{ label, value: cardValue, detail, tone: isTone(card.tone) ? card.tone : "watch" }];
    }).slice(0, 4)
    : [];
  if (!cards.length) return null;
  const priorities = Array.isArray(raw.priorities)
    ? raw.priorities.map((item) => safeText(item, 240)).filter(Boolean).slice(0, 4)
    : [];
  return {
    status: isStatus(raw.status) ? raw.status : "기록 확인 필요",
    summary: safeText(raw.summary, 600),
    cards,
    priorities,
  };
}
