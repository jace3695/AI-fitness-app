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

test("통증 신호가 있으면 근력일 하나를 회복일로 바꾼다", () => {
    const result = buildLocalWorkoutPlanResult({ recentSessions: [{ pain: true, fatigue: 2, status: "completed" }] }, currentSettings);
    assert.equal(result.planProposal.days.some((day) => day.groupId === "cardio-foam-recovery"), true);
    assert.match(result.planProposal.changes.join(" "), /회복/);
    assert.equal(result.confidence, "보통");
});

test("높은 피로나 중단 기록도 회복 신호로 처리한다", () => {
    const result = buildLocalWorkoutPlanResult({ recentSessions: [{ pain: false, fatigue: 4, status: "stopped" }] }, currentSettings);
    assert.equal(result.planProposal.days.filter((day) => day.groupId === "cardio-foam-recovery").length, 1);
    assert.match(result.cautions[0], /강도/);
});
