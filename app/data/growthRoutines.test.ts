import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GROWTH_ROUTINES,
  getGrowthLegacySessionCloudId,
  getGrowthRoutineCloudId,
  getGrowthRoutinesStorageKey,
  includesRetiredGrowthContent,
  isRetiredGrowthRoutine,
  normalizeGrowthRoutines,
  parseGrowthRoutines,
  toggleGrowthRoutineDate,
} from "./growthRoutines.ts";

test("저장값이 없거나 손상되면 간단한 기본 루틴으로 복구한다", () => {
  assert.deepEqual(parseGrowthRoutines(null), DEFAULT_GROWTH_ROUTINES);
  assert.deepEqual(parseGrowthRoutines("not-json"), DEFAULT_GROWTH_ROUTINES);
});

test("사용자 루틴의 중복과 잘못된 값을 안전하게 정리한다", () => {
  const result = normalizeGrowthRoutines([
    { id: "one", category: "typing", title: " 타자 연습 ", targetMinutes: 1, completedDates: ["2026-09-02", "bad"] },
    { id: "one", category: "custom", title: "중복", targetMinutes: 20 },
    { id: "two", category: "unknown", title: "새 연습", targetMinutes: 999 },
  ]);
  assert.deepEqual(result, [
    { id: "one", category: "typing", title: "타자 연습", targetMinutes: 5, enabled: true, completedDates: ["2026-09-02"] },
    { id: "two", category: "custom", title: "새 연습", targetMinutes: 240, enabled: true, completedDates: [] },
  ]);
});

test("오늘 완료 상태를 다시 누르면 취소할 수 있다", () => {
  const routine = DEFAULT_GROWTH_ROUTINES[0];
  const completed = toggleGrowthRoutineDate(routine, "2026-09-02");
  assert.deepEqual(completed.completedDates, ["2026-09-02"]);
  assert.deepEqual(toggleGrowthRoutineDate(completed, "2026-09-02").completedDates, []);
});

test("계정별 백업과 초기 클라우드 ID를 서로 격리한다", async () => {
  assert.notEqual(getGrowthRoutinesStorageKey("user-a"), getGrowthRoutinesStorageKey("user-b"));
  const routineId = await getGrowthRoutineCloudId("user-a", "typing-default");
  assert.equal(await getGrowthRoutineCloudId("user-a", "typing-default"), routineId);
  assert.notEqual(await getGrowthRoutineCloudId("user-b", "typing-default"), routineId);
  assert.notEqual(await getGrowthLegacySessionCloudId("user-a", routineId, "2026-09-03"), routineId);
});

test("사용 종료된 전용 과정은 기존 데이터를 지우지 않고 화면에서 제외할 수 있다", () => {
  assert.equal(isRetiredGrowthRoutine({ title: "28회 그림 기초 연습" }), true);
  assert.equal(isRetiredGrowthRoutine({ title: "정확도 중심 타자 연습" }), false);
  assert.equal(includesRetiredGrowthContent({ overview: "그림 연습 기록" }), true);
  assert.equal(includesRetiredGrowthContent({ overview: "손글씨 연습 기록" }), false);
});
