import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { YEONI_VOICE_NAME } from '@/lib/yeoni-voice-policy';
import { ZEPHYR_REQUEST_ID, readZephyrRequest } from '@/lib/zephyr-free-server';
import { isZephyrProbePreview, ZEPHYR_PROBE_TEXT, ZEPHYR_PROBE_CHARACTERS } from '@/lib/zephyr-probe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json({
  voice: YEONI_VOICE_NAME, useDeviceVoice: false, ...body,
}, { status, headers: { 'Cache-Control': 'no-store' } });
async function probe(supabase: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('zephyr-probe', { body, timeout: 8_000 });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('PROBE_UNAVAILABLE');
  return data as Record<string, unknown>;
}

export async function GET() {
  if (!isZephyrProbePreview()) return json({ error: 'Not found' }, 404);
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return json({ error: '로그인이 필요합니다.' }, 401);
    const configured = Boolean(process.env.GOOGLE_TTS_API_KEY?.trim());
    let result: Record<string, unknown>;
    try { result = await probe(supabase, { action: 'status' }); }
    catch {
      return json({ configured, slots: [], code: 'PROBE_NOT_READY', text: ZEPHYR_PROBE_TEXT,
        charactersPerRequest: ZEPHYR_PROBE_CHARACTERS,
        message: configured ? '검증용 승인 설정을 준비 중이에요. 실제 음성은 아직 생성하지 않아요.' : 'Preview에 GOOGLE_TTS_API_KEY 설정이 필요해요. 키는 Vercel의 Value 칸에만 입력해 주세요.' });
    }
    if (!Array.isArray(result.slots) || result.slots.length > 3) throw new Error('INVALID_STATUS');
    const slots = result.slots.map((slot: Record<string, unknown>) => {
      if (!slot || typeof slot.requestId !== 'string' || !ZEPHYR_REQUEST_ID.test(slot.requestId)
        || !Number.isInteger(slot.slot) || Number(slot.slot) < 1 || Number(slot.slot) > 3
        || typeof slot.available !== 'boolean' || (slot.reservedAt !== null && typeof slot.reservedAt !== 'string')) throw new Error('INVALID_STATUS');
      return { requestId: slot.requestId, slot: slot.slot, reservedAt: slot.reservedAt, available: configured && slot.available };
    });
    return json({ configured, slots, text: ZEPHYR_PROBE_TEXT, charactersPerRequest: ZEPHYR_PROBE_CHARACTERS,
      message: configured ? '이번 검증에 승인된 요청만 사용할 수 있어요. 실제 청구 금액은 Google 보고서에서 확인해요.' : 'Preview에 GOOGLE_TTS_API_KEY 설정이 필요해요. 키는 Vercel의 Value 칸에만 입력해 주세요.' });
  } catch { return json({ error: '검증 준비 상태를 확인하지 못했어요.' }, 503); }
}

export async function POST(request: NextRequest) {
  if (!isZephyrProbePreview()) return json({ error: 'Not found' }, 404);
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return json({ error: '로그인이 필요합니다.' }, 401);
    let body: Record<string, unknown> | null;
    try { body = await readZephyrRequest(request); }
    catch { return json({ error: '요청 형식을 확인해 주세요.' }, 400); }
    const requestId = typeof body?.requestId === 'string' ? body.requestId.toLowerCase() : '';
    if (!ZEPHYR_REQUEST_ID.test(requestId) || Object.keys(body ?? {}).some(key => key !== 'requestId')) return json({ error: '승인된 검증 요청 번호가 필요해요.' }, 400);
    const key = process.env.GOOGLE_TTS_API_KEY?.trim();
    if (!key) return json({ code: 'KEY_MISSING', error: 'Preview에 Google TTS 키가 설정되지 않았어요.' }, 503);
    const grant = await probe(supabase, { action: 'reserve', requestId, keyFingerprint: createHash('sha256').update(key).digest('hex') });
    if (grant.allowed !== true) return json({ code: grant.code, error: '이미 사용했거나 승인 기간이 지난 검증 요청이에요.' }, 409);
    const sendBefore = typeof grant.sendBefore === 'string' ? Date.parse(grant.sendBefore) : NaN;
    if (grant.code !== 'RESERVED' || grant.requestId !== requestId || grant.characters !== ZEPHYR_PROBE_CHARACTERS
      || !Number.isFinite(sendBefore) || sendBefore <= Date.now() || sendBefore > Date.now() + 15_000) throw new Error('INVALID_GRANT');
    // Exactly one attempt per persistent slot, including failed/ambiguous calls.
    try {
      const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ input: { text: ZEPHYR_PROBE_TEXT }, voice: { languageCode: 'ko-KR', name: YEONI_VOICE_NAME }, audioConfig: { audioEncoding: 'MP3' } }),
      });
      if (!response.ok) return json({ requestId, code: 'GOOGLE_REJECTED', googleHttpStatus: response.status,
        error: `Google이 음성 요청을 완료하지 않았어요(HTTP ${response.status}). 추가 생성을 멈추고 설정을 확인해 주세요.` }, 502);
      const data: unknown = await response.json();
      const audioContent = data && typeof data === 'object' && 'audioContent' in data ? data.audioContent : null;
      if (typeof audioContent !== 'string' || !audioContent || audioContent.length > 8_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audioContent)) throw new Error('INVALID_AUDIO');
      return json({ requestId, audioContent, characters: ZEPHYR_PROBE_CHARACTERS, googleHttpStatus: response.status, generatedAt: new Date().toISOString() });
    } catch { return json({ requestId, code: 'GOOGLE_UNCONFIRMED', error: 'Google 음성 생성 완료 여부를 확인하지 못했어요. 재시도하지 않고 검증을 멈췄어요.' }, 502); }
  } catch { return json({ code: 'PROBE_UNAVAILABLE', error: '검증 요청 상태를 확인하지 못했어요. 추가 생성을 멈췄어요.' }, 503); }
}
