// ISOLATED MOCK CONTRACT ONLY. No app wiring, credentials, fetch or storage.
// A live client adapter and user-facing screen are intentionally not implemented.
const schema = 'yeoni_speech_proof_candidate';
const zeroUuid = '00000000-0000-4000-8000-000000000000';
const nilProof = { p_request_id: null, p_issued_at: null, p_expires_at: null, p_key_id: null, p_mac: null };
export const probes = Object.freeze([
  ...[['keys', 'key_id'], ['policy', 'singleton'], ['total', 'singleton']].map(([table, column]) =>
    Object.freeze({ id: table, kind: 'head', schema, table, column })),
  Object.freeze({ id: 'authorized', kind: 'rpc', schema, name: 'authorized', args: Object.freeze({ ...nilProof, p_action: null, p_payload_hash: null }) }),
  Object.freeze({ id: 'payload', kind: 'rpc', schema, name: 'payload', args: Object.freeze({ p_duration: null, p_text: null, p_audio_hash: null }) }),
  Object.freeze({ id: 'ready', kind: 'rpc', schema, name: 'ready', args: Object.freeze({ p_request_id: zeroUuid, p_issued_at: 0, p_expires_at: 1, p_key_id: 'speech-trial-v1', p_mac: '0'.repeat(64) }) }),
]);
// The ready proof is deliberately expired AND forged. It only exercises denial;
// it cannot establish valid-proof acceptance, secret agreement or Azure readiness.
export function createMockBoundaryFlow(invoke, timers = { set: setTimeout, clear: clearTimeout }) {
  let active = null, owner = null, disposed = false;
  let state = Object.freeze({ outcome: 'idle', checks: [] });
  const publish = (job, outcome) => {
    const snapshot = Object.freeze({ outcome, checks: Object.freeze([...job.checks]) });
    if (active === job) state = snapshot;
    return snapshot;
  };
  const stop = reason => {
    if (!active) return;
    const job = active;
    publish(job, reason); active = null;
    timers.clear(job.timer); job.controller.abort(reason);
  };
  return {
    get state() { return state; },
    setOwner(next) { if (owner !== next) { stop('account-changed'); owner = next; } },
    cancel() { stop('cancelled'); },
    dispose() { disposed = true; stop('disposed'); owner = null; },
    async start() {
      if (disposed || !owner) return { outcome: 'unavailable', checks: [] };
      if (active) return { outcome: 'busy', checks: [] };
      const job = { controller: new AbortController(), checks: [], timer: null };
      active = job; publish(job, 'running');
      const aborted = new Promise(resolve => {
        job.onAbort = () => resolve({ stopped: true });
        job.controller.signal.addEventListener('abort', job.onAbort, { once: true });
      });
      job.timer = timers.set(() => { if (active === job) stop('timeout'); }, 15000);
      try {
        for (const probe of probes) {
          if (active !== job) return { outcome: 'superseded', checks: [] };
          // Convert rejection to a closed status; never inspect message/body/header.
          const pending = Promise.resolve().then(() => {
            if (job.controller.signal.aborted) return { stopped: true };
            return invoke(probe, job.controller.signal);
          }).catch(() => ({ networkFailure: true }));
          const response = await Promise.race([pending, aborted]);
          if (active !== job || response?.stopped) return { outcome: 'superseded', checks: [] };
          if (!response || response.networkFailure) return publish(job, 'network-error');
          const expected = probe.id === 'ready'
            ? response.status === 200 && response.data === false
            : response.status === 403 && response.code === '42501';
          const allowed = response.status >= 200 && response.status < 300;
          const outcome = expected ? 'expected-denial' : allowed ? 'unexpected-allow' : 'inconclusive';
          job.checks.push(Object.freeze({ id: probe.id, outcome }));
          if (!expected) return publish(job, outcome);
        }
        return publish(job, 'mock-denials-confirmed');
      } finally {
        timers.clear(job.timer);
        job.controller.signal.removeEventListener('abort', job.onAbort);
        if (active === job) active = null;
      }
    },
  };
}
