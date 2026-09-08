import assert from "node:assert/strict";
import test from "node:test";
import { buildLocalWorkoutPlanResult } from "./localWorkoutPlanProposal.ts";

const currentSettings = {
  selectedPlanId: "week2-basic-strength",
  userSettings: {
    weeklyGroups: { tue: "optional-cardio" },
    weeklyMethods: { mon: { method: "circuit", rounds: 2 } },
  },
};

test("로컬 계획은 현재 설정을 유지하고 7일 미리보기를 만든다", () => {
    const result = buildLocalWorkoutPlanResult({ recentSessions: [{ pain: false, fatigue: 2, status: "completed" }] }, currentSettings);
    assert.equal(result.planProposal.days.length, 7);
    assert.equal(new Set(result.planProposal.days.map((day) => day.dayId)).size, 7);
    assert.equal(result.planProposal.days.find((day) => day.dayId === "tue")?.groupId, "optional-cardio");
    assert.equal(result.planProposal.days.find((day) => day.dayId === "mon")?.method.method, "circuit");
    assert.deepEqual(result.planProposal.exerciseTargets, []);
});

test("통증 신호는 회복 운동을 자동 추천하지 않고 증상 확인을 안내한다", () => {
    const result = buildLocalWorkoutPlanResult({ recentSessions: [{ pain: true, fatigue: 2, status: "completed" }] }, currentSettings);
    assert.equal(result.planProposal.days.some((day) => day.groupId === "current-fullbody-recovery-circuit"), false);
    assert.match(result.nextSession.join(' '), /의료 평가/);
    assert.equal(result.confidence, "보통");
});

test("높은 피로나 중단 기록도 회복 신호로 처리한다", () => {
    const result = buildLocalWorkoutPlanResult({ recentSessions: [{ pain: false, fatigue: 4, status: "stopped" }] }, currentSettings);
    assert.equal(result.planProposal.days.filter((day) => day.groupId === "current-fullbody-recovery-circuit").length, 1);
  assert.match(result.cautions[0], /강도/);
});

test("허리 악화나 신경 증상은 강도 상승 없이 의료 평가 안내로 연결한다", () => {
  const result = buildLocalWorkoutPlanResult({
    recentSessions: [{ performed: false, pain: true, backStatus: "worse", neurologicalSymptoms: ["leg-weakness"], fatigue: 3, status: "stopped" }],
  }, currentSettings);
  assert.match(result.cautions[0], /신경 증상/);
  assert.match(result.nextSession[0], /의료 평가/);
  assert.match(result.safety, /단순 강화 과정/);
});

test("월 예산 보호 시에도 비용 없는 로컬 계획의 이유를 정확히 알린다", () => {
  const result = buildLocalWorkoutPlanResult({ recentSessions: [] }, currentSettings, "budget_protected");
  assert.match(result.overview, /예산을 보호/);
  assert.match(result.planProposal.summary, /월 AI 예산/);
});

test("AI 응답이 완전하지 않아도 재호출 없이 로컬 계획으로 전환한다", () => {
  const result = buildLocalWorkoutPlanResult({ recentSessions: [] }, currentSettings, "model_response_unusable");
  assert.match(result.overview, /추가 호출 없이/);
  assert.match(result.planProposal.summary, /다시 호출하지 않고/);
});
