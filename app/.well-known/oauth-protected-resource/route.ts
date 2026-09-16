import { protectedResourceMetadata } from '@/lib/chatgpt-connection';
import { connectorJson, requiredOrigin } from '@/lib/chatgpt-server';
export const dynamic = 'force-dynamic';
export function GET() {
  try { return connectorJson(protectedResourceMetadata(requiredOrigin())); }
  catch { return connectorJson({ error: 'connector_unavailable' }, 503); }
}
