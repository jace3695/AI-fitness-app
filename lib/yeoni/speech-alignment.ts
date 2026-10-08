import { verifyLipSyncPair, type LipSyncManifest } from './lip-sync.ts';
import { YEONI_VOICE_NAME } from '../yeoni-voice-policy.ts';

/** Validate against the exact audio and normalized text sent to Zephyr, never display Markdown. */
export async function validateReplyAlignment(audio: ArrayBuffer, text: string, input: unknown): Promise<LipSyncManifest> {
  const manifest = await verifyLipSyncPair(audio, input);
  if (manifest.language !== 'ko-KR' || manifest.voice !== YEONI_VOICE_NAME
    || manifest.spokenText !== text || manifest.alignment !== 'automatic-phonemes') {
    throw new Error('이번 답변의 음성 정렬이 아니에요.');
  }
  return manifest;
}

export function alignmentConfiguration(env: Record<string, string | undefined>) {
  if (env.YEONI_REPLY_ALIGNMENT_ENABLED !== '1') return null;
  try {
    const binding = env.YEONI_ALIGNMENT_INTERNAL_URL;
    const base = new URL(binding ?? env.YEONI_ALIGNMENT_URL ?? '');
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) return null;
    // Preserve any platform routing prefix in the runtime-only binding URL.
    const endpoint = binding ? new URL('align', base.href.endsWith('/') ? base.href : `${base.href}/`) : base;
    const token = env.YEONI_ALIGNMENT_TOKEN;
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || !token || token.length < 32) return null;
    return { endpoint: endpoint.href, token };
  } catch { return null; }
}

/** One bounded alignment attempt. Failure preserves the already generated audio; never synthesizes again. */
export async function alignGeneratedReply(audioContent: string, text: string,
  config: NonNullable<ReturnType<typeof alignmentConfiguration>>, request: typeof fetch = fetch) {
  try {
    // Leave headroom below the hosting request/response limit for JSON and cues.
    if (audioContent.length > 2_000_000) return null;
    const response = await request(config.endpoint, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ audioContent, spokenText: text, voice: YEONI_VOICE_NAME, language: 'ko-KR' }),
    });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) { await reader.cancel(); return null; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const joined = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    const input: unknown = JSON.parse(new TextDecoder().decode(joined));
    const audio = Uint8Array.from(atob(audioContent), c => c.charCodeAt(0)).buffer;
    return await validateReplyAlignment(audio, text, input);
  } catch { return null; }
}
