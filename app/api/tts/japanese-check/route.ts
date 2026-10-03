import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { zephyrBudget, zephyrFreeConfiguration } from '@/lib/zephyr-free-server';
import { JAPANESE_CHECK, japaneseCheckEnabled } from '@/lib/japanese-voice-check';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export async function POST() {
  if (!japaneseCheckEnabled(process.env)) return json({ error: 'Not found' }, 404);
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return json({ error: '연이 앱에 로그인해 주세요.' }, 401);
    const config = zephyrFreeConfiguration();
    if (!config) return json({ error: '무료 음성 설정을 확인하지 못해 생성을 멈췄어요.' }, 503);
    const { text, voice, languageCode, requestId } = JAPANESE_CHECK;
    const characters = Array.from(text).length;
    // The DB globally serializes reservations and rejects this ID across accounts/months.
    const grant = await zephyrBudget(supabase, { action: 'reserve', requestId, text, keyFingerprint: config.keyFingerprint });
    if (grant.allowed !== true) return json({ code: grant.code,
      error: grant.code === 'DUPLICATE_REQUEST' ? '이미 접수한 1회 요청입니다. 추가 생성하지 않습니다.' : '무료 사용 한도 또는 승인을 확인하지 못해 생성을 멈췄어요.',
    }, grant.code === 'DUPLICATE_REQUEST' ? 409 : 503);
    const sendBefore = typeof grant.sendBefore === 'string' ? Date.parse(grant.sendBefore) : NaN;
    if (grant.code !== 'RESERVED' || grant.requestId !== requestId || grant.characters !== characters
      || !Number.isFinite(sendBefore) || sendBefore <= Date.now() || sendBefore > Date.now() + 15_000
      || !Number.isInteger(grant.remainingCharacters) || Number(grant.remainingCharacters) < 0) {
      return json({ error: '요청 예약 결과가 불확실해 생성을 멈췄어요.' }, 503);
    }
    // Fixed payload, one attempt, no retries or refunds even on timeout.
    try {
      const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.key },
        body: JSON.stringify({ input: { text }, voice: { languageCode, name: voice }, audioConfig: { audioEncoding: 'MP3' } }),
      });
      if (!response.ok) throw new Error('PROVIDER_FAILED');
      const data: unknown = await response.json();
      const audioContent = data && typeof data === 'object' && 'audioContent' in data ? data.audioContent : null;
      if (typeof audioContent !== 'string' || !audioContent || audioContent.length > 8_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audioContent)) throw new Error('INVALID_AUDIO');
      return json({ audioContent, requestId, voice, text });
    } catch {
      return json({ code: 'ZEPHYR_UNCONFIRMED', error: '생성 완료 여부가 불확실합니다. 추가 생성하지 말고 이 메시지를 알려주세요.' }, 502);
    }
  } catch {
    return json({ error: '연결 또는 예약 결과를 확인하지 못했습니다. 자동으로 다시 요청하지 않습니다.' }, 503);
  }
}
