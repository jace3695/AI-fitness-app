import assert from "node:assert/strict";
import test from "node:test";
import { getWorkoutGroupById, workoutGroupToDayWorkout, WORKOUT_GROUPS } from "./workoutGroups.ts";
import { DEFAULT_WEEKLY_WORKOUT_PLAN_ID, getWeeklyWorkoutPlanById } from "./workoutPlans.ts";
import { CURRENT_WEEKLY_METHODS } from "./currentWorkoutDirection.ts";
import { prepareMethodExercises } from "./workoutMethods.ts";

test("슬라이딩보드 운동명에는 기도 문구를 섞지 않는다", () => {
  const prayerWord = "\uBB35\uC8FC";
  const names = WORKOUT_GROUPS.flatMap((group) =>
    group.type === "choice"
      ? group.options.map((option) => option.name)
      : group.exercises.map((exercise) => exercise.name || ""),
  );

  assert.equal(names.some((name) => name.includes(prayerWord)), false);
  assert.equal(names.includes("운동 전 슬라이딩보드"), true);
});

test("현재 기본 계획은 월수금 근력·화목 회복형이며 슬라이딩보드를 루틴에서만 제외한다", () => {
  const plan = getWeeklyWorkoutPlanById(DEFAULT_WEEKLY_WORKOUT_PLAN_ID);
  assert.equal(plan.id, "five-day-fullbody-circuit");
  assert.deepEqual(
    [plan.days.monday, plan.days.tuesday, plan.days.wednesday, plan.days.thursday, plan.days.friday],
    ["current-fullbody-strength-circuit", "current-fullbody-recovery-circuit", "current-fullbody-strength-circuit", "current-fullbody-recovery-circuit", "current-fullbody-strength-circuit"],
  );

  const currentGroupIds = Object.values(plan.days);
  const currentNames = currentGroupIds.flatMap((id) => {
    const group = getWorkoutGroupById(id);
    return group.type === "choice"
      ? group.options.flatMap((option) => [option.name, ...option.exerciseIds])
      : group.exercises.flatMap((exercise) => [exercise.name || "", exercise.exerciseId]);
  });
  assert.equal(currentNames.some((name) => name.includes("슬라이딩보드") || name.includes("sliding")), false);
  assert.equal(getWorkoutGroupById("optional-cardio").type, "choice");
});

test("근력·회복형 서킷은 준비와 정리를 한 번만 하고 본운동만 라운드 반복한다", () => {
  const strengthDay = workoutGroupToDayWorkout(getWorkoutGroupById("current-fullbody-strength-circuit"), "mon", "월요일");
  const recoveryDay = workoutGroupToDayWorkout(getWorkoutGroupById("current-fullbody-recovery-circuit"), "tue", "화요일");
  const strengthMain = strengthDay.phases.find((phase) => phase.id === "main")?.exercises ?? [];
  const recoveryMain = recoveryDay.phases.find((phase) => phase.id === "main")?.exercises ?? [];

  assert.deepEqual(strengthDay.phases.map((phase) => phase.id), ["warmup", "main", "cooldown"]);
  assert.deepEqual(strengthMain.map((exercise) => exercise.name), ["덤벨 고블릿 스쿼트", "밴드 로우", "덤벨 플로어프레스", "루프밴드 사이드워크", "버드독"]);
  assert.deepEqual(recoveryMain.map((exercise) => exercise.name), ["맨몸 스쿼트", "가벼운 밴드 로우", "벽 푸시업", "버드독", "가벼운 루프밴드 사이드워크"]);
  assert.equal(prepareMethodExercises(strengthMain, CURRENT_WEEKLY_METHODS.mon).length, 15);
  assert.equal(prepareMethodExercises(recoveryMain, CURRENT_WEEKLY_METHODS.tue).length, 5);
  assert.deepEqual(prepareMethodExercises(strengthMain, CURRENT_WEEKLY_METHODS.mon).slice(0, 5).map((exercise) => exercise.restSeconds), [30, 30, 30, 30, 75]);
});

test("선택 유산소의 슬라이딩보드 항목은 하나만 제공한다", () => {
  const group = getWorkoutGroupById("optional-cardio");
  assert.equal(group.type, "choice");
  if (group.type !== "choice") return;

  assert.equal(
    group.options.filter((option) => option.name.includes("슬라이딩보드")).length,
    1,
  );
});
