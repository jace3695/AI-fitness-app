import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { characterReplyEnabled } from '@/lib/yeoni/reply-plan';
import { alignGeneratedReply, savedAlignmentConfiguration } from '@/lib/yeoni/speech-alignment';
import sample from '@/docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const json = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
// Coalesce concurrent clicks and reuse the fixed public fixture result for one minute.
let recent: { until: number; result: Promise<{ body: object; status: number }> } | null = null;

export async function POST(request: Request) {
  if (!characterReplyEnabled(process.env)) return json({ code: 'NOT_FOUND' }, 404);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ code: 'ORIGIN_REQUIRED' }, 403);
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return json({ code: 'LOGIN_REQUIRED' }, 401);
    const config = savedAlignmentConfiguration(process.env);
    if (!config) return json({ code: 'ALIGNMENT_CONFIG_UNAVAILABLE', bindingPresent: Boolean(process.env.YEONI_ALIGNMENT_INTERNAL_URL) }, 503);
    // No submitted text, audio, URL or voice is read. No Google or TTS call exists here.
    if (!recent || recent.until <= Date.now()) {
      recent = { until: Date.now() + 60_000, result: (async () => {
        const started = Date.now();
        const audioContent = await readFile(path.join(process.cwd(), 'docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3'), 'base64');
        let workerStatus: number | null = null;
        const observedFetch: typeof fetch = async (input, init) => {
          const response = await fetch(input, init); workerStatus = response.status; return response;
        };
        const alignment = await alignGeneratedReply(audioContent, sample.spokenText, config, observedFetch);
        const elapsedMs = Date.now() - started;
        return alignment
          ? { status: 200, body: { alignment, audioContent, elapsedMs, workerStatus, code: 'READY' } }
          : { status: 502, body: { code: 'ALIGNMENT_UNAVAILABLE', elapsedMs, workerStatus } };
      })() };
    }
    const result = await recent.result;
    return json(result.body, result.status);
  } catch { return json({ code: 'CHECK_UNAVAILABLE' }, 503); }
}
