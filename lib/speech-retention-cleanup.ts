/** Unscheduled, injected maintenance candidate. No environment lookup, DB client,
 * provider call, persistent log or timer is created at import/construction time.
 * Local health is NOT a hosted scheduler/DB heartbeat or a deletion SLA proof. */
export type SpeechCleanupConfig = Readonly<{
  policyHash: string;
  intervalSeconds: number;
  startDelaySeconds: number;
  runTimeoutSeconds: number;
}>;
export type SpeechCleanupClock = Readonly<{wallTimeMs: number; monotonicTimeMs: number}>;
export type SpeechCleanupConfirmation = Readonly<{policyHash: string; deletedRows: number}>;
export type SpeechCleanupDependencies = Readonly<{
  clock(): SpeechCleanupClock;
  purge(signal: AbortSignal): Promise<SpeechCleanupConfirmation>;
  timers: Readonly<{setTimeout(callback: () => void, delayMs: number): unknown; clearTimeout(handle: unknown): void}>;
}>;
export type SpeechCleanupState = Readonly<{
  state: 'unconfigured'|'running'|'confirmed'|'degraded'|'uncertain'|'failed'|'busy'|'disposed';
  reason: 'not-configured'|'not-run'|'running'|'confirmed'|'invalid-clock'|'clock-anomaly'|'invalid-due'
    |'early-tick'|'duplicate-tick'|'out-of-order-tick'|'missed-tick'|'irregular-tick'|'late-start'
    |'busy'|'timeout'|'purge-failed'|'invalid-confirmation'|'timer-failed'|'stale-heartbeat'|'disposed';
  healthy: boolean;
  dueAtMs: number|null;
  completedAtMs: number|null;
  healthyUntilMs: number|null;
}>;

// Resolution tolerance for a paired integer wall clock / fractional monotonic
// sample, not a selected operational clock-skew allowance. Larger drift closes
// health until a new runner is deliberately constructed; cleanup may continue.
const CLOCK_RESOLUTION_MS = 2;
const hash = /^[a-f0-9]{64}$/;
function schedule(config: SpeechCleanupConfig|null) {
  if (!config || typeof config.policyHash !== 'string' || !hash.test(config.policyHash)
    || !Number.isSafeInteger(config.intervalSeconds) || config.intervalSeconds <= 0
    || !Number.isSafeInteger(config.startDelaySeconds) || config.startDelaySeconds < 0
    || !Number.isSafeInteger(config.runTimeoutSeconds) || config.runTimeoutSeconds <= 0) return null;
  const intervalMs = config.intervalSeconds * 1000, startDelayMs = config.startDelaySeconds * 1000;
  const timeoutMs = config.runTimeoutSeconds * 1000, boundMs = intervalMs + startDelayMs + timeoutMs;
  if (![intervalMs, startDelayMs, timeoutMs, boundMs].every(Number.isSafeInteger)) return null;
  return {policyHash: config.policyHash, intervalMs, startDelayMs, timeoutMs, boundMs};
}

/** One call is one nominal tick, never a scheduler. The caller's reviewed purge
 * capability is independent of trial/provider flags; none are consulted here.
 * A future maintenance adapter must obtain a real commit acknowledgement, not
 * fabricate this confirmation from a timeout or a caller-controlled timestamp. */
