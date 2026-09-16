import type { ExpenseRecord, CategoryChange } from '../app/budget/lib/category-memory.ts';

export type BudgetCommandProposal = {
  domain: 'budget'; operation: 'update'; requestId: string;
  expected: ExpenseRecord; amount: number; expiresAt: string;
};
export type BudgetCommandReceipt = CategoryChange;
export type BudgetChangeDetail = {
  transaction_id: string; before_category: string | null; before_value: string | number | null;
  place: string | null; date: string | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validAmount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export function isBudgetCommandProposal(value: unknown): value is BudgetCommandProposal {
  if (!value || typeof value !== 'object') return false;
  const p = value as BudgetCommandProposal;
  return p.domain === 'budget' && p.operation === 'update' && typeof p.requestId === 'string' && uuid.test(p.requestId)
    && validAmount(p.amount) && typeof p.expiresAt === 'string' && Number.isFinite(Date.parse(p.expiresAt))
    && Boolean(p.expected && typeof p.expected === 'object' && typeof p.expected.id === 'string' && uuid.test(p.expected.id)
      && typeof p.expected.user_id === 'string' && uuid.test(p.expected.user_id) && validAmount(p.expected.amount)
      && typeof p.expected.place === 'string' && typeof p.expected.date === 'string');
}
export function isBudgetEditIntent(message: string) {
  return /^(가계부\s|(?:오늘|어제|그제|20\d{2}-\d{2}-\d{2})\s)/.test(message)
    && /지출/.test(message) && /(수정|변경)/.test(message) && !/^(오늘|어제|그제)\s*할\s*일/.test(message);
}
export const BUDGET_COMMAND_EXAMPLE = '가계부 오늘 편의점 지출 금액을 5,000원으로 수정해줘';
export function parseBudgetAmountCommand(message: string, today: string) {
  const match = message.trim().match(/^(?:가계부\s+)?(오늘|어제|그제|20\d{2}-\d{2}-\d{2})\s+(.{1,200}?)\s+지출(?:\s*금액)?(?:을|를)?\s+([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)\s*원(?:으)?로\s*(?:수정|변경)(?:해\s*줘|해주세요|해요)?[.!]?$/);
  if (!match) throw new Error(`날짜·사용처·새 금액을 정확히 말씀해 주세요. 예: ‘${BUDGET_COMMAND_EXAMPLE}’. 날짜는 오늘·어제·그제 또는 YYYY-MM-DD로 입력합니다.`);
  const [, when, rawPlace, rawAmount] = match;
  let date = when;
  if (['오늘', '어제', '그제'].includes(when)) {
    const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ['오늘', '어제', '그제'].indexOf(when));
    date = d.toISOString().slice(0, 10);
  }
  if (!Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('실제로 있는 지출 날짜를 입력해 주세요.');
  const amount = Number(rawAmount.replaceAll(',', ''));
  if (!validAmount(amount)) throw new Error('새 금액은 0보다 큰 안전한 정수로 입력해 주세요.');
  const place = rawPlace.trim();
  if (!place) throw new Error('가계부에 저장된 사용처 이름을 입력해 주세요.');
  return { date, place, amount };
}

// Match a prior receipt before returning it from the read-only retry path.
export function matchesBudgetReceipt(proposal: BudgetCommandProposal, receipt: BudgetCommandReceipt, details: BudgetChangeDetail[]) {
  return receipt.id === proposal.requestId && receipt.field_name === 'amount' && receipt.field_value === proposal.amount
    && receipt.entry_count === 1 && details.length === 1 && details[0].transaction_id === proposal.expected.id
    && details[0].before_value === proposal.expected.amount;
}
