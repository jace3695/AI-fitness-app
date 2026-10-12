import { createServerSupabaseClient } from '@/lib/supabase-server';
import { characterReplyEnabled } from '@/lib/yeoni/reply-plan';
import { alignGeneratedReply, savedAlignmentConfiguration } from '@/lib/yeoni/speech-alignment';
import plan from '@/services/yeoni-alignment/general-validation-plan.json';
import currencyPlan from '@/services/yeoni-alignment/currency-validation-plan.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const json = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: Request) {
  if (!characterReplyEnabled(process.env)) return json({ error: 'NOT_FOUND' }, 404);
  const origin = request.headers.get('origin'), host = request.headers.get('host');
  if (!host || origin !== `https://${host}`) return json({ error: 'ORIGIN_REQUIRED' }, 403);
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return json({ error: 'LOGIN_REQUIRED' }, 401);
    const config = savedAlignmentConfiguration(process.env);
    if (!config) return json({ error: 'ALIGNMENT_CONFIG_UNAVAILABLE' }, 503);
    if (!request.body) return json({ error: 'INVALID_BODY' }, 400);
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 2_010_000) { await reader.cancel(); return json({ error: 'BODY_TOO_LARGE' }, 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const sample = [...plan.cases, ...currencyPlan.cases].find(item => item.id === body?.id);
    const audio = body?.audioContent;
    if (!sample || typeof audio !== 'string' || !audio || audio.length > 2_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) return json({ error: 'INVALID_SAMPLE' }, 400);
    // Only these approved texts are accepted. This endpoint never synthesizes audio.
    const started = Date.now();
    const alignment = await alignGeneratedReply(audio, sample.text, config);
    const elapsedMs = Date.now() - started;
    return alignment ? json({ alignment, elapsedMs }) : json({ error: 'ALIGNMENT_UNAVAILABLE', elapsedMs }, 422);
  } catch { return json({ error: 'REVIEW_UNAVAILABLE' }, 503); }
}
