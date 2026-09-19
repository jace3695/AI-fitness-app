import { CHATGPT_CLIENT_ID, CHATGPT_REDIRECT } from '@/lib/chatgpt-connection';
import { acceptableOrigin, connectorJson, connectorRpcClient, readSmallBody, requiredOrigin } from '@/lib/chatgpt-server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const origin = requiredOrigin();
    if (!acceptableOrigin(request, origin)) return connectorJson({ error: 'invalid_request' }, 403);
    if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return connectorJson({ error: 'invalid_request' }, 400);
    const form = new URLSearchParams(await readSmallBody(request, 10000));
    if ([...form.keys()].some(key => form.getAll(key).length !== 1)) return connectorJson({ error: 'invalid_request' }, 400);
    const kind = form.get('grant_type');
    if (!['authorization_code', 'refresh_token'].includes(kind || '')) return connectorJson({ error: 'unsupported_grant_type' }, 400);
    if (form.get('client_id') !== CHATGPT_CLIENT_ID || request.headers.has('authorization') || form.has('client_secret') || form.has('client_assertion')) return connectorJson({ error: 'invalid_client' }, 400);
    if (form.get('resource') !== `${origin}/mcp` || (kind === 'authorization_code' && form.get('redirect_uri') !== CHATGPT_REDIRECT)) return connectorJson({ error: 'invalid_target' }, 400);
    const { data, error } = await connectorRpcClient().rpc('chatgpt_exchange', { p_kind: kind,
      p_credential: form.get(kind === 'authorization_code' ? 'code' : 'refresh_token'), p_client: CHATGPT_CLIENT_ID,
      p_resource: `${origin}/mcp`, p_verifier: form.get('code_verifier'), p_redirect: form.get('redirect_uri') });
    if (error || !data) return connectorJson({ error: 'temporarily_unavailable' }, 503);
    return connectorJson(data, data.error ? 400 : 200);
  } catch { return connectorJson({ error: 'invalid_request' }, 400); }
}
