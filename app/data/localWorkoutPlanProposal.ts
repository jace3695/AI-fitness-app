import { getWorkoutGroupById } from "./workoutGroups.ts";
import { normalizeWorkoutMethod } from "./workoutMethods.ts";
import { WORKOUT_PLAN_DAY_IDS, type WorkoutPlanProposal } from "./workoutPlanProposal.ts";
import { dayIdToPlanKey, getWeeklyWorkoutPlanById } from "./workoutPlans.ts";

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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recentSafetySignals(snapshot: unknown) {
  const sessions = Array.isArray(objectValue(snapshot).recentSessions)
    ? (objectValue(snapshot).recentSessions as unknown[]).slice(0, 7).map(objectValue)
    : [];
  const painCount = sessions.filter((session) => session.pain === true || Number(session.painScore) > 0).length;
  const highFatigueCount = sessions.filter((session) => Number(session.fatigue) >= 4).length;
  const stoppedCount = sessions.filter((session) => session.status === "stopped").length;
  return { sessionCount: sessions.length, painCount, highFatigueCount, stoppedCount, needsRecovery: painCount + highFatigueCount + stoppedCount > 0 };
}

export function buildLocalWorkoutPlanResult(snapshot: unknown, currentSettings: unknown): LocalPlanResult {
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
    if (signals.needsRecovery && !recoveryDayChanged && !["rest", "optional-cardio", "cardio-foam-recovery"].includes(groupId)) {
      groupId = "cardio-foam-recovery";
      recoveryDayChanged = true;
      reason = "최근 통증·중단·높은 피로 신호가 있어 근력일 하나를 저강도 회복일로 바꿨습니다.";
    }
    return {
      dayId,
      groupId,
      method: normalizeWorkoutMethod(objectValue(weeklyMethods[dayId])),
      reason,
    };
  });

  const signalText = signals.needsRecovery
    ? `최근 ${signals.sessionCount}회 기록에서 통증 ${signals.painCount}회, 높은 피로 ${signals.highFatigueCount}회, 중단 ${signals.stoppedCount}회를 확인했습니다.`
    : signals.sessionCount
      ? `최근 ${signals.sessionCount}회 기록에 뚜렷한 통증·중단·높은 피로 신호가 없어 현재 운동량을 유지했습니다.`
      : "최근 운동 기록이 충분하지 않아 현재 운동량을 유지했습니다.";
  const changes = recoveryDayChanged
    ? ["근력 운동일 1일을 저강도 유산소·회복 운동으로 변경", "운동별 세트·횟수는 임의로 늘리지 않음"]
    : ["현재 요일별 운동 구성을 유지", "운동별 세트·횟수는 임의로 늘리지 않음"];

  return {
    overview: `클라우드 AI 연결 없이 기기 기록을 안전 규칙으로 분석했습니다. ${signalText} 아래 계획은 미리보기이며 선택하기 전에는 적용되지 않습니다.`,
    positives: ["현재 선택한 주간 계획과 직접 수정한 요일 설정을 우선 반영했습니다."],
    cautions: signals.needsRecovery ? ["최근 회복 신호가 있어 운동 강도를 올리지 않았습니다."] : ["기록이 더 쌓일 때까지 운동량 증가는 보류했습니다."],
    nextSession: recoveryDayChanged ? ["회복일을 먼저 소화한 뒤 통증과 피로를 다시 기록하세요."] : ["현재 계획을 유지하며 운동 후 통증과 피로를 기록하세요."],
    rationale: signalText,
    safety: "허리 통증, 다리 저림, 날카로운 관절 통증이나 어지러움이 생기면 즉시 중단하고 반복되거나 악화되면 의료진과 상담하세요.",
    confidence: signals.sessionCount ? "보통" : "낮음",
    planProposal: {
      title: "기록 기반 안전 계획안",
      summary: "AI 키가 없어 비용이 들지 않는 로컬 안전 규칙으로 만들었습니다. 현재 설정을 우선하며 위험 신호가 있을 때만 회복일을 추가합니다.",
      days,
      exerciseTargets: [],
      changes,
      cautions: ["추천 적용 또는 일부 수정을 눌러야 실제 계획이 바뀝니다.", "통증을 유발한 동작과 직접적인 허리 롤링·과도한 허리 젖히기는 피하세요."],
    },
  };
}
