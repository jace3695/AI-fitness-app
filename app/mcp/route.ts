import { serveMcp } from '@/lib/chatgpt-mcp';
import { acceptableOrigin, authChallenge, connectorJson, connectorRpcClient, PRIVATE_HEADERS, readSmallBody, requiredOrigin } from '@/lib/chatgpt-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  let origin: string;
  try { origin = requiredOrigin(); } catch { return connectorJson({ error: 'connector_unavailable' }, 503); }
  if (!acceptableOrigin(request, origin)) return connectorJson({ error: 'invalid_origin' }, 403);
  let body: unknown;
  try { body = JSON.parse(await readSmallBody(request)); } catch { return connectorJson({ error: 'invalid_request' }, 400); }
  const authorization = request.headers.get('authorization') || '';
  const token = /^Bearer (ya_[a-f0-9]{64})$/i.exec(authorization)?.[1];
  const response = await serveMcp(request, body, async (name, args) => {
    if (!token) return { error: 'invalid_token', message: '먼저 ChatGPT에서 연이 계정을 연결해 주세요.' };
    const { data, error } = await connectorRpcClient().rpc('chatgpt_tool', { p_token: token, p_resource: `${origin}/mcp`, p_tool: name, p_args: args });
    if (error) return { error: 'request_failed', message: error.code === 'P0001' ? error.message : '연이 기록을 처리하지 못했습니다. 저장을 다시 확인해 주세요.' };
    return data;
  }, authChallenge(origin));
  for (const [key, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(key, value);
  return response;
}
// No open stream or persistent process is needed for these three request tools.
export function GET() { return new Response(null, { status: 405, headers: { ...PRIVATE_HEADERS, Allow: 'POST' } }); }
export function DELETE() { return GET(); }
