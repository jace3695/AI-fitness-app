import assert from "node:assert/strict";
import test from "node:test";
import { getWorkoutGroupById, WORKOUT_GROUPS } from "./workoutGroups.ts";

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

test("선택 유산소의 슬라이딩보드 항목은 하나만 제공한다", () => {
  const group = getWorkoutGroupById("optional-cardio");
  assert.equal(group.type, "choice");
  if (group.type !== "choice") return;

  assert.equal(
    group.options.filter((option) => option.name.includes("슬라이딩보드")).length,
    1,
  );
});
