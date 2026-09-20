export const CHATGPT_CLIENT_ID = 'https://chatgpt.com/oauth/client.json';
export const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
export const CHATGPT_PREVIEW_ORIGIN = 'https://ai-fitness-app-git-fix-app-wide-reliability-jace3695s-projects.vercel.app';
export const CONNECT_SCOPES = ['yeoni:records:read', 'yeoni:advice:read', 'yeoni:advice:write'] as const;
export const CONNECT_AREAS = ['assistant', 'fitness', 'diet', 'language', 'budget'] as const;
export type ConnectArea = typeof CONNECT_AREAS[number];
export const AREA_LABELS: Record<ConnectArea, string> = { assistant: '일정·할 일', fitness: '운동', diet: '식단', language: '언어 학습', budget: '가계부' };
export type Connection = { id: string; areas: ConnectArea[]; scopes: string[]; created_at: string; expires_at: string; revoked_at: string | null; active: boolean };
export type RecordSummary = { area: ConnectArea; start_date: string; end_date: string; metrics: Record<string, number>; notes: string[] };
export type SavedAdvice = { id: string; title: string; body: string; area: ConnectArea; created_at: string; snapshot_at: string; summary: RecordSummary };

export function connectorOrigin(env: Record<string, string | undefined> = process.env) {
  // This first connection stays on the reviewed Preview. A request's Host or
  // forwarded headers must never decide the OAuth issuer or token audience.
  if (env.YEONI_E2E === '1' && env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321' && !env.VERCEL) return 'http://127.0.0.1:3000';
  if (env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'fix/app-wide-reliability') return CHATGPT_PREVIEW_ORIGIN;
  return null;
}

export type ConnectRequest = { clientId: string; redirectUri: string; resource: string; state: string; challenge: string; scopes: string[] };
export function parseConnectRequest(params: URLSearchParams, origin: string): ConnectRequest {
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new Error('중복된 연결 요청입니다. ChatGPT에서 다시 연결해 주세요.');
  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const resource = params.get('resource') || '';
  const state = params.get('state') || '';
  const challenge = params.get('code_challenge') || '';
  const scope = params.get('scope');
  const scopes = scope === null ? [...CONNECT_SCOPES] : scope.split(' ').filter(Boolean);
  if (clientId !== CHATGPT_CLIENT_ID || redirectUri !== CHATGPT_REDIRECT || resource !== `${origin}/mcp`
    || params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256'
    || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || state.length < 1 || state.length > 1024
    || /[\x00-\x1f\x7f]/.test(state) || scopes.length < 1 || scopes.length > 3
    || new Set(scopes).size !== scopes.length || scopes.some(item => !(CONNECT_SCOPES as readonly string[]).includes(item))) {
    throw new Error('연결 요청을 확인하지 못했습니다. ChatGPT에서 연결을 다시 시작해 주세요.');
  }
  return { clientId, redirectUri, resource, state, challenge, scopes };
}

export function validAreas(value: unknown): value is ConnectArea[] {
  return Array.isArray(value) && value.length > 0 && value.length <= CONNECT_AREAS.length
    && new Set(value).size === value.length && value.every(item => CONNECT_AREAS.includes(item));
}

export function authorizationMetadata(origin: string) {
  return {
    issuer: origin, authorization_endpoint: `${origin}/api/chatgpt/oauth/authorize`,
    token_endpoint: `${origin}/api/chatgpt/oauth/token`, revocation_endpoint: `${origin}/api/chatgpt/oauth/revoke`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'], scopes_supported: CONNECT_SCOPES,
    authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true,
  };
}
export function protectedResourceMetadata(origin: string) {
  return { resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: CONNECT_SCOPES,
    bearer_methods_supported: ['header'], resource_name: 'AI 연이 기록과 조언', resource_documentation: `${origin}/assistant/connect` };
}