export function createSpeechRetentionCleanupRunner(config: SpeechCleanupConfig|null = null, deps?: SpeechCleanupDependencies) {
  const cfg = schedule(config);
  const configured = !!cfg && !!deps && typeof deps.clock === 'function' && typeof deps.purge === 'function'
    && typeof deps.timers?.setTimeout === 'function' && typeof deps.timers?.clearTimeout === 'function';
  let status: SpeechCleanupState = {state: configured ? 'degraded' : 'unconfigured', reason: configured ? 'not-run' : 'not-configured', healthy: false, dueAtMs: null, completedAtMs: null, healthyUntilMs: null};
  let disposed = false, generation = 0, lastClock: SpeechCleanupClock|null = null, clockUntrusted = false;
  let lastDue: number|null = null, healthyUntilMonotonic: number|null = null;
  let active: {controller: AbortController; settle(value: SpeechCleanupState): void; timer?: unknown}|null = null;
  const copy = (): SpeechCleanupState => ({...status});
  function close(state: SpeechCleanupState['state'], reason: SpeechCleanupState['reason']) {
    generation++; healthyUntilMonotonic = null;
    status = {...status, state, reason, healthy: false, healthyUntilMs: null};
    return copy();
  }
  function sample(): SpeechCleanupClock|null {
    let now: SpeechCleanupClock;
    try { const value = deps!.clock(); now = {wallTimeMs: value.wallTimeMs, monotonicTimeMs: value.monotonicTimeMs}; }
    catch { clockUntrusted = true; close('degraded', 'invalid-clock'); return null; }
    if (!now || !Number.isSafeInteger(now.wallTimeMs) || now.wallTimeMs < 0
      || !Number.isFinite(now.monotonicTimeMs) || now.monotonicTimeMs < 0 || now.monotonicTimeMs > Number.MAX_SAFE_INTEGER) {
      clockUntrusted = true; close('degraded', 'invalid-clock'); return null;
    }
    if (lastClock && (now.wallTimeMs < lastClock.wallTimeMs || now.monotonicTimeMs < lastClock.monotonicTimeMs
      || Math.abs((now.wallTimeMs - lastClock.wallTimeMs) - (now.monotonicTimeMs - lastClock.monotonicTimeMs)) > CLOCK_RESOLUTION_MS)) {
      clockUntrusted = true; close('degraded', 'clock-anomaly');
    }
    // Copy the injected sample so later caller mutation cannot alter the baseline.
    lastClock = {wallTimeMs: now.wallTimeMs, monotonicTimeMs: now.monotonicTimeMs};
    return lastClock;
  }
  function snapshot(): SpeechCleanupState {
    if (!configured || disposed) return copy();
    const now = sample();
    if (now && status.healthy && (status.healthyUntilMs === null || healthyUntilMonotonic === null
      || now.wallTimeMs >= status.healthyUntilMs || now.monotonicTimeMs >= healthyUntilMonotonic)) close('degraded', 'stale-heartbeat');
    return copy();
  }
  function clearTimer(job: NonNullable<typeof active>) {
    if (job.timer !== undefined) { try { deps!.timers.clearTimeout(job.timer); } catch { /* No success is inferred from timer cleanup. */ } job.timer = undefined; }
  }
  async function tick(dueAtMs: number): Promise<SpeechCleanupState> {
    if (!configured || disposed) return copy();
    const started = sample(); if (!started) return copy();
    if (active) return close('busy', 'busy'); // Invalidates the in-flight health claim, not its DB work.
    if (!Number.isSafeInteger(dueAtMs) || dueAtMs < 0 || !Number.isSafeInteger(dueAtMs + cfg!.boundMs)) return close('degraded', 'invalid-due');
    if (dueAtMs > started.wallTimeMs) return close('degraded', 'early-tick');
    if (lastDue !== null && dueAtMs <= lastDue) return close('degraded', dueAtMs === lastDue ? 'duplicate-tick' : 'out-of-order-tick');
    let violation: SpeechCleanupState['reason']|null = clockUntrusted ? 'clock-anomaly' : null;
    if (!violation && lastDue !== null && dueAtMs - lastDue !== cfg!.intervalMs) violation = dueAtMs - lastDue > cfg!.intervalMs ? 'missed-tick' : 'irregular-tick';
    if (!violation && started.wallTimeMs - dueAtMs > cfg!.startDelayMs) violation = 'late-start';
    lastDue = dueAtMs;
    const token = ++generation;
    healthyUntilMonotonic = null;
    status = {state: 'running', reason: 'running', healthy: false, dueAtMs, completedAtMs: null, healthyUntilMs: null};
    const controller = new AbortController();
    let resolve!: (value: SpeechCleanupState) => void, settled = false;
    const result = new Promise<SpeechCleanupState>(done => { resolve = done; });
    const job = {controller, timer: undefined as unknown, settle(value: SpeechCleanupState) { if (!settled) { settled = true; resolve(value); } }};
    active = job;
    try {
      job.timer = deps!.timers.setTimeout(() => {
        if (active !== job || settled) return;
        job.settle(close('uncertain', 'timeout'));
        controller.abort(); // Stop waiting is not proof that SQL stopped or rolled back.
      }, cfg!.timeoutMs);
    } catch { active = null; return close('failed', 'timer-failed'); }
    // A broken injected timer may fire synchronously. Even then, do not start
    // work after its waiting deadline has already closed.
    if (settled || controller.signal.aborted) { clearTimer(job); active = null; return result; }
    let work: Promise<SpeechCleanupConfirmation>;
    try { work = Promise.resolve(deps!.purge(controller.signal)); } catch { work = Promise.reject(Error('purge failed')); }
    void work.then(value => {
      if (settled || disposed) return;
      const now = sample();
      if (!now || token !== generation) { job.settle(copy()); return; }
      if (now.monotonicTimeMs - started.monotonicTimeMs >= cfg!.timeoutMs) { job.settle(close('uncertain', 'timeout')); controller.abort(); return; }
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'deletedRows,policyHash'
        || value.policyHash !== cfg!.policyHash || !Number.isInteger(value.deletedRows) || value.deletedRows < 0 || value.deletedRows > 1) {
        job.settle(close('failed', 'invalid-confirmation')); return;
      }
      if (violation || clockUntrusted) { job.settle(close('degraded', violation ?? 'clock-anomaly')); return; }
      const until = dueAtMs + cfg!.boundMs;
      if (now.wallTimeMs >= until) { job.settle(close('degraded', 'stale-heartbeat')); return; }
      healthyUntilMonotonic = now.monotonicTimeMs + until - now.wallTimeMs;
      status = {state: 'confirmed', reason: 'confirmed', healthy: true, dueAtMs, completedAtMs: now.wallTimeMs, healthyUntilMs: until};
      job.settle(copy());
    }, () => { if (!settled && !disposed) job.settle(token === generation ? close('failed', 'purge-failed') : copy()); })
      .catch(() => { if (!settled && !disposed) job.settle(token === generation ? close('failed', 'invalid-confirmation') : copy()); })
      .finally(() => { clearTimer(job); if (active === job) active = null; });
    // On timeout/abort, active remains occupied until the original dependency
    // settles; a non-cooperative operation cannot spawn overlapping retries.
    return result;
  }
  function dispose() {
    if (disposed) return;
    disposed = true; const value = close('disposed', 'disposed');
    if (active) { clearTimer(active); active.settle(value); active.controller.abort(); }
  }
  return {tick, snapshot, dispose};
}
