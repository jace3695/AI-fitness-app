import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechRetentionCleanupRunner, type SpeechCleanupConfig, type SpeechCleanupConfirmation} from './speech-retention-cleanup.ts';

// Deliberately synthetic times and contract. No production duration or schedule.
const policyHash = 'a'.repeat(64);
const config: SpeechCleanupConfig = {policyHash, intervalSeconds: 10, startDelaySeconds: 2, runTimeoutSeconds: 3};
const good = (): SpeechCleanupConfirmation => ({policyHash, deletedRows: 1});
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function fixture(purge: (signal: AbortSignal) => Promise<SpeechCleanupConfirmation> = async () => good(), cfg: SpeechCleanupConfig|null = config) {
  let wall = 100000, mono = 50000, calls = 0, serial = 0;
  const timers = new Map<number, {at: number; callback: () => void}>();
  const runner = createSpeechRetentionCleanupRunner(cfg, {
    clock: () => ({wallTimeMs: wall, monotonicTimeMs: mono}),
    purge: signal => { calls++; return purge(signal); },
    timers: {
      setTimeout(callback, delayMs) { const id = ++serial; timers.set(id, {at: mono + delayMs, callback}); return id; },
      clearTimeout(handle) { timers.delete(handle as number); },
    },
  });
  return {runner, calls: () => calls, timers: () => timers.size,
    advance(ms: number, fire = true) { wall += ms; mono += ms; if (fire) for (const [id, value] of [...timers]) if (value.at <= mono) { timers.delete(id); value.callback(); } },
    jump(wallMs: number, monotonicMs = 0) { wall += wallMs; mono += monotonicMs; },
  };
}

