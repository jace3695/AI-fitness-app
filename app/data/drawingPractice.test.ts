import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAWING_DAILY_MINUTES,
  DRAWING_LESSONS,
  DRAWING_PROGRAM_ID,
  drawingLessonDayFromMetrics,
  drawingScoresFromMetrics,
  getDrawingScoreAdvice,
  getDrawingRoutineId,
  getDrawingSessionId,
  getDrawingLesson,
  getNextDrawingDay,
} from "./drawingPractice.ts";

test("28회 과정은 빠짐없는 순서와 고유 ID를 가진다", () => {
  assert.equal(DRAWING_LESSONS.length, 28);
  assert.deepEqual(DRAWING_LESSONS.map((lesson) => lesson.day), Array.from({ length: 28 }, (_, index) => index + 1));
  assert.equal(new Set(DRAWING_LESSONS.map((lesson) => lesson.id)).size, 28);
  assert.deepEqual(DRAWING_LESSONS.filter((lesson) => lesson.checkpoint).map((lesson) => lesson.day), [1, 7, 14, 21, 27, 28]);
  assert.notEqual(DRAWING_LESSONS[20].guide, DRAWING_LESSONS[26].guide);
});

test("모든 수업은 18분 다섯 단계와 구체적인 자기 확인을 제공한다", () => {
  for (const lesson of DRAWING_LESSONS) {
    assert.equal(lesson.steps.length, 5);
    assert.equal(lesson.steps.reduce((sum, step) => sum + step.minutes, 0), DRAWING_DAILY_MINUTES);
    assert.equal(lesson.checks.length, 3);
    assert.ok(lesson.repetitions.length >= 8);
    assert.ok(lesson.steps.every((step) => step.instruction.length >= 20));
    assert.ok(lesson.checks.every((check) => check.length >= 8));
  }
});

test("수업 안내 시간은 고정된 18분 단계와 충돌하지 않는다", () => {
  const curriculum = JSON.stringify(DRAWING_LESSONS);
  for (const impossibleDuration of ["10분 동안", "12분 동안", "15분 동안", "15분 제한", "90초 구도안 6개"]) {
    assert.equal(curriculum.includes(impossibleDuration), false);
  }
});

test("초보자가 종이에서 판단할 정량 기준을 유지한다", () => {
  const curriculum = JSON.stringify(DRAWING_LESSONS);
  for (const threshold of ["반경 3mm", "폭 4mm", "3mm 이하", "10° 이하", "15%", "12%", "반경 5mm", "5° 이하"]) {
    assert.equal(curriculum.includes(threshold), true);
  }
});

test("초보 기초 과정에는 모호했던 창작 과제를 다시 넣지 않는다", () => {
  const curriculum = JSON.stringify(DRAWING_LESSONS);
  for (const phrase of ["움직임 만들기", "캐릭터 5개", "그림을 내 것으로", "내 스타일 만들기"]) {
    assert.equal(curriculum.includes(phrase), false);
  }
});

test("완료 기록에서 다음 첫 미완료 수업을 선택한다", () => {
  assert.equal(getNextDrawingDay([]), 1);
  assert.equal(getNextDrawingDay([1, 2, 4]), 3);
  assert.equal(getNextDrawingDay(Array.from({ length: 28 }, (_, index) => index + 1)), 28);
  assert.equal(getDrawingLesson(0).day, 1);
  assert.equal(getDrawingLesson(99).day, 28);
});

test("현재 과정의 올바른 완료 지표만 진도로 인정한다", () => {
  assert.equal(drawingLessonDayFromMetrics({ programId: DRAWING_PROGRAM_ID, lessonDay: 12 }), 12);
  assert.equal(drawingLessonDayFromMetrics({ programId: "old", lessonDay: 12 }), null);
  assert.equal(drawingLessonDayFromMetrics({ programId: DRAWING_PROGRAM_ID, lessonDay: 0 }), null);
  assert.equal(drawingLessonDayFromMetrics({ programId: DRAWING_PROGRAM_ID, lessonDay: 29 }), null);
  assert.equal(drawingLessonDayFromMetrics(null), null);
});

test("체크포인트 점수와 보충 규칙을 안전하게 복원한다", () => {
  assert.deepEqual(drawingScoresFromMetrics({ scores: [0, 1, 2, 1, 2] }), [0, 1, 2, 1, 2]);
  assert.equal(drawingScoresFromMetrics({ scores: [0, 1, 3, 1, 2] }), null);
  assert.equal(drawingScoresFromMetrics({ scores: [0, 1] }), null);
  assert.deepEqual(getDrawingScoreAdvice([0, 0, 0, 0, 0], null), { total: 0, supplementMinutes: 0, label: "비교용 출발점 저장" });
  assert.equal(getDrawingScoreAdvice([1, 1, 1, 1, 1], 5).supplementMinutes, 0);
  assert.equal(getDrawingScoreAdvice([1, 1, 1, 1, 0], 6).supplementMinutes, 3);
  assert.equal(getDrawingScoreAdvice([1, 1, 0, 0, 0], 7).supplementMinutes, 5);
  assert.equal(getDrawingScoreAdvice([2, 2, 1, 1, 1], 8, 4).supplementMinutes, 0);
  assert.equal(getDrawingScoreAdvice([2, 2, 1, 1, 1], 8, 6).supplementMinutes, 3);
});

test("사용자·회차별 완료 ID는 다시 만들어도 같고 다른 회차와 겹치지 않는다", async () => {
  const first = await getDrawingSessionId("user-a", "drawing-foundations-day-01");
  assert.equal(await getDrawingSessionId("user-a", "drawing-foundations-day-01"), first);
  assert.notEqual(await getDrawingSessionId("user-a", "drawing-foundations-day-02"), first);
  assert.notEqual(await getDrawingSessionId("user-b", "drawing-foundations-day-01"), first);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(await getDrawingRoutineId("user-a"), await getDrawingRoutineId("user-a"));
  assert.notEqual(await getDrawingRoutineId("user-a"), first);
});
