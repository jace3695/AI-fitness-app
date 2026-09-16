export type BudgetSaveItem = {
  type: string; date: string; amount: number; place: string;
  memo?: string; category?: string; payment?: string; transaction_type?: string;
};
export type PendingBudgetSave = { id: string; items: BudgetSaveItem[] };
export const pendingBudgetSaveKey = (userId: string) => `yeoni-budget-pending-save:${userId}`;

export function readPendingBudgetSave(storage: Pick<Storage, 'getItem'>, userId: string): PendingBudgetSave | null {
  const raw = storage.getItem(pendingBudgetSaveKey(userId));
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingBudgetSave;
  if (!value.id || !Array.isArray(value.items) || !value.items.length) throw new Error('확인 중인 저장 내용을 읽지 못했습니다.');
  return value;
}
