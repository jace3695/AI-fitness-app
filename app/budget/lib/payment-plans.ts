import { merchantKey } from './category-memory.ts';
import { parseWholeAmount } from './history-edit.ts';

export type PaymentPlanValue = { name: string; amount: number; due_day: number; start_month: string; is_subscription: boolean; last_used_on: string | null; enabled: boolean };
export type PaymentPlan = PaymentPlanValue & { id: string; user_id: string; merchant_key: string; revision: string; request_hash: string; updated_at: string };
export type PaymentPlanRequest = { p_owner: string; p_id: string; p_request_id: string; p_expected: PaymentPlan | null; p_value: PaymentPlanValue | null };
export const pendingPaymentPlanKey = (owner: string) => `yeoni-budget-pending-plan:${owner}`;

export function validCalendarDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) && !value.startsWith('0000') && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function monthDueDate(month: string, day: number) {
  if (!validCalendarDate(`${month}-01`) || !Number.isInteger(day) || day < 1 || day > 31) throw new Error('결제 예정일을 확인해 주세요.');
  const end = new Date(`${month}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return `${month}-${String(Math.min(day, end.getUTCDate())).padStart(2, '0')}`;
}
export function parsePaymentPlan(draft: { name: string; amount: string; day: string; month: string; subscription: boolean; lastUsed: string; enabled: boolean }, today: string): PaymentPlanValue {
  const name = draft.name.replace(/^ +| +$/g, ''), amount = parseWholeAmount(draft.amount);
  if (!name.trim() || [...name].length > 200) throw new Error('내역에 쓰는 장소 이름을 1~200자로 입력해 주세요.');
  if (amount === null || amount <= 0) throw new Error('예정 금액을 1 이상의 정수로 입력해 주세요.');
  if (!/^[0-9]+$/.test(draft.day)) throw new Error('매월 결제일을 1~31일로 입력해 주세요.');
  monthDueDate(draft.month, Number(draft.day));
  if (draft.subscription && draft.lastUsed && (!validCalendarDate(draft.lastUsed) || draft.lastUsed > today)) throw new Error('마지막 사용일은 오늘까지의 실제 날짜로 입력해 주세요.');
  return { name, amount, due_day: Number(draft.day), start_month: `${draft.month}-01`, is_subscription: draft.subscription, last_used_on: draft.subscription && draft.lastUsed ? draft.lastUsed : null, enabled: draft.enabled };
}

type Expense = { date: string; amount: number; place?: string | null; transaction_type?: unknown };
export function paymentPlanChecks(plans: PaymentPlan[], records: Expense[], month: string, today: string) {
  if (!validCalendarDate(today)) throw new Error('오늘 날짜를 확인해 주세요.');
  const monthly = new Map<string, Expense[]>();
  for (const row of records) if (row.date.startsWith(month) && row.transaction_type !== '충전카드 충전') {
    const key = merchantKey(row.place || ''), group = monthly.get(key) || [];
    group.push(row); monthly.set(key, group);
  }
  return plans.filter(plan => plan.enabled && plan.start_month.slice(0, 7) <= month).map(plan => {
    const due = monthDueDate(month, plan.due_day);
    const matches = monthly.get(plan.merchant_key) || [];
    const recorded = matches.filter(row => row.date <= today);
    const total = matches.reduce((sum, row) => sum + Number(row.amount), 0);
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(plan.amount) || matches.some(row => !validCalendarDate(row.date) || !Number.isSafeInteger(Number(row.amount)) || Number(row.amount) <= 0)) throw new Error('예정액과 같은 이름의 지출을 확인해 주세요.');
    const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    const unusedDays = plan.is_subscription && plan.last_used_on && validCalendarDate(plan.last_used_on) && plan.last_used_on <= today
      ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${plan.last_used_on}T00:00:00Z`)) / 86400000) : null;
    return { plan, due, days, count: matches.length, recordedCount: recorded.length, recordedAmount: total,
      reserved: Math.max(plan.amount - total, 0), unusedDays,
      needsReview: recorded.length === 0 && days <= 3 };
  }).sort((a, b) => a.due.localeCompare(b.due) || a.plan.name.localeCompare(b.plan.name));
}
