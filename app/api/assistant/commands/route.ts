import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = '실행 이력 저장을 준비 중입니다. 잠시 후 다시 시도해 주세요.';


export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const offset = Number(request.nextUrl.searchParams.get('offset') || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return NextResponse.json({ error: '잘못된 조회 위치입니다.' }, { status: 400 });
  const { data, error } = await supabase.from('assistant_task_command_history').select('*')
    .eq('user_id', user.id).order('created_at', { ascending: false }).order('id').range(offset, offset + 19);
  if (error) return NextResponse.json({ error: error.code === 'PGRST205' || error.code === '42P01' ? unavailable : '실행 이력을 불러오지 못했습니다. 다시 시도해 주세요.' }, { status: 503 });
  return NextResponse.json({ history: (data ?? []).map(row => ({ id: row.id, operation: row.operation, item_id: row.item_id, before_record: row.before_record, after_record: row.after_record, created_at: row.created_at, undone_at: row.undone_at, spawned_record: row.spawned_record ?? null })) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const raw = await request.text();
  if (raw.length > 30000) return NextResponse.json({ error: '변경 내용이 너무 큽니다.' }, { status: 400 });
  let body;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 }); }
  if (!body || !['apply', 'undo'].includes(body.decision)) return NextResponse.json({ error: '변경을 확인해 주세요.' }, { status: 400 });
  const proposal = body.proposal;
  const id = body.decision === 'undo' ? body.requestId : proposal?.requestId;
  if (typeof id !== 'string' || !uuid.test(id)) return NextResponse.json({ error: '변경 요청을 다시 불러와 주세요.' }, { status: 400 });
  if (body.decision === 'apply' && (!proposal || !['create', 'update', 'complete'].includes(proposal.operation)
    || !proposal.values || !proposal.expiresAt)) return NextResponse.json({ error: '변경 내용을 확인해 주세요.' }, { status: 400 });
  if (body.decision === 'apply' && proposal.operation === 'complete' && (!proposal.expected
    || ['title', 'due_at', 'priority', 'recurrence_rule', 'project_id'].some(key => proposal.values[key] !== proposal.expected[key])))
    return NextResponse.json({ error: '완료할 내용을 다시 확인해 주세요.' }, { status: 400 });
  const { data, error } = body.decision === 'undo'
    ? await supabase.rpc('undo_assistant_task_command', { p_request_id: id })
    : proposal.operation === 'complete'
    ? await supabase.rpc('apply_assistant_task_completion', {
      p_request_id: id, p_item_id: proposal.itemId, p_expected: proposal.expected,
      p_reset_marker: proposal.resetMarker ?? null, p_expires_at: proposal.expiresAt,
    })
    : await supabase.rpc('apply_assistant_task_command', {
      p_request_id: id, p_operation: proposal.operation, p_item_id: proposal.itemId ?? null,
      p_expected: proposal.expected ?? null, p_values: proposal.values,
      p_reset_marker: proposal.resetMarker ?? null, p_expires_at: proposal.expiresAt,
    });
  if (error) return NextResponse.json({ error: error.code === 'PGRST202' ? unavailable
    : error.code === 'P0001' ? error.message : '변경을 저장하지 못했습니다. 실행 이력을 확인하거나 같은 요청으로 다시 시도해 주세요.' }, { status: error.code === 'PGRST202' ? 503 : 409 });
  return NextResponse.json({ receipt: data }, { headers: { 'Cache-Control': 'no-store' } });
}
