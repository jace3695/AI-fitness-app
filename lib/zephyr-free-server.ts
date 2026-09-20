import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const ZEPHYR_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Independent of paid AI. Both the opt-in AND a verified monthly DB grant are required.
export function zephyrFreeConfiguration() {
  const key = process.env.GOOGLE_TTS_API_KEY?.trim();
  if (process.env.GOOGLE_TTS_FREE_ENABLED !== 'true' || !key) return null;
  return { key, keyFingerprint: createHash('sha256').update(key).digest('hex') };
}

export async function zephyrBudget(supabase: SupabaseClient, body: Record<string, unknown>) {
  // No retries: an interrupted reservation may already have consumed allowance.
  const { data, error } = await supabase.functions.invoke('zephyr-budget', { body, timeout: 8_000 });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('ZEPHYR_BUDGET_UNAVAILABLE');
  return data as Record<string, unknown>;
}

export async function readZephyrRequest(request: Request): Promise<Record<string, unknown> | null> {
  const limit = 20_000;
  if (Number(request.headers.get('content-length')) > limit) throw new Error('BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
}
