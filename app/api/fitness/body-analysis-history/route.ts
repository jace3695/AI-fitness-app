import { createServerSupabaseClient } from '@/lib/supabase-server';
import { BODY_HISTORY_TABLE, historyId, parseBodyAnalysisSnapshot, parseBodyAnalysisEntry } from '@/lib/body-analysis-history';
export const dynamic = 'force-dynamic';
const fields = 'id,created_at,snapshot';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const unavailable = () => reply({ error: '저장 이력을 확인하지 못했습니다. 저장 기능 준비 상태나 연결을 확인한 뒤 다시 시도해 주세요.' }, 503);
export async function GET(request: Request) {
  try {
    const db = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return reply({ error: '로그인이 필요합니다.' }, 401);
    if (request.headers.get('X-Expected-Owner') !== user.id) return reply({ error: '계정이 바뀌었습니다. 다시 확인해 주세요.' }, 409);
    const params = new URL(request.url).searchParams, before = params.get('before'), beforeId = params.get('beforeId');
    if ((before || beforeId) && (!before || !/^\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-][0-9:]+)$/.test(before) || !Number.isFinite(Date.parse(before)) || !historyId(beforeId))) return reply({ error: '이력 조회 위치를 확인해 주세요.' }, 400);
    let query = db.from(BODY_HISTORY_TABLE).select(fields).eq('user_id', user.id);
    if (before && beforeId) query = query.or('created_at.lt.' + before + ',and(created_at.eq.' + before + ',id.lt.' + beforeId + ')');
    const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(21);
    if (error) return unavailable();
    const rows = (data ?? []).map(parseBodyAnalysisEntry);
    if (rows.some(row => !row)) return unavailable();
    const entries = rows.slice(0, 20), last = entries.at(-1);
    return reply({ entries, nextCursor: rows.length > 20 && last ? { before: last.created_at, beforeId: last.id } : null });
  } catch { return unavailable(); }
}
export async function POST(request: Request) {
  try {
    const db = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return reply({ error: '로그인이 필요합니다.' }, 401);
    if (request.headers.get('X-Expected-Owner') !== user.id) return reply({ error: '계정이 바뀌었습니다. 다시 확인해 주세요.' }, 409);
    const text = await request.text();
    if (text.length > 16000) return reply({ error: '저장 내용이 너무 큽니다.' }, 413);
    let body; try { body = JSON.parse(text); } catch { return reply({ error: '저장 형식을 확인해 주세요.' }, 400); }
    const snapshot = parseBodyAnalysisSnapshot(body?.snapshot);
    if (!body || Object.keys(body).sort().join(',') !== 'acknowledged,id,snapshot' || body.acknowledged !== true || !historyId(body.id) || !snapshot) return reply({ error: '저장할 내용과 동의를 확인해 주세요.' }, 400);
    // Immutable, owner-scoped ID: retries never update an older snapshot.
    const inserted = await db.from(BODY_HISTORY_TABLE).insert({ id: body.id, user_id: user.id, snapshot }).select(fields).single();
    if (!inserted.error) {
      const entry = parseBodyAnalysisEntry(inserted.data);
      return entry ? reply({ entry }, 201) : unavailable();
    }
    if (inserted.error.code !== '23505') return unavailable();
    const prior = await db.from(BODY_HISTORY_TABLE).select(fields).eq('user_id', user.id).eq('id', body.id).maybeSingle();
    if (prior.error) return unavailable();
    const entry = parseBodyAnalysisEntry(prior.data);
    if (!entry || JSON.stringify(entry.snapshot) !== JSON.stringify(snapshot)) return reply({ error: '같은 저장 요청의 내용이 다릅니다. 최신 점검을 다시 확인해 주세요.' }, 409);
    return reply({ entry });
  } catch { return unavailable(); }
}
export async function DELETE(request: Request) {
  try {
    const db = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) return reply({ error: '로그인이 필요합니다.' }, 401);
    if (request.headers.get('X-Expected-Owner') !== user.id) return reply({ error: '계정이 바뀌었습니다. 다시 확인해 주세요.' }, 409);
    const id = new URL(request.url).searchParams.get('id');
    if (!historyId(id)) return reply({ error: '삭제할 이력을 확인해 주세요.' }, 400);
    const { error } = await db.from(BODY_HISTORY_TABLE).delete().eq('user_id', user.id).eq('id', id);
    return error ? unavailable() : reply({ deleted: true });
  } catch { return unavailable(); }
}
