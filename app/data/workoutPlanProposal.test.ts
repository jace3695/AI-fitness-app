import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkoutPlanProposal, sanitizeWorkoutPlanProposal } from "./workoutPlanProposal.ts";
import type { UserWorkoutSettings } from "./userWorkoutSettings.ts";

const allowList = {
  groupIds: new Set(["back-band-dumbbell-row", "cardio-foam-recovery"]),
  exerciseNames: new Set(["밴드 로우", "묵주기도 슬라이딩보드"]),
};

const emptySettings = (): UserWorkoutSettings => ({ weeklyGroups: {}, exerciseTargets: {}, weeklyEdits: {}, weeklyMethods: {}, dateOverrides: {} });
const allDays = (groupId: string) => ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((dayId) => ({
  dayId,
  groupId,
  method: { method: "standard", rounds: 2, restSeconds: 45, workSeconds: 30 },
  reason: "안전한 기본 계획",
}));

test("AI 운동 계획에서 허용된 요일·그룹·운동값만 보존한다", () => {
  const proposal = sanitizeWorkoutPlanProposal({
    title: "다음 주 계획",
    summary: "안전하게 유지",
    days: [
      ...allDays("back-band-dumbbell-row"),
      { dayId: "bad", groupId: "unknown", reason: "제외" },
    ],
    exerciseTargets: [
      { exerciseName: "밴드 로우", sets: 99, reps: 12, reason: "안전 범위" },
      { exerciseName: "존재하지 않는 운동", sets: 3, reps: 10, reason: "제외" },
    ],
    changes: ["월요일 등 운동"],
    cautions: ["통증 시 중단"],
  }, allowList);
  assert.ok(proposal);
  assert.equal(proposal.days.length, 7);
  assert.equal(proposal.exerciseTargets.length, 1);
  assert.equal(proposal.exerciseTargets[0].sets, 5);
});

test("사용자가 적용했을 때만 기존 설정에 AI 계획을 합친다", () => {
  const proposal = sanitizeWorkoutPlanProposal({
    title: "다음 주 계획",
    days: allDays("cardio-foam-recovery").map((day) => day.dayId === "tue" ? { ...day, method: { method: "free", rounds: 1, restSeconds: 0, workSeconds: 30 } } : day),
    exerciseTargets: [{ exerciseName: "묵주기도 슬라이딩보드", durationMinutes: 15 }],
  }, allowList);
  assert.ok(proposal);
  const original = emptySettings();
  const next = applyWorkoutPlanProposal(original, proposal);
  assert.equal(next.weeklyGroups.tue, "cardio-foam-recovery");
  assert.equal(next.weeklyMethods.tue?.method, "free");
  assert.equal(next.exerciseTargets["묵주기도 슬라이딩보드"].durationMinutes, 15);
  assert.equal(original.weeklyGroups.tue, undefined);
});

test("일부 적용은 사용자가 고른 요일과 운동량만 변경한다", () => {
  const proposal = sanitizeWorkoutPlanProposal({
    title: "일부 적용 계획",
    days: allDays("back-band-dumbbell-row"),
    exerciseTargets: [
      { exerciseName: "밴드 로우", sets: 2, reps: 10 },
      { exerciseName: "묵주기도 슬라이딩보드", durationMinutes: 12 },
    ],
  }, allowList);
  assert.ok(proposal);
  const next = applyWorkoutPlanProposal(emptySettings(), proposal, {
    dayIds: ["wed"],
    exerciseNames: ["밴드 로우"],
  });
  assert.equal(next.weeklyGroups.wed, "back-band-dumbbell-row");
  assert.equal(next.weeklyGroups.mon, undefined);
  assert.equal(next.exerciseTargets["밴드 로우"].reps, 10);
  assert.equal(next.exerciseTargets["묵주기도 슬라이딩보드"], undefined);
});
