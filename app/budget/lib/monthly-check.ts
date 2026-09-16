import { merchantKey } from './category-memory.ts';
import { paymentPlanChecks, validCalendarDate, type PaymentPlan } from './payment-plans.ts';

type Expense = { id: string; date: string; amount: number; place?: string | null; category?: string | null; payment?: unknown; transaction_type?: unknown };
const FIXED = new Set(['구독', '통신비', '공과금', '보험', '월세', '대출', '관리비']);
const validDate = validCalendarDate;

export function buildMonthlyCheck(records: Expense[], month: string, today: string, budget: number | null, plans: PaymentPlan[] = []) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !validDate(today)) throw new Error('조회할 날짜를 확인해 주세요.');
  if (records.some(row => !validDate(row.date) || !Number.isSafeInteger(Number(row.amount)) || Number(row.amount) <= 0)) throw new Error('금액이나 날짜가 올바르지 않은 기록이 있어요. 내역을 확인해 주세요.');
  const [year, monthNumber] = month.split('-').map(Number);
  const endDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const previous = new Date(Date.UTC(year, monthNumber - 2, 1)).toISOString().slice(0, 7);
  const activeMonth = today.slice(0, 7) === month;
  const elapsedDay = activeMonth ? Number(today.slice(8)) : endDay;
  const cutoff = month >= today.slice(0, 7) ? today : `${month}-${endDay}`;
  const rows = records.filter(row => row.transaction_type !== '충전카드 충전').map(row => ({ ...row, amount: Number(row.amount) }));
  if (!Number.isSafeInteger(rows.reduce((sum, row) => sum + row.amount, 0))) throw new Error('전체 금액을 정확히 계산할 수 없어요.');
  const current = rows.filter(row => row.date.startsWith(month));
  const observed = current.filter(row => row.date <= cutoff);
  const previousRows = rows.filter(row => row.date.startsWith(previous));
  const spent = current.reduce((sum, row) => sum + row.amount, 0);
  if (!Number.isSafeInteger(spent)) throw new Error('월 합계를 정확히 계산할 수 없어요.');

  const groups = new Map<string, Expense[]>();
  for (const row of current) {
    const merchant = merchantKey(row.place || '');
    if (!merchant) continue;
    const key = JSON.stringify([row.date, merchant, row.amount, row.payment || null, row.transaction_type || null]);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const duplicates = [...groups.values()].filter(group => group.length > 1).map(group => ({ ids: group.map(row => row.id), place: group[0].place!, date: group[0].date, amount: group[0].amount, count: group.length }));
  const fixedKeys = new Map<string, { name: string; category: string }>();
  // Explicit current settings replace inference only for the current month.
  // Historical reports keep their recorded-data basis, not today's settings.
  const planned = activeMonth ? paymentPlanChecks(plans, rows, month, today) : [];
  const configuredKeys = new Set(activeMonth ? plans.filter(plan => plan.start_month.slice(0, 7) <= month).map(plan => plan.merchant_key) : []);
  for (const row of [...previousRows, ...current]) if (FIXED.has(row.category || '') && merchantKey(row.place || '')) fixedKeys.set(merchantKey(row.place || ''), { name: row.place!, category: row.category! });
  const fixed = [...fixedKeys].map(([key, meta]) => {
    const now = current.filter(row => merchantKey(row.place || '') === key);
    const paid = now.filter(row => row.date <= cutoff);
    const prior = previousRows.filter(row => merchantKey(row.place || '') === key);
    return { ...meta, currentCount: now.length, recordedCount: paid.length, previousCount: prior.length,
      currentAmount: now.reduce((sum, row) => sum + row.amount, 0), previousAmount: prior.reduce((sum, row) => sum + row.amount, 0),
      change: now.length === 1 && prior.length === 1 ? now[0].amount - prior[0].amount : null,
      estimatedUnrecorded: !configuredKeys.has(key) && now.length === 0 && prior.length === 1 ? prior[0].amount : 0 };
  });
  const plannedReserved = planned.reduce((sum, item) => sum + item.reserved, 0);
  const reserved = fixed.reduce((sum, row) => sum + row.estimatedUnrecorded, 0) + plannedReserved;
  if (!Number.isSafeInteger(spent + reserved)) throw new Error('예정액과 지출 합계를 정확히 계산할 수 없어요.');
  const remainingDays = activeMonth ? endDay - elapsedDay + 1 : null;
  const usableBudget = budget !== null && Number.isSafeInteger(budget) && budget > 0 ? budget : null;
  const remaining = usableBudget === null ? null : usableBudget - spent - reserved;
  const daily = remainingDays && remaining !== null ? Math.floor(Math.max(remaining, 0) / remainingDays) : null;
  const comparisonDay = Math.min(elapsedDay, new Date(Date.UTC(year, monthNumber - 1, 0)).getUTCDate());
  const previousComparable = previousRows.filter(row => Number(row.date.slice(8)) <= comparisonDay);
  const categories = [...new Set(observed.map(row => row.category || '미분류'))].map(category => {
    const now = observed.filter(row => (row.category || '미분류') === category);
    const prior = previousComparable.filter(row => (row.category || '미분류') === category);
    const currentAmount = now.reduce((sum, row) => sum + row.amount, 0);
    const previousAmount = prior.reduce((sum, row) => sum + row.amount, 0);
    const byMerchant = new Map<string, { name: string; currentCount: number; previousCount: number; currentAmount: number; previousAmount: number }>();
    for (const [period, entries] of [['previous', prior], ['current', now]] as const) for (const row of entries) {
      const key = merchantKey(row.place || '');
      const group = byMerchant.get(key) || { name: row.place || '장소 미입력', currentCount: 0, previousCount: 0, currentAmount: 0, previousAmount: 0 };
      if (period === 'current') { group.name = row.place || '장소 미입력'; group.currentCount++; group.currentAmount += row.amount; }
      else { group.previousCount++; group.previousAmount += row.amount; }
      byMerchant.set(key, group);
    }
    const merchants = [...byMerchant.values()].map(item => ({ ...item, increase: item.currentAmount - item.previousAmount }))
      .filter(item => item.increase > 0).sort((a, b) => b.increase - a.increase).slice(0, 2);
    return { category, currentAmount, previousAmount, increase: currentAmount - previousAmount,
      currentCount: now.length, previousCount: prior.length,
      currentAverage: Math.floor(currentAmount / now.length), previousAverage: prior.length ? Math.floor(previousAmount / prior.length) : null, merchants };
  }).sort((left, right) => right.increase - left.increase);
  return { spent, duplicates, fixed, reserved, plannedReserved, remaining, remainingDays, daily, comparisonDay, previous, currentCount: observed.length, previousCount: previousComparable.length, increases: categories.filter(row => row.increase > 0).slice(0, 2) };
}
