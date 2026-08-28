import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorkoutMethod, prepareMethodExercises } from "../data/workoutMethods.ts";

const exercises = ["스쿼트", "로우", "푸시업"].map((name) => ({ name, sets: 3, restSeconds: 45, details: [] }));

test("서킷은 본운동 전체를 라운드 수만큼 반복하고 라운드 끝에만 쉰다", () => {
  const result = prepareMethodExercises(exercises, { method: "circuit", rounds: 2, restSeconds: 90 });
  assert.equal(result.length, 6);
  assert.deepEqual(result.map((item) => item.restSeconds), [0, 0, 90, 0, 0, 90]);
  assert.ok(result.every((item) => item.sets === 1));
});

test("슈퍼세트는 운동을 두 개씩 묶어 반복한다", () => {
  const result = prepareMethodExercises(exercises, { method: "superset", rounds: 2, restSeconds: 60 });
  assert.deepEqual(result.map((item) => item.name), ["스쿼트", "로우", "스쿼트", "로우", "푸시업", "푸시업"]);
  assert.deepEqual(result.map((item) => item.restSeconds), [0, 60, 0, 60, 60, 60]);
});

test("인터벌 설정은 안전 범위로 보정된다", () => {
  const config = normalizeWorkoutMethod({ method: "interval", rounds: 99, workSeconds: 1, restSeconds: 999 });
  assert.deepEqual(config, { method: "interval", rounds: 8, workSeconds: 10, restSeconds: 300 });
  const result = prepareMethodExercises(exercises.slice(0, 1), config);
  assert.equal(result[0].intervalPlan?.rounds, 8);
});

test("휴식 0초 설정은 사용자의 선택을 유지한다", () => {
  assert.equal(normalizeWorkoutMethod({ method: "circuit", restSeconds: 0 }).restSeconds, 0);
});
