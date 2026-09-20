import { createServerSupabaseClient } from '@/lib/supabase-server';
import { connectorJson } from '@/lib/chatgpt-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const client = await createServerSupabaseClient(); const { data: { user } } = await client.auth.getUser();
  if (!user) return connectorJson({ error: '로그인이 필요합니다.' }, 401);
  const offset = Number(new URL(request.url).searchParams.get('offset') || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) return connectorJson({ error: '조회 위치를 확인해 주세요.' }, 400);
  const { data, error } = await client.from('chatgpt_advice').select('id,title,body,area,summary,snapshot_at,created_at')
    .eq('user_id', user.id).order('created_at', { ascending: false }).order('id').range(offset, offset + 19);
  return connectorJson(error ? { error: '저장한 조언을 불러오지 못했습니다. 다시 시도해 주세요.' } : { advice: data }, error ? 503 : 200);
}
