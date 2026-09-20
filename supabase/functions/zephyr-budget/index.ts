import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.8';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const authorization = request.headers.get('Authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { ...options, global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);
    if (Number(request.headers.get('content-length')) > 20_000) return json({ error: 'Too large' }, 413);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Invalid request' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 20_000) { await reader.cancel(); return json({ error: 'Too large' }, 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || typeof body.keyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.keyFingerprint)) return json({ error: 'Invalid request' }, 400);
    // A caller may consume allowance, but cannot configure, refund or impersonate.
    let args: Record<string, unknown>; let rpc: string;
    if (body.action === 'status') {
      rpc = 'zephyr_free_status'; args = { p_key_fingerprint: body.keyFingerprint };
    } else if (body.action === 'reserve' && typeof body.requestId === 'string' && uuid.test(body.requestId)
      && typeof body.text === 'string' && body.text.trim() && Array.from(body.text).length <= 1200) {
      rpc = 'reserve_zephyr_characters'; args = { p_user_id: user.id, p_request_id: body.requestId, p_text: body.text, p_key_fingerprint: body.keyFingerprint };
    } else return json({ error: 'Invalid request' }, 400);
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options);
    const { data, error } = await admin.rpc(rpc, args);
    if (error || !data) return json({ error: 'Budget unavailable' }, 503);
    return json(data);
  } catch { return json({ error: 'Budget unavailable' }, 503); }
});
