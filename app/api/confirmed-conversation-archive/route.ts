import { createServerSupabaseClient } from '@/lib/supabase-server';
import { ARCHIVE_TABLE, archiveKind, historyId, parseArchiveEntry, parseArchiveSnapshot } from '@/lib/confirmed-conversation-archive';
export const dynamic = 'force-dynamic';
const fields = 'id,created_at,snapshot';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const unavailable = () => reply({ error: '계정 보관 기능이 아직 준비되지 않았거나 연결을 확인하지 못했어요. 화면의 원본 기록은 유지됩니다.' }, 503);
async function auth(request: Request) {
  const db = await createServerSupabaseClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return { error: reply({ error: '로그인을 확인해 주세요.' }, 401) };
  if (request.headers.get('X-Expected-Owner') !== user.id) return { error: reply({ error: '계정이 변경됐어요. 화면을 다시 열어 주세요.' }, 409) };
  return { db, user };
}
export async function GET(request: Request) {
  try {
    const access = await auth(request); if (access.error) return access.error;
    const { db, user } = access;
    const params = new URL(request.url).searchParams, kind = params.get('kind'), before = params.get('before'), beforeId = params.get('beforeId');
    if (!archiveKind(kind)) return reply({ error: '보관 종류를 확인해 주세요.' }, 400);
    if ((before || beforeId) && (!before || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(before) || !Number.isFinite(Date.parse(before)) || new Date(before).toISOString() !== before || !historyId(beforeId))) return reply({ error: '조회 위치를 확인해 주세요.' }, 400);
    let query = db.from(ARCHIVE_TABLE).select(fields).eq('user_id', user.id).eq('kind', kind).not('snapshot', 'is', null);
    if (before && beforeId) query = query.or(`created_at.lt.${before},and(created_at.eq.${before},id.lt.${beforeId})`);
    const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(11);
    if (error) return unavailable();
    const rows = (data ?? []).map(parseArchiveEntry);
    if (rows.some(row => !row || row.snapshot.kind !== kind)) return unavailable();
    const entries = rows.slice(0,10), last = entries.at(-1);
    return reply({ entries, nextCursor: rows.length > 10 && last ? { before: last.created_at, beforeId: last.id } : null });
  } catch { return unavailable(); }
}
export async function POST(request: Request) {
  try {
    const access = await auth(request); if (access.error) return access.error;
    const { db, user } = access;
    const text = await request.text(); if (text.length > 40000) return reply({ error: '보관할 내용이 너무 큽니다.' }, 413);
    let body; try { body = JSON.parse(text); } catch { return reply({ error: '요청 형식을 확인해 주세요.' }, 400); }
    const snapshot = parseArchiveSnapshot(body?.snapshot);
    if (!body || Object.keys(body).sort().join(',') !== 'acknowledged,id,snapshot' || body.acknowledged !== true || !historyId(body.id) || !snapshot) return reply({ error: '보관 내용과 동의를 확인해 주세요.' }, 400);
    const inserted = await db.from(ARCHIVE_TABLE).insert({ user_id: user.id, id: body.id, kind: snapshot.kind, snapshot }).select(fields).single();
    if (!inserted.error) {
      const entry = parseArchiveEntry(inserted.data);
      return entry ? reply({ entry }, 201) : unavailable();
    }
    if (inserted.error.code !== '23505') return unavailable();
    const prior = await db.from(ARCHIVE_TABLE).select(fields).eq('user_id', user.id).eq('id', body.id).maybeSingle();
    if (prior.error) return unavailable();
    if (prior.data?.snapshot === null) return reply({ error: '이미 내용을 삭제한 보관 요청입니다. 늦은 재시도로 복원하지 않습니다.' }, 410);
    const entry = parseArchiveEntry(prior.data);
    if (!entry || JSON.stringify(entry.snapshot) !== JSON.stringify(snapshot)) return reply({ error: '같은 요청의 내용이 달라요. 보관할 내용을 다시 선택해 주세요.' }, 409);
    return reply({ entry });
  } catch { return unavailable(); }
}
export async function DELETE(request: Request) {
  try {
    const access = await auth(request); if (access.error) return access.error;
    const { db, user } = access;
    const params = new URL(request.url).searchParams, id = params.get('id'), kind = params.get('kind');
    if (!historyId(id) || !archiveKind(kind)) return reply({ error: '삭제할 보관본을 확인해 주세요.' }, 400);
    // Erase content, retain only the retry tombstone. SQL prohibits resurrection.
    const { error } = await db.from(ARCHIVE_TABLE).update({ snapshot: null }).eq('user_id', user.id).eq('kind', kind).eq('id', id).not('snapshot', 'is', null);
    return error ? unavailable() : reply({ deleted: true });
  } catch { return unavailable(); }
}
