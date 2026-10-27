import { BOUNDARY_PROBES, type BoundaryProbe, type BoundaryResponse } from './speech-boundary-check.ts';

type Query = PromiseLike<unknown> & { abortSignal(signal: AbortSignal): Query; retry(enabled: boolean): Query };
export type BoundaryClient = {
  auth: {
    getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
    onAuthStateChange(callback: (event: string, session: { user: { id: string } } | null) => void): { data: { subscription: { unsubscribe(): void } } };
  };
  schema(name: string): { from(table: string): { select(column: string, options: { head: true }): Query }; rpc(name: string, args: Readonly<Record<string, string | number | null>>): Query };
};
const SCHEMA = 'yeoni_speech_proof_candidate';
const MAX_BOOLEAN_BYTES = 16;
type Lease = { probe: BoundaryProbe; sent: boolean; response?: BoundaryResponse };
const leases = new WeakMap<AbortSignal, Lease>();

// Neither request credentials nor response errors/data are inspected. The SDK
// retains normal session handling. Only the two non-secret schema headers matter.
function profile(init: RequestInit, name: string) {
  if (!(init.headers instanceof Headers)) return null;
  return init.headers.get(name);
}
function matches(input: RequestInfo | URL, init: RequestInit, url: string, probe: BoundaryProbe) {
  if (typeof input !== 'string' && !(input instanceof URL)) return false;
  const expected = new URL(`${url}/rest/v1/${probe.table ?? `rpc/${probe.name}`}`);
  if (probe.table) expected.searchParams.set('select', probe.column!);
  return String(input) === expected.href
    && init.method === (probe.table ? 'HEAD' : 'POST')
    && profile(init, probe.table ? 'Accept-Profile' : 'Content-Profile') === SCHEMA
    && (probe.table ? init.body === undefined : init.body === JSON.stringify(probe.args));
}

function discard(response: Response) {
  // Cancellation is best-effort and must not delay stopping a run.
  void response.body?.cancel().catch(() => {});
}

async function smallBoolean(response: Response, signal: AbortSignal): Promise<boolean | undefined> {
  const length = response.headers.get('content-length');
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
    || (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BOOLEAN_BYTES))) {
    discard(response); return;
  }
  if (!response.body) return;
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const bytes = new Uint8Array(MAX_BOOLEAN_BYTES);
  let size = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (size + value.byteLength > MAX_BOOLEAN_BYTES) { cancel(); return; }
      bytes.set(value, size); size += value.byteLength;
    }
    // Only JSON boolean literals are accepted, never objects, strings or arrays.
    const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, size));
    if (/^[ \t\r\n]*false[ \t\r\n]*$/.test(value)) return false;
    if (/^[ \t\r\n]*true[ \t\r\n]*$/.test(value)) return true;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Install once on the existing singleton; unrelated traffic is unchanged. */
export function createBoundaryFetch(next: typeof fetch, supabaseUrl: string): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal;
    const lease = signal ? leases.get(signal) : undefined;
    if (!lease) return next(input, init);
    signal!.throwIfAborted();
    if (lease.sent || !matches(input, init!, supabaseUrl, lease.probe)) throw new Error('Diagnostic request refused');
    lease.sent = true;
    // No redirects, response caching or retry. Authentication headers are passed
    // through as the same object, never read, copied, logged or rewritten here.
    const response = await next(input, { ...init, cache: 'no-store', redirect: 'error' });
    if (signal!.aborted) { discard(response); signal!.throwIfAborted(); }
    lease.response = { status: response.status };
    if (lease.probe.id === 'ready' && response.status === 200) {
      const data = await smallBoolean(response, signal!);
      lease.response = { status: response.status, data };
    } else discard(response);
    // PostgREST eagerly parses response bodies and rewrites empty 404 to 204.
    // It sees only this synthetic empty response; callers use raw status above.
    return new Response(null, { status: 204 });
  };
}

export async function invokeBoundaryProbe(client: BoundaryClient, probe: BoundaryProbe, signal: AbortSignal): Promise<BoundaryResponse> {
  signal.throwIfAborted();
  if (!BOUNDARY_PROBES.includes(probe) || leases.has(signal)) throw new Error('Diagnostic request refused');
  const lease: Lease = { probe, sent: false };
  leases.set(signal, lease);
  try {
    const api = client.schema(SCHEMA);
    const query = probe.table
      ? api.from(probe.table).select(probe.column!, { head: true })
      : api.rpc(probe.name!, probe.args!);
    await query.abortSignal(signal).retry(false);
    signal.throwIfAborted();
    return lease.response ?? { status: 0 };
  } finally { leases.delete(signal); }
}
