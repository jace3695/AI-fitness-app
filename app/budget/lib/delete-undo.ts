export type BudgetRecordKind = "expense" | "income" | "saving";

export type BudgetRecord = Record<string, unknown> & {
  id: string;
  user_id: string;
};

export interface BudgetDeleteUndo {
  kind: BudgetRecordKind;
  record: BudgetRecord;
}

export const BUDGET_RECORD_TABLE: Record<BudgetRecordKind, string> = {
  expense: "budget_transactions",
  income: "budget_income",
  saving: "budget_savings",
};

export const BUDGET_RECORD_LABEL: Record<BudgetRecordKind, string> = {
  expense: "지출",
  income: "수입",
  saving: "저축",
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]),
  );
}

export function isSameBudgetRecord(
  expected: BudgetRecord,
  received: BudgetRecord | null,
) {
  return Boolean(
    received && JSON.stringify(stable(expected)) === JSON.stringify(stable(received)),
  );
}

export function buildBudgetDeleteNotice(kind: BudgetRecordKind) {
  return `${BUDGET_RECORD_LABEL[kind]} 내역을 삭제했어요. 필요하면 되돌릴 수 있어요.`;
}
