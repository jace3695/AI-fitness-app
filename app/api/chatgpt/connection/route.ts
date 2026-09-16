import { createServerSupabaseClient } from '@/lib/supabase-server';
import { parseConnectRequest, validAreas } from '@/lib/chatgpt-connection';
import { acceptableOrigin, connectorJson, readSmallBody, requiredOrigin, safeConnectionError, verifyChatgptClient } from '@/lib/chatgpt-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const origin = requiredOrigin(); const client = await createServerSupabaseClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return connectorJson({ error: '로그인이 필요합니다.' }, 401);
    const { data, error } = await client.rpc('chatgpt_connections');
    if (error) return connectorJson({ error: '연결 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    const params = new URL(request.url).searchParams;
    const authorization = params.has('client_id') ? parseConnectRequest(params, origin) : null;
    if (authorization) await verifyChatgptClient(origin);
    return connectorJson({ connections: data, origin, authorization });
  } catch (error) { return connectorJson({ error: safeConnectionError(error) }, 400); }
}
export async function POST(request: Request) {
  try {
    const origin = requiredOrigin();
    if (!acceptableOrigin(request, origin, true)) return connectorJson({ error: '연이 화면에서 다시 요청해 주세요.' }, 403);
    const client = await createServerSupabaseClient(); const { data: { user } } = await client.auth.getUser();
    if (!user) return connectorJson({ error: '로그인이 필요합니다.' }, 401);
    const body = JSON.parse(await readSmallBody(request, 12000));
    if (body.decision === 'revoke') {
      if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return connectorJson({ error: '연결을 다시 선택해 주세요.' }, 400);
      const { data, error } = await client.rpc('chatgpt_connections', { p_revoke: body.id });
      return connectorJson(error ? { error: '연결 해제 결과를 확인하지 못했습니다. 새로고침 후 다시 확인해 주세요.' } : { connections: data }, error ? 503 : 200);
    }
    if (!['approve', 'deny'].includes(body.decision) || typeof body.query !== 'string') return connectorJson({ error: '연결 요청을 확인해 주세요.' }, 400);
    const authorization = parseConnectRequest(new URLSearchParams(body.query.replace(/^\?/, '')), origin);
    const redirect = new URL(authorization.redirectUri);
    redirect.searchParams.set('state', authorization.state); redirect.searchParams.set('iss', origin);
    if (body.decision === 'deny') redirect.searchParams.set('error', 'access_denied');
    else {
      if (!validAreas(body.areas)) return connectorJson({ error: '허용할 기록 영역을 선택해 주세요.' }, 400);
      await verifyChatgptClient(origin);
      const { data, error } = await client.rpc('chatgpt_authorize', { p_resource: authorization.resource, p_client: authorization.clientId,
        p_scopes: authorization.scopes, p_areas: body.areas, p_challenge: authorization.challenge });
      if (error || !data?.code) return connectorJson({ error: error?.code === 'P0001' ? error.message : '연결 승인을 저장하지 못했습니다. 다시 시도해 주세요.' }, 503);
      redirect.searchParams.set('code', data.code);
    }
    return connectorJson({ redirect: redirect.toString() });
  } catch (error) { return connectorJson({ error: safeConnectionError(error) }, 400); }
}
