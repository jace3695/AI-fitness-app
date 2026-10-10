// Opt-in development diagnostics. State, owners, tokens and hashes never enter
// the snapshot/export. These metadata cannot prove saved-content equality.
export type SyncQaFault = 'hold-request' | 'hold-response' | 'drop-response' | 'fail-get';
export type SyncQaMethod = 'GET' | 'PATCH' | 'POST';
type Rule = { method: SyncQaMethod; fault: SyncQaFault };
const syncRpcPath = '/rest/v1/rpc/save_cloud_state_if_unchanged';
export type SyncQaEntry = {
  id: number; client: string; method: string;
  operation: 'read-state' | 'conditional-save' | 'legacy-update' | 'legacy-insert';
  startedAt: string; sentAt?: string; receivedAt?: string; deliveredAt?: string;
  request?: { stateKeys?: number; expectedStateKeys?: number; condition: 'owner-content-version' | 'owner-absent' | 'owner-timestamp' | 'incomplete' };
  response?: { status: number; rowCount?: number; stateKeys?: number; matched?: boolean; synthetic?: boolean };
  phase: string; fault?: SyncQaFault; error?: string;
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function decodedBody(raw: string): unknown { try { return JSON.parse(raw); } catch { return null; } }
function requestMetadata(raw: string, rpc: boolean, url: URL): SyncQaEntry['request'] {
  const body = decodedBody(raw);
  if (!record(body)) return { condition: 'incomplete' };
  if (!rpc) return { ...(record(body.state) ? { stateKeys: Object.keys(body.state).length } : {}),
    condition: url.searchParams.get('user_id')?.startsWith('eq.') && url.searchParams.get('updated_at')?.startsWith('eq.') ? 'owner-timestamp' : 'incomplete' };
  const owner = typeof body.p_owner === 'string' && Boolean(body.p_owner);
  return { ...(record(body.p_state) ? { stateKeys: Object.keys(body.p_state).length } : {}),
    ...(record(body.p_expected_state) ? { expectedStateKeys: Object.keys(body.p_expected_state).length } : {}),
    condition: owner && record(body.p_state) && body.p_expected_state === null && body.p_expected_updated_at === null ? 'owner-absent'
      : owner && record(body.p_state) && record(body.p_expected_state) && typeof body.p_expected_updated_at === 'string' && Boolean(body.p_expected_updated_at) ? 'owner-content-version' : 'incomplete' };
}
function responseMetadata(status: number, body: unknown, rpc: boolean, method: string): SyncQaEntry['response'] {
  if (status < 200 || status >= 300) return { status };
  if (rpc) return { status, ...(typeof body === 'boolean' ? { matched: body } : {}) };
  const row = Array.isArray(body) ? body[0] : body;
  return { status, rowCount: Array.isArray(body) ? body.length : record(row) ? 1 : 0,
    ...(method === 'PATCH' ? { matched: Boolean(row) } : {}),
    ...(record(row) && record(row.state) ? { stateKeys: Object.keys(row.state).length } : {}) };
}

export function createSyncQaTrace(options: { origin: string; client: string; send: typeof fetch; maxEntries?: number; holdMs?: number }) {
  const entries: SyncQaEntry[] = [];
  const listeners = new Set<() => void>();
  const held = new Map<number, () => void>();
  const now = () => new Date().toISOString();
  const emit = () => listeners.forEach(listener => listener());
  let rule: Rule | null = null;
  let overflow = false;
  let active = true;
  let inFlight = 0;
  let sequence = 0;
  const snapshot = () => ({ entries: structuredClone(entries), rule, held: [...held.keys()], overflow, active, inFlight });
  const waitForRelease = (entry: SyncQaEntry, signal?: AbortSignal | null) => new Promise<void>((resolve, reject) => {
    const finish = (abort = false) => {
      clearTimeout(timer); held.delete(entry.id); signal?.removeEventListener('abort', onAbort);
      if (abort) reject(new DOMException('Aborted', 'AbortError')); else resolve();
      emit();
    };
    const onAbort = () => finish(true);
    // A forgotten pause becomes an explicit failed request, never a silent send.
    const timer = setTimeout(() => { entry.error = 'QA hold timed out'; finish(true); }, options.holdMs ?? 120_000);
    held.set(entry.id, () => finish());
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) finish(true);
    emit();
  });
  const tracedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const rpc = url.pathname === syncRpcPath && method === 'POST';
    if (!active || url.origin !== options.origin || (!rpc && (url.pathname !== '/rest/v1/user_app_state' || !['GET', 'PATCH', 'POST'].includes(method)))) {
      return options.send(input, init);
    }
    const selected = rule?.method === method ? rule : null;
    // GET retries belong to the SDK. Keep this fault armed until explicit release
    // so a one-off 503 cannot silently turn an intended error case into success.
    if (selected && selected.fault !== 'fail-get') rule = null;
    const entry: SyncQaEntry = { id: ++sequence, client: /^[AB]$/.test(options.client) ? options.client : 'browser', method,
      operation: rpc ? 'conditional-save' : method === 'GET' ? 'read-state' : method === 'PATCH' ? 'legacy-update' : 'legacy-insert',
      startedAt: now(), phase: 'preparing', fault: selected?.fault };
    if (entries.length < (options.maxEntries ?? 100)) entries.push(entry); else overflow = true;
    inFlight++; emit();
    try {
      const raw = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '';
      if (method !== 'GET') entry.request = requestMetadata(raw, rpc, url);
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      signal?.throwIfAborted();
      if (selected?.fault === 'hold-request') { entry.phase = 'held-before-send'; await waitForRelease(entry, signal); }
      if (selected?.fault === 'fail-get') {
        entry.phase = 'synthetic-get-error';
        entry.response = { status: 503, synthetic: true };
        entry.deliveredAt = now();
        return new Response('{"message":"QA simulated GET failure"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      entry.phase = 'sent'; entry.sentAt = now(); emit();
      const response = await options.send(input, init);
      entry.receivedAt = now();
      try { entry.response = responseMetadata(response.status, decodedBody(await response.clone().text()), rpc, method); }
      catch { entry.error = 'Response body capture failed'; }
      if (selected?.fault === 'hold-response') { entry.phase = 'held-after-response'; await waitForRelease(entry, signal); }
      signal?.throwIfAborted();
      if (selected?.fault === 'drop-response') {
        // Actual server response is captured; only delivery to the SDK is rejected.
        entry.phase = 'response-withheld';
        throw new TypeError('QA response withheld after server response');
      }
      entry.phase = 'delivered'; entry.deliveredAt = now();
      return response;
    } catch (error) {
      entry.error ??= entry.phase === 'response-withheld' ? 'QA response withheld'
        : error instanceof Error && error.name === 'AbortError' ? 'AbortError' : 'Fetch failed';
      if (entry.phase !== 'response-withheld') entry.phase = 'rejected';
      throw error;
    } finally { inFlight--; emit(); }
  };
  return {
    fetch: tracedFetch, snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    arm(method: Rule['method'], fault: SyncQaFault) {
      if (!active || held.size || rule) throw new Error('이전 제어를 해제한 뒤 설정하세요.');
      if (fault === 'fail-get' && method !== 'GET') throw new Error('조회 오류는 GET만 선택하세요.');
      rule = { method, fault }; emit();
    },
    release() { rule = null; for (const resume of [...held.values()]) resume(); emit(); },
    clear() { if (inFlight || rule) throw new Error('요청이 끝난 뒤 증거를 비우세요.'); entries.length = 0; overflow = false; emit(); },
    stop() { if (inFlight || rule) throw new Error('대기 제어를 해제하고 요청이 끝난 뒤 종료하세요.'); active = false; entries.length = 0; emit(); },
    exportJson() { return JSON.stringify({ format: 'yeoni-sync-qa-v1', bodyPolicy: 'metadata-only',
      scope: 'Operation, timing, status and counts only. No state, owner, headers, tokens or hashes. Saved-content equality is unverified.', ...snapshot() }, null, 2); },
  };
}

export function isSyncQaAllowed(environment: string | undefined, hostname: string, enabled: boolean) {
  return environment === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname) && enabled;
}

let browserTrace: ReturnType<typeof createSyncQaTrace> | null = null;
export function getDevSyncQaTrace(origin: string) {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  let enabled = params.get('qa-sync') === '1';
  try { enabled ||= window.sessionStorage.getItem('yeoni-qa-sync') === '1'; } catch { /* No persistent opt-in. */ }
  if (!isSyncQaAllowed(process.env.NODE_ENV, window.location.hostname, enabled)) return null;
  if (!browserTrace) {
    try { window.sessionStorage.setItem('yeoni-qa-sync', '1'); } catch { /* Current document only. */ }
    browserTrace = createSyncQaTrace({ origin, client: window.location.host, send: window.fetch.bind(window) });
    if (params.get('qa-hold') === 'get') browserTrace.arm('GET', 'hold-response');
  }
  return browserTrace;
}
