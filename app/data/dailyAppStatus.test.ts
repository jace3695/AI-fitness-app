import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFitnessDailyStatus,
  buildLanguageDailyStatus,
  parseStateObject,
} from "./dailyAppStatus.ts";

test("문자열과 객체 상태를 안전하게 읽는다", () => {
  assert.deepEqual(parseStateObject('{"value":1}'), { value: 1 });
  assert.deepEqual(parseStateObject({ value: 2 }), { value: 2 });
  assert.deepEqual(parseStateObject("not-json"), {});
});

test("일본어 완료 항목을 중복 없이 계산하고 다음 학습으로 연결한다", () => {
  const status = buildLanguageDailyStatus({
    dailyRoutineProgress: JSON.stringify({
      date: "2026-09-02",
      completedIds: ["kana", "kana", "words", "unknown"],
    }),
  }, "2026-09-02");

  assert.equal(status.completed, 2);
  assert.equal(status.total, 5);
  assert.equal(status.nextLabel, "다음 학습: 문장");
  assert.equal(status.nextHref, "/language/sentences");
});

test("다른 날짜의 일본어 완료 기록은 오늘 기록으로 세지 않는다", () => {
  const status = buildLanguageDailyStatus({
    dailyRoutineProgress: { date: "2026-09-01", completedIds: ["kana"] },
  }, "2026-09-02");
  assert.equal(status.completed, 0);
  assert.equal(status.nextHref, "/language/kana");
});

test("운동 계획과 오늘 완료 기록을 기존 상태에서 읽는다", () => {
  const status = buildFitnessDailyStatus({
    "ai-fitness-selected-weekly-workout-plan": "week1-cardio-back",
    "ai-fitness-workout-completed-days": {
      "2026-09-02": { workoutStatus: "partial" },
    },
  }, "2026-09-02", new Date(2026, 8, 2));

  assert.equal(status.synced, true);
  assert.equal(status.completed, true);
  assert.equal(status.isRest, false);
  assert.equal(status.detail, "오늘 운동을 완료했습니다.");
});

test("운동 쉬는 날은 완료 여부와 별개로 회복일을 표시한다", () => {
  const status = buildFitnessDailyStatus({}, "2026-09-06", new Date(2026, 8, 6));
  assert.equal(status.title, "오늘은 회복일");
  assert.equal(status.isRest, true);
  assert.equal(status.completed, false);
});
