/** Read-only deny probes. No HTTP implementation, token access, storage or logging. */
export type BoundaryProbe = Readonly<{ id: string; table?: string; column?: string; name?: string; args?: Readonly<Record<string, string | number | null>> }>;
const nil = { p_request_id: null, p_issued_at: null, p_expires_at: null, p_key_id: null, p_mac: null };
export const BOUNDARY_PROBES: readonly BoundaryProbe[] = Object.freeze([
  ...[['keys', 'key_id'], ['policy', 'singleton'], ['total', 'singleton']].map(([table, column]) => Object.freeze({ id: table, table, column })),
  Object.freeze({ id: 'authorized', name: 'authorized', args: Object.freeze({ ...nil, p_action: null, p_payload_hash: null }) }),
  Object.freeze({ id: 'payload', name: 'payload', args: Object.freeze({ p_duration: null, p_text: null, p_audio_hash: null }) }),
  Object.freeze({ id: 'ready', name: 'ready', args: Object.freeze({ p_request_id: '00000000-0000-4000-8000-000000000000', p_issued_at: 0, p_expires_at: 1, p_key_id: 'speech-trial-v1', p_mac: '0'.repeat(64) }) }),
]);
export type BoundaryOutcome = 'idle' | 'running' | 'denials-confirmed' | 'unexpected-allow' | 'inconclusive' | 'network-error' | 'account-unavailable' | 'account-changed' | 'cancelled' | 'timeout';
export type BoundaryState = Readonly<{ outcome: BoundaryOutcome; checks: readonly Readonly<{ id: string; status: number; outcome: 'expected-denial' | 'unexpected-allow' | 'inconclusive' }>[] }>;
export type BoundaryResponse = Readonly<{ status: number; data?: unknown }>;
export function createBoundaryCheck(deps: {
  verifyOwner(signal: AbortSignal): Promise<boolean>;
  invoke(probe: BoundaryProbe, signal: AbortSignal): PromiseLike<BoundaryResponse>;
  publish(state: BoundaryState): void;
  timers?: { set(fn: () => void, ms: number): unknown; clear(timer: unknown): void };
}) {
  const timers = deps.timers ?? { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>) };
  let active: { controller: AbortController; timer?: unknown } | null = null, disposed = false;
  const stop = (outcome: 'account-changed' | 'cancelled' | 'timeout', silent = false) => {
    const job = active; active = null;
    if (job) { timers.clear(job.timer); job.controller.abort(); }
    if (!silent && !disposed) deps.publish({ outcome, checks: [] });
  };
  return {
    cancel() { stop('cancelled'); },
    invalidate() { stop('account-changed'); },
    dispose() { disposed = true; stop('cancelled', true); },
    async start() {
      if (active || disposed) return;
      const job = { controller: new AbortController(), timer: undefined as unknown }; active = job;
      const signal = job.controller.signal;
      let onAbort: () => void = () => {};
      const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(new Error('stopped')); signal.addEventListener('abort', onAbort, { once: true }); });
      const checks: BoundaryState['checks'][number][] = [];
      const publish = (outcome: BoundaryOutcome) => { if (active === job && !disposed) deps.publish({ outcome, checks: Object.freeze([...checks]) }); };
      job.timer = timers.set(() => { if (active === job) stop('timeout'); }, 15000);
      publish('running');
      try {
        const verified = await Promise.race([Promise.resolve().then(() => signal.aborted ? false : deps.verifyOwner(signal)), aborted]);
        if (active !== job || signal.aborted) return;
        if (!verified) { publish('account-unavailable'); return; }
        for (const probe of BOUNDARY_PROBES) {
          if (active !== job || signal.aborted) return;
          const response = await Promise.race([Promise.resolve().then(() => signal.aborted ? null : deps.invoke(probe, signal)), aborted]);
          if (active !== job || signal.aborted) return;
          if (!response) { publish('network-error'); return; }
          const status = Number.isInteger(response.status) && response.status >= 0 && response.status <= 599 ? response.status : 0;
          if (status === 0) { publish('network-error'); return; }
          const expected = probe.id === 'ready' ? status === 200 && response.data === false : status === 403;
          const outcome = expected ? 'expected-denial' : status >= 200 && status < 300 ? 'unexpected-allow' : 'inconclusive';
          checks.push({ id: probe.id, status, outcome });
          publish(expected ? 'running' : outcome === 'unexpected-allow' ? 'unexpected-allow' : 'inconclusive');
          if (!expected) return;
        }
        publish('denials-confirmed');
      } catch { publish('network-error'); }
      finally {
        timers.clear(job.timer); signal.removeEventListener('abort', onAbort);
        if (active === job) active = null;
      }
    },
  };
}
