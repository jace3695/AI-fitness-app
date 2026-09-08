import assert from "node:assert/strict";
import test from "node:test";
import { mergeCloudStateFromBase, mergeExplicitCloudBackup, stableState, type CloudState } from "./cloudSync.ts";
import { getWorkoutPeriodSummary } from "./recordAnalytics.ts";
import { WORKOUT_COMPLETED_DAYS_KEY, type WorkoutCompletionStore } from "./workoutCompletion.ts";

const dates = ["2026-09-02", "2026-09-04", "2026-09-07"];
const names = ["덤벨 고블릿 스쿼트", "밴드 로우", "덤벨 플로어프레스", "루프밴드 사이드워크", "버드독"];

function workoutState(): CloudState {
  return {
    [WORKOUT_COMPLETED_DAYS_KEY]: Object.fromEntries(dates.map((date) => [date, {
      workoutDone: true,
      workoutStatus: "completed",
      workoutBackStatus: "none",
      workoutExerciseNames: names,
      workoutExerciseRecords: names.map((exerciseName) => ({
        exerciseName,
        status: "completed",
        sets: Array.from({ length: 3 }, (_, index) => ({
          setNumber: index + 1, completed: true, plannedReps: 8, reps: 8, weightKg: 5,
        })),
      })),
    }])),
  };
}

// A JSON round trip may change object key order, including objects inside arrays.
// Array order and multiplicity must stay intact: repeated circuit entries are valid.
function reorderedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderedJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorderedJson(item)]));
  }
  return value;
}

function workouts(state: CloudState) {
  return state[WORKOUT_COMPLETED_DAYS_KEY] as WorkoutCompletionStore;
}

function assert45Sets(state: CloudState) {
  assert.equal(getWorkoutPeriodSummary(workouts(state), dates[0], dates[2]).completedSets, 45);
  for (const date of dates) {
    const record = workouts(state)[date];
    assert.equal(typeof record === "object" && record.workoutExerciseRecords?.length, 5);
  }
}

test("백업 복원 후 서버의 JSON 필드 순서가 달라도 45세트와 운동 상세를 중복하지 않는다", () => {
  const backup = workoutState();
  const existing = { [WORKOUT_COMPLETED_DAYS_KEY]: { "2026-08-01": { cardioDone: true, cardioMinutes: 20 } } };
  const restored = mergeExplicitCloudBackup(existing, backup);
  const remote = reorderedJson(restored) as CloudState;
  const merged = mergeCloudStateFromBase(existing, remote, restored);
  assert45Sets(merged);
  assert.deepEqual(workouts(merged)["2026-08-01"], { cardioDone: true, cardioMinutes: 20 });
  assert.deepEqual(merged, restored);
});

test("서버 필드 순서 변경을 다른 기기의 수정으로 오인해 수정 전 운동을 다시 추가하지 않는다", () => {
  const base = workoutState();
  const local = structuredClone(base);
  const record = workouts(local)[dates[0]];
  assert.equal(typeof record, "object");
  if (typeof record === "boolean") throw new Error("fixture must contain exercise details");
  record.workoutExerciseRecords![0].sets![0].reps = 9;
  const merged = mergeCloudStateFromBase(base, reorderedJson(base) as CloudState, local);
  assert45Sets(merged);
  assert.deepEqual(merged, local);
});

test("반복 동기화에서도 같은 기록은 증가하지 않고 양쪽의 다른 날짜 기록은 유지한다", () => {
  const base = { [WORKOUT_COMPLETED_DAYS_KEY]: {} };
  let local = workoutState();
  let remote = reorderedJson(workoutState()) as CloudState;
  workouts(local)["2026-09-01"] = { cardioDone: true, cardioMinutes: 10 };
  workouts(remote)["2026-09-08"] = { cardioDone: true, cardioMinutes: 15 };
  for (let index = 0; index < 5; index += 1) {
    local = mergeCloudStateFromBase(base, remote, local);
    remote = reorderedJson(local) as CloudState;
    assert45Sets(local);
    assert.deepEqual(workouts(local)["2026-09-01"], { cardioDone: true, cardioMinutes: 10 });
    assert.deepEqual(workouts(local)["2026-09-08"], { cardioDone: true, cardioMinutes: 15 });
    assert.equal(stableState(local), stableState(remote));
  }
});

test("중첩 필드 순서는 무시하되 운동·라운드 순서와 실제 반복 기록은 보존한다", () => {
  const first = { exerciseName: "버드독", sets: [{ setNumber: 1, completed: true }] };
  const second = { exerciseName: "밴드 로우", sets: [{ setNumber: 1, completed: true }] };
  const state = { records: [first, second, first] };
  assert.equal(stableState(state), stableState(reorderedJson(state) as CloudState));
  assert.notEqual(stableState(state), stableState({ records: [second, first, first] }));
  assert.notEqual(stableState(state), stableState({ records: [first, second] }));
  assert.deepEqual(mergeCloudStateFromBase({}, reorderedJson(state) as CloudState, state), state);
  assert.equal(state.records.length, 3);
});

test("서버의 필드 순서가 달라도 한 기기에서 삭제한 운동을 되살리지 않는다", () => {
  const base = workoutState();
  const local = structuredClone(base);
  delete workouts(local)[dates[0]];
  assert.deepEqual(mergeCloudStateFromBase(base, reorderedJson(base) as CloudState, local), local);
});
