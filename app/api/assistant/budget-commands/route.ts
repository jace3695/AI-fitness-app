import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { applyBudgetAmount, budgetCurrency, budgetDetails, budgetHistoryFields, budgetReceipt } from '@/lib/assistant-budget-server';

export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: NextRequest) {
  const db = await createServerSupabaseClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return json({ error: '로그인이 필요합니다.' }, 401);
  try {
    const id = request.nextUrl.searchParams.get('requestId');
    if (id) {
      if (!uuid.test(id)) return json({ error: '잘못된 요청 번호입니다.' }, 400);
      const receipt = await budgetReceipt(db, user.id, id);
      if (!receipt) return json({ error: '본인의 실행 이력을 찾지 못했습니다.' }, 404);
      const details = await budgetDetails(db, user.id, id);
      return json({ receipt, details });
    }
    const offset = Number(request.nextUrl.searchParams.get('offset') || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return json({ error: '잘못된 조회 위치입니다.' }, 400);
    const [history, currency] = await Promise.all([
      db.from('budget_category_changes').select(budgetHistoryFields).eq('user_id', user.id).order('created_at', { ascending: false }).order('id').range(offset, offset + 19),
      budgetCurrency(db, user.id),
    ]);
    if (history.error) throw new Error('가계부 실행 이력을 불러오지 못했습니다. 다시 시도해 주세요.');
    return json({ history: history.data, currency });
  } catch (failure) { return json({ error: failure instanceof Error ? failure.message : '가계부 이력을 확인하지 못했습니다.' }, 503); }
}
export async function POST(request: NextRequest) {
  const db = await createServerSupabaseClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return json({ error: '로그인이 필요합니다.' }, 401);
  const raw = await request.text();
  if (raw.length > 30000) return json({ error: '변경 내용이 너무 큽니다.' }, 400);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: '잘못된 요청입니다.' }, 400); }
  try {
    if (body?.decision === 'apply') return json({ receipt: await applyBudgetAmount(db, user.id, body.proposal) });
    if (body?.decision !== 'undo' || typeof body.requestId !== 'string' || !uuid.test(body.requestId)) return json({ error: '변경 내용을 확인해 주세요.' }, 400);
    const { error } = await db.rpc('undo_budget_category_change', { p_change_id: body.requestId });
    if (error) throw new Error(error.code === 'P0001' ? error.message : '되돌리기 결과를 확인하지 못했습니다. 다시 확인해 주세요.');
    const receipt = await budgetReceipt(db, user.id, body.requestId);
    if (!receipt) throw new Error('되돌린 이력을 확인하지 못했습니다. 실행 이력을 다시 불러와 주세요.');
    return json({ receipt });
  } catch (failure) { return json({ error: failure instanceof Error ? failure.message : '가계부 변경을 확인하지 못했습니다.' }, 409); }
}
