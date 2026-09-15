import { createClient } from '@supabase/supabase-js';
import { CHATGPT_CLIENT_ID, CHATGPT_REDIRECT, connectorOrigin } from './chatgpt-connection.ts';

export const PRIVATE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
export function connectorJson(body: unknown, status = 200) { return Response.json(body, { status, headers: PRIVATE_HEADERS }); }
export function requiredOrigin() {
  const origin = connectorOrigin();
  if (!origin) throw new Error('ChatGPT 연결은 현재 검증용 Preview에서 준비 중입니다.');
  return origin;
}
export function acceptableOrigin(request: Request, origin: string, browserOnly = false) {
  const sent = request.headers.get('origin');
  return browserOnly ? sent === origin : sent === null || sent === origin || sent === 'https://chatgpt.com';
}
export async function readSmallBody(request: Pick<Request, 'headers' | 'body'>, limit = 32000) {
  if (Number(request.headers.get('content-length')) > limit) throw new Error('요청 내용이 너무 큽니다.');
  if (!request.body) return '';
  const reader = request.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('요청 내용이 너무 큽니다.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
}
export function connectorRpcClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('연결 저장소를 확인하지 못했습니다.');
  // Deliberately anonymous: all access is through narrow capability RPCs. An
  // opaque ChatGPT token must never be forwarded as a Supabase Authorization JWT.
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
let clientMetadataCheckedUntil = 0;
export async function verifyChatgptClient(origin: string) {
  // Only a disposable, loopback-only CI build uses the published metadata fixture.
  // It has no hosted project credentials and performs no request to ChatGPT.
  if (origin === 'http://127.0.0.1:3000' && connectorOrigin() === origin) return;
  if (Date.now() < clientMetadataCheckedUntil) return;
  const response = await fetch(CHATGPT_CLIENT_ID, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('ChatGPT 연결 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  const data = JSON.parse(await readSmallBody(response, 16000));
  const methods = data.token_endpoint_auth_methods_supported || [data.token_endpoint_auth_method];
  if (data.client_id !== CHATGPT_CLIENT_ID || !Array.isArray(data.redirect_uris) || !data.redirect_uris.includes(CHATGPT_REDIRECT)
    || !Array.isArray(methods) || !methods.includes('none')) throw new Error('ChatGPT 연결 규격이 변경되었습니다. 연결 설정을 확인해야 합니다.');
  clientMetadataCheckedUntil = Date.now() + 5 * 60_000;
}
export function authChallenge(origin: string, error = 'invalid_token') {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", error="${error}", error_description="Connect your AI Yeoni account to continue"`;
}
export function safeConnectionError(error: unknown) {
  return error instanceof Error && !/fetch failed|JSON|Unexpected|ECONN|TypeError/i.test(error.message)
    ? error.message : '연결 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
