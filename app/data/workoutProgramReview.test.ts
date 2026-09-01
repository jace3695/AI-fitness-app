import assert from "node:assert/strict";
import test from "node:test";
import { buildLocalWorkoutProgramReview, buildWorkoutProgramContext, sanitizeWorkoutProgramReview } from "./workoutProgramReview.ts";

test("현재 주간 설정을 7일 프로그램 구성표로 안전하게 계산한다", () => {
  const context = buildWorkoutProgramContext({
    selectedPlanId: "week2-basic-strength",
    userSettings: {
      weeklyGroups: { tue: "optional-cardio" },
      exerciseTargets: { "밴드 로우": { sets: 3, reps: 10 } },
      weeklyEdits: {},
      weeklyMethods: { mon: { method: "circuit", rounds: 2, restSeconds: 45, workSeconds: 30 } },
      dateOverrides: {},
    },
  });

  assert.equal(context.selectedPlan.id, "week2-basic-strength");
  assert.equal(context.days.length, 7);
  assert.equal(context.summary.strengthDays, 3);
  assert.equal(context.summary.cardioDays, 2);
  assert.equal(context.summary.coreDays, 1);
  assert.equal(context.summary.restDays, 1);
  assert.equal(context.days.find((day) => day.dayId === "mon")?.method, "circuit");
  assert.equal(context.days.find((day) => day.dayId === "mon")?.rounds, 2);
  assert.equal(context.days.find((day) => day.dayId === "mon")?.exercises.find((exercise) => exercise.name === "밴드 로우")?.plannedSets, 3);
  assert.equal(context.days.some((day) => day.exercises.some((exercise) => exercise.id === "hip-bridge")), false);
  assert.ok(context.summary.estimatedMinutes > 0);
});

test("통증·높은 피로·중단 기록이 있으면 로컬 점검도 회복을 우선한다", () => {
  const context = buildWorkoutProgramContext({ selectedPlanId: "week1-cardio-back" });
  const stable = buildLocalWorkoutProgramReview(context, { recentSessions: [{ pain: false, fatigue: 2, status: "completed" }] });
  const recovery = buildLocalWorkoutProgramReview(context, { recentSessions: [{ pain: true, fatigue: 4, status: "stopped" }] });

  assert.equal(stable.status, "기본 계획 유지");
  assert.equal(stable.cards.length, 4);
  assert.equal(recovery.status, "회복 우선");
  assert.match(recovery.summary, /회복/);
  assert.match(recovery.priorities[0], /강도 증가/);
});

test("AI 프로그램 점검 결과는 허용된 상태·카드만 표시한다", () => {
  const review = sanitizeWorkoutProgramReview({
    status: "조정 확인",
    summary: "상체 당기기 비중을 먼저 확인하세요.",
    cards: [
      { label: "상체 균형", value: "당기기 3일 · 밀기 1일", detail: "주간 계획 기준", tone: "adjust" },
      { label: "무시", value: "", detail: "", tone: "bad" },
    ],
    priorities: ["다음 주에도 통증이 없을 때만 한 항목을 조정하세요."],
  });

  assert.ok(review);
  assert.equal(review.status, "조정 확인");
  assert.equal(review.cards.length, 1);
  assert.equal(review.cards[0].tone, "adjust");
  assert.equal(sanitizeWorkoutProgramReview({ cards: [] }), null);
});
