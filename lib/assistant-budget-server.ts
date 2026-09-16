import type { SupabaseClient } from '@supabase/supabase-js';
import { isBudgetCommandProposal, matchesBudgetReceipt, type BudgetCommandProposal, type BudgetCommandReceipt, type BudgetChangeDetail } from './assistant-budget-command.ts';

export const budgetHistoryFields = 'id,category,field_name,field_value,entry_count,created_at,undone_at';
export async function budgetCurrency(db: SupabaseClient, owner: string) {
  const { data, error } = await db.from('budget_user_settings').select('currency').eq('user_id', owner).maybeSingle();
  if (error) throw new Error('가계부 통화 설정을 확인하지 못했습니다.');
  return data?.currency || 'KRW';
}
export async function budgetReceipt(db: SupabaseClient, owner: string, id: string) {
  const { data, error } = await db.from('budget_category_changes').select(budgetHistoryFields).eq('user_id', owner).eq('id', id).maybeSingle();
  if (error) throw new Error('가계부 실행 이력을 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.');
  return data as BudgetCommandReceipt | null;
}
export async function budgetDetails(db: SupabaseClient, owner: string, id: string): Promise<BudgetChangeDetail[]> {
  const { data, error } = await db.from('budget_category_change_items').select('transaction_id,before_category,before_value').eq('user_id', owner).eq('change_id', id).order('transaction_id').limit(100);
  if (error) throw new Error('가계부 변경 전후를 불러오지 못했습니다.');
  if (!data?.length) return [];
  const records = await db.from('budget_transactions').select('id,place,date').eq('user_id', owner).in('id', data.map(d => d.transaction_id));
  if (records.error) throw new Error('현재 사용처 정보를 불러오지 못했습니다.');
  return data.map(d => { const r = records.data?.find(row => row.id === d.transaction_id); return { ...d, place: r?.place ?? null, date: r?.date ?? null }; });
}
export async function proposeBudgetAmount(db: SupabaseClient, owner: string, target: { date: string; place: string; amount: number }): Promise<BudgetCommandProposal> {
  if (await budgetCurrency(db, owner) !== 'KRW') throw new Error('현재 금액 수정 명령은 원화 가계부에서 지원합니다. 가계부의 지출 수정 화면을 이용해 주세요.');
  const { data, error } = await db.from('budget_transactions').select('*').eq('user_id', owner).eq('date', target.date).eq('place', target.place).limit(2);
  if (error) throw new Error('수정할 지출을 불러오지 못했습니다.');
  if (!data?.length) throw new Error('날짜와 사용처가 정확히 일치하는 지출을 찾지 못했습니다. 가계부에 저장된 이름을 확인해 주세요.');
  if (data.length !== 1) throw new Error('같은 날짜·사용처의 지출이 여러 건입니다. 가계부 상세 내역에서 수정할 항목을 선택해 주세요.');
  if (data[0].amount === target.amount) throw new Error('이미 같은 금액입니다. 변경하지 않았습니다.');
  const proposal = { domain: 'budget', operation: 'update', requestId: crypto.randomUUID(), expected: data[0], amount: target.amount, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
  if (!isBudgetCommandProposal(proposal)) throw new Error('지출의 원래 금액을 확인하지 못했습니다. 가계부 상세 내역을 확인해 주세요.');
  return proposal;
}
export async function applyBudgetAmount(db: SupabaseClient, owner: string, raw: unknown) {
  if (!isBudgetCommandProposal(raw) || raw.expected.user_id !== owner) throw new Error('본인의 지출 변경 내용을 다시 확인해 주세요.');
  const existing = await budgetReceipt(db, owner, raw.requestId);
  if (existing) {
    const details = await budgetDetails(db, owner, raw.requestId);
    if (!matchesBudgetReceipt(raw, existing, details)) throw new Error('이미 사용한 요청 번호이거나 상세 내역이 삭제됐습니다. 실행 이력을 확인해 주세요.');
    return existing;
  }
  const expires = Date.parse(raw.expiresAt);
  if (expires <= Date.now() || expires > Date.now() + 20 * 60_000) throw new Error('확인 시간이 지났습니다. 지출 명령을 다시 입력해 주세요.');
  if (await budgetCurrency(db, owner) !== 'KRW') throw new Error('가계부 통화 설정이 달라졌습니다. 변경 내용을 다시 확인해 주세요.');
  const { error } = await db.rpc('change_budget_expense_fields', {
    p_request_id: raw.requestId, p_rows: [{ id: raw.expected.id, expected: raw.expected }], p_field: 'amount', p_value: raw.amount,
  });
  if (error) throw new Error(error.code === 'P0001' ? error.message : '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.');
  const receipt = await budgetReceipt(db, owner, raw.requestId);
  if (!receipt) throw new Error('저장 이력을 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.');
  return receipt;
}
