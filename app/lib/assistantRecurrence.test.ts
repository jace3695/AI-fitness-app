import assert from "node:assert/strict";
import test from "node:test";
import { nextRecurringDueAt, parseRecurrence, recurrenceLabel } from "./assistantRecurrence.ts";

test("한국어 반복 표현을 반복 규칙으로 변환한다", () => {
  assert.equal(parseRecurrence("매일 물 마시기 추가해줘"), "daily");
  assert.equal(parseRecurrence("매주 보고서 작성"), "weekly");
  assert.equal(parseRecurrence("매달 카드값 확인"), "monthly");
  assert.equal(parseRecurrence("오늘 우유 사기"), "none");
  assert.equal(recurrenceLabel("weekly"), "매주");
});

test("반복 완료 시 다음 마감일을 계산한다", () => {
  assert.equal(nextRecurringDueAt("2026-08-26T23:59:00+09:00", "daily", "2026-08-26"), "2026-08-27T23:59:00+09:00");
  assert.equal(nextRecurringDueAt("2026-08-26T23:59:00+09:00", "weekly", "2026-08-26"), "2026-09-02T23:59:00+09:00");
  assert.equal(nextRecurringDueAt("2026-08-31T23:59:00+09:00", "monthly", "2026-08-31"), "2026-09-30T23:59:00+09:00");
  assert.equal(nextRecurringDueAt(null, "none", "2026-08-26"), null);
});
