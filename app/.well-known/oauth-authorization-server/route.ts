import { authorizationMetadata } from '@/lib/chatgpt-connection';
import { connectorJson, requiredOrigin } from '@/lib/chatgpt-server';
export const dynamic = 'force-dynamic';
export function GET() {
  try { return connectorJson(authorizationMetadata(requiredOrigin())); }
  catch { return connectorJson({ error: 'connector_unavailable' }, 503); }
}
