import { parseConnectRequest } from '@/lib/chatgpt-connection';
import { connectorJson, PRIVATE_HEADERS, requiredOrigin, safeConnectionError, verifyChatgptClient } from '@/lib/chatgpt-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const origin = requiredOrigin(); const url = new URL(request.url);
    parseConnectRequest(url.searchParams, origin);
    await verifyChatgptClient(origin);
    return new Response(null, { status: 302, headers: { ...PRIVATE_HEADERS, Location: `${origin}/assistant/connect${url.search}` } });
  } catch (error) { return connectorJson({ error: 'invalid_request', message: safeConnectionError(error) }, 400); }
}
