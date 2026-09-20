import { NextRequest, NextResponse } from 'next/server';
import { YEONI_VOICE_NAME, YEONI_VOICE_PENDING_MESSAGE } from '@/lib/yeoni-voice-policy';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { ZEPHYR_REQUEST_ID, readZephyrRequest, zephyrBudget, zephyrFreeConfiguration } from '@/lib/zephyr-free-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json({
  voice: YEONI_VOICE_NAME, useDeviceVoice: false, ...body,
}, { status, headers: { 'Cache-Control': 'no-store' } });
const pending = () => json({ enabled: false, error: YEONI_VOICE_PENDING_MESSAGE, code: 'PAID_AI_DISABLED' }, 503);
const unavailable = () => json({ enabled: false, error: '음성 사용 가능 여부를 확인하지 못했어요. 화면의 답변을 확인해 주세요.', code: 'ZEPHYR_UNAVAILABLE' }, 503);
const denied = (code: unknown) => {
  if (code === 'MONTH_LIMIT' || code === 'DAY_LIMIT' || code === 'TOO_FAST') return json({ enabled: false, code,
    error: code === 'TOO_FAST' ? '음성을 연속으로 요청했어요. 잠시 후 다시 이용해 주세요.' : '음성 사용 제한에 도달했어요. 분석과 조언은 화면에서 계속 이용할 수 있어요.',
  }, 429);
  if (code === 'DUPLICATE_REQUEST') return json({ code, error: '이미 접수한 음성 요청이에요. 중복 생성을 막기 위해 다시 요청하지 않았어요.' }, 409);
  return pending();
};

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return json({ error: '로그인이 필요합니다.' }, 401);
    const config = zephyrFreeConfiguration();
    if (!config) return json({ enabled: false, code: 'CONFIRMATION_REQUIRED', message: YEONI_VOICE_PENDING_MESSAGE });
    const result = await zephyrBudget(supabase, { action: 'status', keyFingerprint: config.keyFingerprint });
    if (result.allowed !== true && result.code !== 'MONTH_LIMIT') return json({ enabled: false, code: 'CONFIRMATION_REQUIRED', message: YEONI_VOICE_PENDING_MESSAGE });
    const { reservedCharacters, limitCharacters, remainingCharacters, month } = result;
    if (!Number.isInteger(reservedCharacters) || !Number.isInteger(limitCharacters) || !Number.isInteger(remainingCharacters)
      || Number(reservedCharacters) < 0 || Number(limitCharacters) > 100_000 || Number(limitCharacters) < 1
      || Number(remainingCharacters) < 0 || Number(reservedCharacters) + Number(remainingCharacters) !== limitCharacters
      || typeof month !== 'string' || !/^\d{4}-\d{2}-01$/.test(month)) return unavailable();
    return json({ enabled: result.allowed === true, code: result.code, month, reservedCharacters, limitCharacters, remainingCharacters,
      usageNote: '앱에서 미리 예약한 문자 수이며, 실패한 요청도 포함해요. Google의 실제 사용량·청구 금액과는 달라요.' });
  } catch { return unavailable(); }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: '로그인이 필요합니다.' }, 401);
    let body: Record<string, unknown> | null;
    try { body = await readZephyrRequest(req); }
    catch (error) { return json({ error: '음성 요청 형식을 확인해주세요.' }, error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : 400); }
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const characters = Array.from(text).length;
    if (!text || characters > 1200) return json({ error: '읽을 문장은 1자 이상 1,200자 이하로 입력해주세요.' }, 400);
    const config = zephyrFreeConfiguration();
    if (!config) return pending();
    const requestId = typeof body?.requestId === 'string' ? body.requestId.toLowerCase() : '';
    if (!ZEPHYR_REQUEST_ID.test(requestId)) return json({ error: '음성 요청 번호가 필요합니다.' }, 400);
    const grant = await zephyrBudget(supabase, { action: 'reserve', requestId, text, keyFingerprint: config.keyFingerprint });
    if (grant.allowed !== true) return denied(grant.code);
    const sendBefore = typeof grant.sendBefore === 'string' ? Date.parse(grant.sendBefore) : NaN;
    if (grant.code !== 'RESERVED' || grant.requestId !== requestId || grant.characters !== characters
      || !Number.isFinite(sendBefore) || sendBefore <= Date.now() || sendBefore > Date.now() + 15_000
      || !Number.isInteger(grant.remainingCharacters) || Number(grant.remainingCharacters) < 0) return unavailable();
    // Exactly one provider attempt, only after the committed reservation.
    // Never refund: even a network error can have been billed.
    try {
      const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.key },
        body: JSON.stringify({ input: { text }, voice: { languageCode: 'ko-KR', name: YEONI_VOICE_NAME }, audioConfig: { audioEncoding: 'MP3' } }),
      });
      if (!response.ok) throw new Error('PROVIDER_FAILED');
      const data: unknown = await response.json();
      const audioContent = data && typeof data === 'object' && 'audioContent' in data ? data.audioContent : null;
      if (typeof audioContent !== 'string' || !audioContent || audioContent.length > 8_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audioContent)) throw new Error('INVALID_AUDIO');
      return json({ audioContent, requestId, reservedCharacters: characters, remainingCharacters: grant.remainingCharacters });
    } catch {
      return json({ error: '음성 생성 완료 여부를 확인하지 못했어요. 추가 생성을 멈췄으며, 예약 문자 수는 유지해요. 화면의 답변을 확인해 주세요.', code: 'ZEPHYR_UNCONFIRMED', requestId }, 502);
    }
  } catch { return unavailable(); }
}
