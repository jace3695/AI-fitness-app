import { getWorkoutGroupById } from "./workoutGroups.ts";
import { normalizeWorkoutMethod } from "./workoutMethods.ts";
import { WORKOUT_PLAN_DAY_IDS, type WorkoutPlanProposal } from "./workoutPlanProposal.ts";
import { dayIdToPlanKey, getWeeklyWorkoutPlanById } from "./workoutPlans.ts";
import { CURRENT_WEEKLY_METHODS } from "./currentWorkoutDirection.ts";

type LocalPlanResult = {
  overview: string;
  positives: string[];
  cautions: string[];
  nextSession: string[];
  rationale: string;
  safety: string;
  confidence: "보통" | "낮음";
  planProposal: WorkoutPlanProposal;
};

type LocalPlanFallbackReason = "provider_unavailable" | "budget_protected" | "model_response_unusable";

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recentSafetySignals(snapshot: unknown) {
  const sessions = Array.isArray(objectValue(snapshot).recentSessions)
    ? (objectValue(snapshot).recentSessions as unknown[]).map(objectValue).filter((session) => session.performed !== false || session.status === 'stopped' || session.pain === true || session.backStatus === 'worse' || (Array.isArray(session.neurologicalSymptoms) && session.neurologicalSymptoms.length > 0)).slice(0, 7)
    : [];
  const painCount = sessions.filter((session) => session.pain === true || Number(session.painScore) > 0).length;
  const neurologicalCount = sessions.filter((session) => Array.isArray(session.neurologicalSymptoms) && session.neurologicalSymptoms.length > 0).length;
  const worseBackCount = sessions.filter((session) => session.backStatus === "worse").length;
  const highFatigueCount = sessions.filter((session) => Number(session.fatigue) >= 4).length;
  const stoppedCount = sessions.filter((session) => session.status === "stopped").length;
  return { sessionCount: sessions.length, painCount, neurologicalCount, worseBackCount, highFatigueCount, stoppedCount, seriousSignal: painCount + neurologicalCount + worseBackCount > 0, needsRecovery: painCount + neurologicalCount + worseBackCount + highFatigueCount + stoppedCount > 0 };
}

