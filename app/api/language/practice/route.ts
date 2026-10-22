import { createServerSupabaseClient } from '@/lib/supabase-server';
import { FreeJapaneseError, generateFreeJapanese, parseFreeJapaneseRequest } from '@/lib/free-japanese-conversation';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(request: Request) {
  try {
    const client = await createServerSupabaseClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return reply({ error: '로그인을 확인해 주세요.' }, 401);
    if (Number(request.headers.get('content-length')) > 150000) return reply({ error: '요청이 너무 커요.' }, 413);
    const raw = await request.text();
    if (raw.length > 30000) return reply({ error: '요청이 너무 커요.' }, 413);
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return reply({ error: '요청 형식을 확인해 주세요.' }, 400); }
    const input = parseFreeJapaneseRequest(json);
    if (!input) return reply({ error: '동의와 현재 문장·최근 대화 최대 4쌍을 확인해 주세요.' }, 400);
    return reply(await generateFreeJapanese(input, process.env, fetch, request.signal));
  } catch (error) {
    if (error instanceof FreeJapaneseError) return reply({ error: error.message }, error.status);
    return reply({ error: '자유 회화 응답을 받지 못했어요. 입력은 유지돼요.' }, 503);
  }
}
