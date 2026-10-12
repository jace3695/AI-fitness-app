import type { Metric, MoneyKind, Period, Reason, Snapshot, WindowName } from './contracts.ts';
import { dateInPeriod, periodsComparable } from './dates.ts';
import { CURRENCY_DECIMALS, sumMinor } from './money.ts';
import { blocked, compareText, metric, sourceReasons } from './quality.ts';

export function compareRecordedTotals(current: Metric, previous: Metric): Metric {
  const reasons: Reason[] = [...current.quality.reasons, ...previous.quality.reasons];
  const comparable = periodsComparable(current.period, previous.period) && current.unit === previous.unit;
  if (!comparable) reasons.push('period_mismatch');
  if (current.value === null || previous.value === null) reasons.push('missing_baseline');
  if (previous.value === 0) reasons.push('zero_baseline');
  const known = comparable && current.value !== null && previous.value !== null && previous.value !== 0 && !blocked(reasons);
  return { ...current, state: known ? 'known' : 'unknown', value: known ? (current.value! - previous.value!) / previous.value! * 100 : null, unit: 'percent_change_in_recorded_total', sampleCount: current.sampleCount + previous.sampleCount, denominator: previous.value, evidence: [...current.evidence, ...previous.evidence], quality: { status: reasons.includes('stale_revision') ? 'stale' : blocked(reasons) ? 'blocked' : reasons.length ? 'limited' : 'valid', reasons: [...new Set(reasons)].sort() } };
}
export function aggregateBudget(snapshot: Snapshot) {
  const source = snapshot.sources.spending;
  const currencies = [...new Set(source.records.map(row => row.currency))].sort(compareText);
  const byCurrency = currencies.map(currency => {
    const aggregate = (period: Period) => {
      const reasons = sourceReasons(source, period), valid = !blocked(reasons);
      const rows = source.records.filter(row => row.currency === currency && dateInPeriod(row.date, period));
      const total = (kind: MoneyKind): Metric => {
        const selected = rows.filter(row => row.kind === kind);
        // An expense collection is not evidence that income/savings/refunds or
        // scheduled payments were supplied. Those amounts require explicit rows.
        const known = valid && (kind === 'expense' || selected.length > 0);
        return metric(known ? sumMinor(selected.map(row => row.minor)) : null, `${currency}_minor`, period, selected, null, [...reasons, ...(!selected.length ? ['no_records' as const] : [])]);
      };
      const expenses = rows.filter(row => row.kind === 'expense');
      const categories = [...new Set(expenses.map(row => row.category))].sort((a, b) => compareText(a ?? '', b ?? '')).map(category => {
        const selected = expenses.filter(row => row.category === category);
        return { category, total: metric(valid ? sumMinor(selected.map(row => row.minor)) : null, `${currency}_minor`, period, selected, null, reasons) };
      });
      return { expenses: total('expense'), refunds: total('refund'), income: total('income'), savings: total('savings'), scheduled: total('scheduled'), categories };
    };
    const periods = Object.fromEntries(Object.entries(snapshot.windows).map(([name, period]) => [name, aggregate(period)])) as Record<WindowName, ReturnType<typeof aggregate>>;
    const month = snapshot.windows.month, monthReasons = sourceReasons(source, month);
    const limits = source.records.filter(row => row.kind === 'monthly_budget' && row.currency === currency && row.date === month.startDate);
    const limit = limits[0]?.minor ?? null;
    const budgetReasons: Reason[] = [...monthReasons, ...(limit === null ? ['budget_unset' as const] : limit === 0 ? ['zero_budget' as const] : [])];
    const configuredMonthlyBudget = metric(blocked(monthReasons) ? null : limit, `${currency}_minor`, month, limits, null, budgetReasons);
    const monthlyBudgetUsage = metric(!blocked(monthReasons) && limit !== null && limit > 0 && periods.month.expenses.value !== null ? periods.month.expenses.value / limit * 100 : null, 'percent_of_configured_monthly_budget', month, [...limits, ...source.records.filter(row => row.currency === currency && row.kind === 'expense' && dateInPeriod(row.date, month))], limit, budgetReasons);
    const completed7Change = compareRecordedTotals(periods.completed7.expenses, periods.previousCompleted7.expenses);
    const categoryKeys = [...new Set([...periods.completed7.categories, ...periods.previousCompleted7.categories].map(row => row.category))].sort((a, b) => compareText(a ?? '', b ?? ''));
    const categoryCompleted7Changes = categoryKeys.map(category => {
      const forPeriod = (name: 'completed7' | 'previousCompleted7') => periods[name].categories.find(row => row.category === category)?.total
        ?? metric(blocked(sourceReasons(source, snapshot.windows[name])) ? null : 0, `${currency}_minor`, snapshot.windows[name], [], null, [...sourceReasons(source, snapshot.windows[name]), 'no_records']);
      return { category, change: compareRecordedTotals(forPeriod('completed7'), forPeriod('previousCompleted7')) };
    });
    return { currency, decimals: CURRENCY_DECIMALS[currency], periods, configuredMonthlyBudget, monthlyBudgetUsage, completed7Change, categoryCompleted7Changes };
  });
  return { byCurrency, quality: source.quality, emptyCurrencySet: currencies.length === 0, basis: 'recorded_transactions_only' as const, nettingPolicy: 'refunds_income_savings_and_scheduled_are_separate' as const };
}
