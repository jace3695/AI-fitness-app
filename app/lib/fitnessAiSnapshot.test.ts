import assert from "node:assert/strict";
import test from "node:test";
import { buildFitnessAiSnapshot } from "../data/fitnessAiSnapshot.ts";
import type { RecordStores } from "../data/recordStorage.ts";

const emptyStores = (): RecordStores => ({ workouts: {}, diet: {}, water: {}, dinner: {}, dinnerCarbs: {}, lunchCarbs: {}, lunchProteins: {}, fastingStart: "", weights: {}, inbody: {}, notes: {}, recovery: {}, conditions: {} });

test("AI 운동 스냅샷은 최근 기록과 통증 정보를 정규화한다", () => {
  const stores = emptyStores();
  stores.workouts["2026-08-27"] = { workoutDone: true, workoutStatus: "completed", workoutFatigue: 4, workoutPain: true, workoutExerciseRecords: [{ exerciseName: "고블릿 스쿼트", status: "completed", painScore: 3, sets: [{ setNumber: 1, completed: true, reps: 10, weightKg: 7 }] }] };
  const snapshot = buildFitnessAiSnapshot(stores, new Date("2026-08-28T00:00:00Z"));
  assert.equal(snapshot.recentSessions[0].pain, true);
  assert.equal(snapshot.recentSessions[0].exercises[0].maxWeightKg, 7);
  assert.equal(snapshot.recentSessions[0].exercises[0].maxReps, 10);
});

test("AI 운동 스냅샷은 전송 기록을 최근 28건으로 제한한다", () => {
  const stores = emptyStores();
  for (let day = 1; day <= 31; day += 1) stores.workouts[`2026-07-${String(day).padStart(2, "0")}`] = true;
  assert.equal(buildFitnessAiSnapshot(stores).recentSessions.length, 28);
});