test('default/malformed config has no side effect, timer or health', async () => {
  assert.equal(createSpeechRetentionCleanupRunner().snapshot().state, 'unconfigured');
  assert.equal((await createSpeechRetentionCleanupRunner(config).tick(100000)).state, 'unconfigured');
  for (const patch of [{intervalSeconds: 0}, {intervalSeconds: 0.5}, {startDelaySeconds: -1}, {runTimeoutSeconds: 0}, {runTimeoutSeconds: Infinity}, {policyHash: ''}]) {
    const f = fixture(undefined, {...config, ...patch}); assert.equal((await f.runner.tick(100000)).state, 'unconfigured'); assert.equal(f.calls(), 0); assert.equal(f.timers(), 0);
  }
});
test('on-time confirmation is bounded by nominal dueAt + I + J + Q, not completion time', async () => {
  let release!: (v: SpeechCleanupConfirmation) => void;
  const f = fixture(() => new Promise(r => { release = r; }));
  assert.equal(f.calls(), 0); assert.equal(f.timers(), 0);
  f.advance(1000); const pending = f.runner.tick(100000); f.advance(2000); release(good());
  const result = await pending; assert.equal(result.healthy, true); assert.equal(result.completedAtMs, 103000); assert.equal(result.healthyUntilMs, 115000);
  await flush(); assert.equal(f.timers(), 0); f.advance(11999); assert.equal(f.runner.snapshot().healthy, true);
  f.advance(1); assert.equal(f.runner.snapshot().reason, 'stale-heartbeat'); assert.equal(f.runner.snapshot().healthy, false);
});
test('late start and missed or irregular ticks can clean best-effort but cannot claim health', async () => {
  const late = fixture(); late.advance(2001); assert.equal((await late.runner.tick(100000)).reason, 'late-start'); assert.equal(late.calls(), 1);
  for (const gap of [5000, 20000]) {
    const f = fixture(); assert.equal((await f.runner.tick(100000)).healthy, true); await flush(); f.advance(gap);
    assert.equal((await f.runner.tick(100000 + gap)).reason, gap === 5000 ? 'irregular-tick' : 'missed-tick'); assert.equal(f.calls(), 2);
  }
});
test('duplicate/out-of-order/early/invalid tick closes health and does not dispatch again', async () => {
  for (const [due, reason] of [[100000, 'duplicate-tick'], [90000, 'out-of-order-tick'], [100001, 'early-tick'], [NaN, 'invalid-due']] as const) {
    const f = fixture(); await f.runner.tick(100000); await flush(); assert.equal((await f.runner.tick(due)).reason, reason); assert.equal(f.calls(), 1); assert.equal(f.runner.snapshot().healthy, false);
  }
});
test('timeout remains uncertain, holds non-cooperative work and ignores late success', async () => {
  let release!: (v: SpeechCleanupConfirmation) => void, aborted = false;
  const f = fixture(signal => { signal.addEventListener('abort', () => { aborted = true; }); return new Promise(r => { release = r; }); });
  const pending = f.runner.tick(100000); f.advance(3000);
  assert.equal((await pending).state, 'uncertain'); assert.equal(aborted, true);
  f.advance(7000); assert.equal((await f.runner.tick(110000)).state, 'busy'); assert.equal(f.calls(), 1);
  release(good()); await flush(); assert.equal(f.runner.snapshot().healthy, false); assert.equal(f.calls(), 1);
});
test('completion after Q cannot restore health even if the timer callback was delayed', async () => {
  let release!: (v: SpeechCleanupConfirmation) => void;
  const f = fixture(() => new Promise(r => { release = r; })); const pending = f.runner.tick(100000);
  f.advance(3000, false); release(good()); assert.equal((await pending).state, 'uncertain'); await flush(); assert.equal(f.runner.snapshot().healthy, false);
});
test('overlapping tick invalidates in-flight health, and a fresh on-time later tick can recover', async () => {
  let release!: (v: SpeechCleanupConfirmation) => void;
  const f = fixture(() => new Promise(r => { release = r; })); const first = f.runner.tick(100000);
  assert.equal((await f.runner.tick(100000)).state, 'busy'); release(good()); assert.equal((await first).healthy, false); await flush();
  f.advance(10000); const next = f.runner.tick(110000); release(good()); assert.equal((await next).healthy, true);
});
test('failure or malformed/foreign confirmation emits no dependency error or user fields', async () => {
  for (const outcome of [null, {policyHash: 'b'.repeat(64), deletedRows: 1}, {policyHash, deletedRows: 2}, {policyHash, deletedRows: -1}, {policyHash, deletedRows: 0.5}, {policyHash, deletedRows: 1, owner: 'private-marker'}]) {
    const f = fixture(async () => outcome as SpeechCleanupConfirmation); const result = await f.runner.tick(100000);
    assert.equal(result.reason, 'invalid-confirmation'); assert.equal(JSON.stringify(result).includes('private-marker'), false);
  }
  const f = fixture(async () => { throw Error('private-owner-audio-score'); }); const result = await f.runner.tick(100000);
  assert.equal(result.reason, 'purge-failed'); assert.equal(JSON.stringify(result).includes('private-owner-audio-score'), false);
});
test('zero-row purge and provider/trial OFF are independent of authorized maintenance', async () => {
  // No trial or provider activation field is accepted or read by the runner.
  const f = fixture(async () => ({policyHash, deletedRows: 0})); assert.equal((await f.runner.tick(100000)).healthy, true); assert.equal(f.calls(), 1);
  assert.deepEqual(Object.keys(f.runner.snapshot()).sort(), ['completedAtMs', 'dueAtMs', 'healthy', 'healthyUntilMs', 'reason', 'state']);
});
test('wall jumps and monotonic reset never make an old confirmation fresh again', async () => {
  for (const [wall, mono] of [[-1000, 0], [1000, 0], [0, -1000]] as const) {
    const f = fixture(); await f.runner.tick(100000); await flush(); f.jump(wall, mono);
    assert.equal(f.runner.snapshot().reason, 'clock-anomaly'); assert.equal(f.runner.snapshot().healthy, false);
    // Even later successful cleanup cannot erase this runner's clock incident.
    f.advance(20000); const result = await f.runner.tick(110000); assert.equal(result.healthy, false);
  }
});
test('dispose resolves waiting callers without assuming SQL cancellation and blocks future ticks', async () => {
  let release!: (v: SpeechCleanupConfirmation) => void;
  const f = fixture(() => new Promise(r => { release = r; })); const pending = f.runner.tick(100000);
  f.runner.dispose(); assert.equal((await pending).state, 'disposed'); assert.equal(f.timers(), 0);
  release(good()); await flush(); assert.equal((await f.runner.tick(110000)).state, 'disposed'); assert.equal(f.calls(), 1);
});
test('broken clock or timer cannot dispatch work or manufacture a healthy result', async () => {
  for (const mode of ['clock-throws', 'invalid-clock', 'timer-throws', 'synchronous-timeout']) {
    let calls = 0;
    const runner = createSpeechRetentionCleanupRunner(config, {
      clock: () => { if (mode === 'clock-throws') throw Error('private-clock'); return {wallTimeMs: 100000, monotonicTimeMs: mode === 'invalid-clock' ? NaN : 50000}; },
      purge: async () => { calls++; return good(); },
      timers: {setTimeout(callback) { if (mode === 'timer-throws') throw Error('private-timer'); callback(); return 1; }, clearTimeout() {}},
    });
    const result = await runner.tick(100000); assert.equal(result.healthy, false); assert.equal(calls, 0); assert.equal(JSON.stringify(result).includes('private'), false);
  }
});
test('a throwing confirmation getter is contained and cannot leave the caller waiting or leak details', async () => {
  const value = {deletedRows: 1, get policyHash(): string { throw Error('private-response'); }};
  const f = fixture(async () => value); const result = await f.runner.tick(100000);
  assert.equal(result.reason, 'invalid-confirmation'); assert.equal(result.healthy, false); assert.equal(JSON.stringify(result).includes('private-response'), false);
});