export function buildLocalWorkoutPlanResult(
  snapshot: unknown,
  currentSettings: unknown,
  fallbackReason: LocalPlanFallbackReason = "provider_unavailable",
): LocalPlanResult {
  const settings = objectValue(currentSettings);
  const userSettings = objectValue(settings.userSettings);
  const weeklyGroups = objectValue(userSettings.weeklyGroups);
  const weeklyMethods = objectValue(userSettings.weeklyMethods);
  const plan = getWeeklyWorkoutPlanById(typeof settings.selectedPlanId === "string" ? settings.selectedPlanId : null);
  const signals = recentSafetySignals(snapshot);
  let recoveryDayChanged = false;

  const days = WORKOUT_PLAN_DAY_IDS.map((dayId) => {
    const baseGroupId = typeof weeklyGroups[dayId] === "string"
      ? String(weeklyGroups[dayId])
      : plan.days[dayIdToPlanKey[dayId]];
    let groupId = getWorkoutGroupById(baseGroupId).id;
    let reason = "현재 선택한 주간 계획과 요일별 설정을 유지했습니다.";
    if (plan.id !== 'five-day-fullbody-circuit' && signals.needsRecovery && !signals.seriousSignal && !recoveryDayChanged && getWorkoutGroupById(groupId).category === "strength") {
      groupId = "current-fullbody-recovery-circuit";
      recoveryDayChanged = true;
      reason = "최근 중단·높은 피로 신호로 근력일을 회복형으로 낮췄습니다.";
    }
    const configuredMethod = objectValue(weeklyMethods[dayId]);
    const method = groupId === "current-fullbody-recovery-circuit" && groupId !== baseGroupId
      ? CURRENT_WEEKLY_METHODS.tue
      : Object.keys(configuredMethod).length
        ? normalizeWorkoutMethod(configuredMethod)
        : CURRENT_WEEKLY_METHODS[dayId];
    return {
      dayId,
      groupId,
      method,
      reason,
    };
  });

  const signalText = signals.needsRecovery
    ? `최근 ${signals.sessionCount}회 기록에서 통증 ${signals.painCount}회, 신경 증상 ${signals.neurologicalCount}회, 허리 악화 ${signals.worseBackCount}회, 높은 피로 ${signals.highFatigueCount}회, 중단 ${signals.stoppedCount}회를 확인했습니다.`
    : signals.sessionCount
      ? `최근 ${signals.sessionCount}회 기록에 뚜렷한 통증·중단·높은 피로 신호가 없어 현재 운동량을 유지했습니다.`
      : "최근 운동 기록이 충분하지 않아 현재 운동량을 유지했습니다.";
  const changes = recoveryDayChanged
    ? ["근력 운동일 1일을 회복형 전신 서킷으로 변경", "운동별 세트·횟수는 임의로 늘리지 않음"]
    : ["현재 요일별 계획을 유지", "운동별 세트·횟수는 임의로 늘리지 않음"];
  const sourceText = fallbackReason === "budget_protected"
    ? "이번 달 유료 AI 예산을 보호하기 위해 비용 없는 로컬 안전 규칙으로 기록을 분석했습니다."
    : fallbackReason === "model_response_unusable"
      ? "AI 응답을 끝까지 읽지 못해 추가 호출 없이 로컬 안전 규칙으로 기록을 분석했습니다."
      : "클라우드 AI 연결을 사용할 수 없어 기기 기록을 안전 규칙으로 분석했습니다.";
  const planSummary = fallbackReason === "budget_protected"
    ? "월 AI 예산을 보호하기 위해 비용이 들지 않는 로컬 안전 규칙으로 만들었습니다. 현재 설정을 우선하며 위험 신호가 있을 때만 회복일을 추가합니다."
    : fallbackReason === "model_response_unusable"
      ? "AI 응답 형식이 완전하지 않아 다시 호출하지 않고 로컬 안전 규칙으로 만들었습니다. 현재 설정을 우선하며 위험 신호가 있을 때만 회복일을 추가합니다."
      : "클라우드 AI 연결을 사용할 수 없어 로컬 안전 규칙으로 만들었습니다. 현재 설정을 우선하며 위험 신호가 있을 때만 회복일을 추가합니다.";

  return {
    overview: `${sourceText} ${signalText} 아래 계획은 미리보기이며 선택하기 전에는 적용되지 않습니다.`,
    positives: ["현재 선택한 주간 계획과 직접 수정한 요일 설정을 우선 반영했습니다."],
    cautions: signals.seriousSignal ? ["허리 악화 또는 신경 증상이 있어 운동 강도를 올리지 않았습니다."] : signals.needsRecovery ? ["최근 회복 신호가 있어 운동 강도를 올리지 않았습니다."] : ["기록이 더 쌓일 때까지 운동량 증가는 보류했습니다."],
    nextSession: signals.seriousSignal ? ["증상을 유발하는 운동을 중단하고 증상이 지속되거나 심해지면 의료 평가를 받으세요. 회복형 운동도 임의로 시작하지 않습니다."] : plan.id === 'five-day-fullbody-circuit' ? ['운동 홈의 「연이의 운동 조정 제안」에서 최신 기록에 따른 유지·증가·교체·감소 내용을 확인해 적용하세요.'] : recoveryDayChanged ? ["회복형 서킷을 먼저 소화한 뒤 허리 상태와 피로를 다시 기록하세요."] : ["현재 계획을 유지하며 완료율·수행량·허리 상태와 피로를 기록하세요."],
    rationale: signalText,
    safety: "허리 악화, 엉덩이·다리로 내려가는 통증, 저림, 감각 저하나 다리 힘 빠짐은 단순 강화 과정으로 보지 않습니다. 즉시 중단하고 지속되거나 심해지면 의료 평가를 받으세요.",
    confidence: signals.sessionCount ? "보통" : "낮음",
    planProposal: {
      title: "근력·회복 교차 안전 계획안",
      summary: planSummary,
      days,
      exerciseTargets: [],
      changes,
      cautions: ["추천 적용 또는 일부 수정을 눌러야 실제 계획이 바뀝니다.", "현재 루틴에서는 슬라이딩보드를 새로 추천하지 않으며, 허리는 많이 움직이기보다 몸통 안정성을 우선합니다."],
    },
  };
}
