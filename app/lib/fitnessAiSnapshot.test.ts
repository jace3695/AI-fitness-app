import assert from "node:assert/strict";
import test from "node:test";
import { buildFitnessAiSnapshot } from "../data/fitnessAiSnapshot.ts";
import type { RecordStores } from "../data/recordStorage.ts";

const emptyStores = (): RecordStores => ({ workouts: {}, diet: {}, water: {}, dinner: {}, dinnerCarbs: {}, lunchCarbs: {}, lunchProteins: {}, fastingStart: "", weights: {}, inbody: {}, notes: {}, recovery: {}, conditions: {} });

test("AI 운동 스냅샷은 최근 기록·운동 방식·세트 상세와 통증 정보를 정규화한다", () => {
  const stores = emptyStores();
  stores.workouts["2026-08-27"] = { workoutDone: true, workoutStatus: "completed", workoutFatigue: 4, workoutPain: true, workoutMethod: { method: "circuit", rounds: 2, restSeconds: 60, workSeconds: 30 }, workoutExerciseRecords: [{ exerciseName: "고블릿 스쿼트", status: "completed", painScore: 3, sets: [{ setNumber: 1, completed: true, reps: 10, weightKg: 7, plannedReps: 8, restAfterSeconds: 45 }] }] };
  const snapshot = buildFitnessAiSnapshot(stores, new Date("2026-08-28T00:00:00Z"));
  assert.equal(snapshot.recentSessions[0].pain, true);
  assert.equal(snapshot.recentSessions[0].exercises[0].maxWeightKg, 7);
  assert.equal(snapshot.recentSessions[0].exercises[0].maxReps, 10);
  assert.equal(snapshot.recentSessions[0].method?.method, "circuit");
  assert.equal(snapshot.recentSessions[0].exercises[0].setDetails[0].plannedReps, 8);
  assert.equal(snapshot.recentSessions[0].exercises[0].setDetails[0].restAfterSeconds, 45);
  assert.deepEqual(snapshot.bodyPartSets, [{ bodyPart: "하체", sets: 1 }]);
});

test("AI 운동 스냅샷은 전송 기록을 최근 28건으로 제한한다", () => {
  const stores = emptyStores();
  for (let day = 1; day <= 31; day += 1) stores.workouts[`2026-07-${String(day).padStart(2, "0")}`] = true;
  assert.equal(buildFitnessAiSnapshot(stores).recentSessions.length, 28);
});
