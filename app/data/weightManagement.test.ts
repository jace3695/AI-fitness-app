import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWeightGoal } from "./recordStorage.ts";
import {
  getRollingWeightAverages,
  getWeightManagementSummary,
} from "./weightManagement.ts";

const record = (weight: number) => ({
  weight,
  recordedAt: "2026-08-01T00:00:00.000Z",
});

test("7일 평균은 각 기록일을 포함한 최근 7일의 측정값만 사용한다", () => {
  const averages = getRollingWeightAverages({
    "2026-08-01": record(83),
    "2026-08-02": record(82),
    "2026-08-08": record(81),
  });
  assert.deepEqual(averages, [
    { dateKey: "2026-08-01", value: 83, sampleCount: 1 },
    { dateKey: "2026-08-02", value: 82.5, sampleCount: 2 },
    { dateKey: "2026-08-08", value: 81.5, sampleCount: 2 },
  ]);
});

test("현재·이전 7일에 두 번 이상 기록되면 평균 변화와 목표 진행률을 계산한다", () => {
  const summary = getWeightManagementSummary(
    {
      "2026-08-01": record(83),
      "2026-08-02": record(82),
      "2026-08-08": record(81),
      "2026-08-09": record(80),
    },
    {},
    { minKg: 65, maxKg: 67 },
  );
  assert.equal(summary.previousSevenDayAverage, 82.5);
  assert.equal(summary.sevenDayAverage, 80.5);
  assert.equal(summary.weeklyChange, -2);
  assert.equal(summary.weeklyDirection, "down");
  assert.equal(summary.goal.remainingKg, 13.5);
  assert.equal(Math.round(summary.goal.progressPercent ?? -1), 16);
});

test("체지방이 줄고 골격근이 유지되면 리컴포지션을 좋은 방향으로 판정한다", () => {
  const summary = getWeightManagementSummary(
    { "2026-08-09": record(80) },
    {
      "2026-08-01": { bodyFatPercent: 32, skeletalMuscleMass: 29 },
      "2026-08-08": { bodyFatPercent: 31.2, skeletalMuscleMass: 28.9 },
    },
  );
  assert.equal(summary.bodyFat.direction, "down");
  assert.equal(summary.skeletalMuscle.direction, "stable");
  assert.equal(summary.assessment.tone, "positive");
});

test("인바디가 한 번뿐이면 변화 방향을 단정하지 않는다", () => {
  const summary = getWeightManagementSummary(
    { "2026-08-09": record(80) },
    { "2026-08-08": { bodyFatPercent: 31.2, skeletalMuscleMass: 28.9 } },
  );
  assert.equal(summary.assessment.tone, "insufficient");
  assert.match(summary.assessment.description, /2회 이상/);
});

test("기준일 이후의 미래 기록은 현재 추세와 인바디 판정에서 제외한다", () => {
  const summary = getWeightManagementSummary(
    {
      "2026-08-08": record(81),
      "2026-09-01": record(70),
    },
    {
      "2026-08-01": { bodyFatPercent: 32, skeletalMuscleMass: 29 },
      "2026-08-08": { bodyFatPercent: 31, skeletalMuscleMass: 29 },
      "2026-09-01": { bodyFatPercent: 20, skeletalMuscleMass: 35 },
    },
    { minKg: 65, maxKg: 67 },
    "2026-08-10",
  );
  assert.equal(summary.latest?.value, 81);
  assert.equal(summary.bodyFat.latest, 31);
  assert.equal(summary.skeletalMuscle.latest, 29);
});

test("목표 범위에 들어오면 남은 체중은 0이고 진행률은 100%다", () => {
  const summary = getWeightManagementSummary(
    {
      "2026-08-01": record(83),
      "2026-08-08": record(66),
    },
    {},
    { minKg: 65, maxKg: 67 },
  );
  assert.equal(summary.goal.state, "within");
  assert.equal(summary.goal.remainingKg, 0);
  assert.equal(summary.goal.progressPercent, 100);
});

test("골격근 감소가 기준을 넘으면 좋은 체중 변화만으로 성공 판정을 하지 않는다", () => {
  const summary = getWeightManagementSummary(
    { "2026-08-08": record(80) },
    {
      "2026-08-01": { bodyFatPercent: 32, skeletalMuscleMass: 29 },
      "2026-08-08": { bodyFatPercent: 31, skeletalMuscleMass: 28.5 },
    },
  );
  assert.equal(summary.skeletalMuscle.direction, "down");
  assert.equal(summary.assessment.tone, "caution");
});

test("목표 범위는 유효한 소수만 보존하고 잘못된 값은 기본값으로 복구한다", () => {
  assert.deepEqual(normalizeWeightGoal({ minKg: 64.04, maxKg: 66.06 }), {
    minKg: 64,
    maxKg: 66.1,
  });
  assert.deepEqual(normalizeWeightGoal({ minKg: 70, maxKg: 65 }), {
    minKg: 65,
    maxKg: 67,
  });
});
