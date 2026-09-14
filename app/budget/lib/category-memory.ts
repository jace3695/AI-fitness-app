export const CATEGORY_CHOICES = ['식비', '카페', '교통', '쇼핑', '생활용품', '배달', '문화', '의료', '구독', '통신비', '공과금', '보험', '월세', '대출', '관리비', '취미', '기타'] as const;
export type CategoryRule = { merchant_key: string; category: string; revision: string };
export type CategoryChange = { id: string; category: string | null; field_name: import('./history-edit').ExpenseField | null; field_value: string | number | null; entry_count: number; created_at: string; undone_at: string | null };
export type ExpenseRecord = Record<string, unknown> & { id: string; user_id: string; place: string | null; category: string | null; date: string; amount: number };
export type CategoryRequest = { p_request_id: string; p_rows: { id: string; expected: ExpenseRecord }[]; p_category: string; p_remember: boolean };
export type FieldRequest = { p_request_id: string; p_rows: { id: string; expected: ExpenseRecord }[]; p_field: import('./history-edit').ExpenseField; p_value: string | number };
export type EditRequest = CategoryRequest | FieldRequest;
// Exact merchant matching: spaces/case only. No substring or fuzzy merchant merges.
export const merchantKey = (place: string) => place.replace(/^ +| +$/g, '').replace(/ +/g, ' ').toLowerCase();
export function applyCategoryMemory<T extends { type?: string; place?: string; category?: string }>(items: T[], rules: CategoryRule[]) {
  const byMerchant = new Map(rules.map(rule => [rule.merchant_key, rule.category]));
  return items.map(item => {
    const category = (item.type || 'expense') === 'expense' ? byMerchant.get(merchantKey(item.place || '')) : undefined;
    return category ? { ...item, category, categorySource: '기억한 분류' } : item;
  });
}
export const pendingCategoryKey = (userId: string) => `yeoni-budget-pending-category:${userId}`;
