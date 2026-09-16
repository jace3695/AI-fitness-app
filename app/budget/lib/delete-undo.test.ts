import assert from "node:assert/strict";
import test from "node:test";
import {
  BUDGET_RECORD_TABLE,
  buildBudgetDeleteNotice,
  isSameBudgetRecord,
  type BudgetRecord,
} from "./delete-undo.ts";

const record: BudgetRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  user_id: "00000000-0000-4000-8000-000000000002",
  amount: 1234,
  date: "2026-09-12",
  place: "P1 합성 지출",
  memo: null,
};

test("삭제한 가계부 행은 JSON 필드 순서와 무관하게 전체 값을 대조한다", () => {
  const reordered = Object.fromEntries(Object.entries(record).reverse()) as BudgetRecord;
  assert.equal(isSameBudgetRecord(record, reordered), true);
  assert.equal(isSameBudgetRecord(record, { ...record, amount: 1235 }), false);
  assert.equal(isSameBudgetRecord(record, null), false);
});

test("가계부 종류별 복원 대상과 안내 문구를 구분한다", () => {
  assert.deepEqual(BUDGET_RECORD_TABLE, {
    expense: "budget_transactions",
    income: "budget_income",
    saving: "budget_savings",
  });
  assert.match(buildBudgetDeleteNotice("saving"), /저축.*되돌릴 수/);
});
