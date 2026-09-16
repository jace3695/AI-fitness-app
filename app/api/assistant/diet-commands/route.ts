import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { isDietCommandProposal } from '@/lib/assistant-diet-command';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fields = 'user_id,id,record_date,change,before_values,after_values,created_at,undone_at';
export async function GET(request: NextRequest) {
  const db = await createServerSupabaseClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return reply({ error: '로그인이 필요합니다.' }, 401);
  const offset = Number(request.nextUrl.searchParams.get('offset') || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return reply({ error: '잘못된 조회 위치입니다.' }, 400);
  const { data, error } = await db.from('assistant_diet_command_history').select(fields).eq('user_id', user.id)
    .order('created_at', { ascending: false }).order('id').range(offset, offset + 19);
  if (error) return reply({ error: '식단 실행 이력을 불러오지 못했습니다. 다시 시도해 주세요.' }, 503);
  return reply({ history: data });
}
export async function POST(request: NextRequest) {
  const db = await createServerSupabaseClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return reply({ error: '로그인이 필요합니다.' }, 401);
  const raw = await request.text();
  if (raw.length > 220000) return reply({ error: '변경 내용이 너무 큽니다.' }, 400);
  let body;
  try { body = JSON.parse(raw); } catch { return reply({ error: '잘못된 요청입니다.' }, 400); }
  if (!body || !['apply', 'undo'].includes(body.decision)) return reply({ error: '식단 변경을 확인해 주세요.' }, 400);
  if (body.decision === 'apply' && (!isDietCommandProposal(body.proposal) || body.proposal.ownerId !== user.id)) return reply({ error: '본인의 식단 변경 내용을 다시 확인해 주세요.' }, 400);
  if (body.decision === 'undo' && (typeof body.requestId !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(body.requestId))) return reply({ error: '실행 이력을 다시 확인해 주세요.' }, 400);
  const p = body.proposal;
  const { data, error } = body.decision === 'undo'
    ? await db.rpc('undo_assistant_diet_command', { p_request_id: body.requestId })
    : await db.rpc(p.change.kind === 'time' ? 'apply_assistant_diet_time_command' : p.change.kind === 'meal' ? 'apply_assistant_diet_meal_command' : 'apply_assistant_diet_command', {
      p_request_id: p.requestId, p_day: p.date, p_change: p.change, p_expected: p.expected,
      p_reset_markers: p.resetMarkers, p_expires_at: p.expiresAt,
    });
  if (error) return reply({ error: error.code === 'P0001' ? error.message : '식단 저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인하거나 실행 이력을 확인해 주세요.' }, error.code === 'PGRST202' ? 503 : 409);
  return reply({ receipt: data });
}
