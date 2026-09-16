import { CHATGPT_CLIENT_ID } from '@/lib/chatgpt-connection';
import { acceptableOrigin, connectorJson, connectorRpcClient, readSmallBody, requiredOrigin } from '@/lib/chatgpt-server';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const origin = requiredOrigin();
    if (!acceptableOrigin(request, origin)) return connectorJson({ error: 'invalid_request' }, 403);
    const form = new URLSearchParams(await readSmallBody(request, 10000));
    if (form.get('client_id') !== CHATGPT_CLIENT_ID || form.getAll('token').length !== 1 || form.getAll('client_id').length !== 1) return connectorJson({ error: 'invalid_client' }, 400);
    const { error } = await connectorRpcClient().rpc('chatgpt_revoke', { p_token: form.get('token'), p_client: CHATGPT_CLIENT_ID });
    return connectorJson(error ? { error: 'temporarily_unavailable' } : {}, error ? 503 : 200);
  } catch { return connectorJson({ error: 'invalid_request' }, 400); }
}
