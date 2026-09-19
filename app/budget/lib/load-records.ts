import type { SupabaseClient } from '@supabase/supabase-js';

// Never let PostgREST's default row cap turn a partial history into a total.
export async function loadBudgetRows(client: SupabaseClient, table: 'budget_transactions' | 'budget_income' | 'budget_savings', userId: string) {
  const rows: Record<string, unknown>[] = [];
  let expectedCount: number | null = null;
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error, count } = await client.from(table).select('*', { count: 'exact' })
      .eq('user_id', userId).order('date', { ascending: false }).order('id').range(offset, offset + 499);
    if (error) throw error;
    if (count === null || count > 10000 || (expectedCount !== null && expectedCount !== count)) throw new Error('내역이 바뀌었거나 한 번에 읽을 수 있는 범위를 넘었어요. 다시 불러와 주세요.');
    expectedCount = count;
    rows.push(...(data || []));
    if (rows.length === count) {
      if (new Set(rows.map(row => row.id)).size !== count) throw new Error('조회 중 내역이 바뀌었어요. 다시 불러와 주세요.');
      return rows;
    }
    if (!data?.length) break;
  }
  throw new Error('전체 내역을 확인하지 못했어요. 다시 불러와 주세요.');
}
