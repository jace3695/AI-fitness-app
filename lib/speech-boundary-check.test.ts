import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import { BOUNDARY_PROBES, createBoundaryCheck, type BoundaryProbe, type BoundaryResponse, type BoundaryState } from './speech-boundary-check.ts';
import { createBoundaryFetch, invokeBoundaryProbe, type BoundaryClient } from './speech-boundary-transport.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const denied = (probe: BoundaryProbe): BoundaryResponse => probe.id === 'ready' ? { status: 200, data: false } : { status: 403 };
function setup(
  invoke: (probe: BoundaryProbe, signal: AbortSignal) => BoundaryResponse | PromiseLike<BoundaryResponse> = denied,
  verifyOwner: (signal: AbortSignal) => Promise<boolean> = async () => true,
) {
  let now = 0;
  let ownerChecks = 0;
  const timers = new Map<unknown, { fn: () => void; at: number }>();
  const delays: number[] = [];
  const calls: { probe: BoundaryProbe; signal: AbortSignal }[] = [];
  const states: BoundaryState[] = [{ outcome: 'idle', checks: [] }];
  const flow = createBoundaryCheck({
    verifyOwner: signal => { ownerChecks++; return verifyOwner(signal); },
    invoke: (probe, signal) => { calls.push({ probe, signal }); return Promise.resolve(invoke(probe, signal)); },
    publish: state => states.push(state),
    timers: {
      set(fn, ms) { const id = Symbol('timer'); delays.push(ms); timers.set(id, { fn, at: now + ms }); return id; },
      clear(id) { timers.delete(id); },
    },
  });
  return {
    flow, calls, states, timers, delays,
    get state() { return states.at(-1)!; },
    get ownerChecks() { return ownerChecks; },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.at <= now) { timers.delete(id); timer.fn(); }
      }
    },
  };
}

test('product state machine is idle without explicit start; verified owner receives the exact six read-only probes once', async () => {
  const s = setup();
  await tick();
  assert.equal(s.calls.length, 0);
  assert.equal(s.ownerChecks, 0);
  await s.flow.start();
  assert.equal(s.state.outcome, 'denials-confirmed');
  assert.deepEqual(s.calls.map(call => call.probe), BOUNDARY_PROBES);
  assert.deepEqual(s.state.checks.map(row => row.id), ['keys', 'policy', 'total', 'authorized', 'payload', 'ready']);
  assert.ok(s.state.checks.every(row => row.outcome === 'expected-denial'));
  assert.ok(s.state.checks.every(row => !('code' in row)));
  assert.equal(s.ownerChecks, 1);
  assert.equal(s.timers.size, 0);
  assert.deepEqual(s.delays, [15000]);
  assert.equal(getEventListeners(s.calls[0].signal, 'abort').length, 0);
});

test('owner verification false or rejected prevents all six requests and never claims a denial pass', async () => {
  for (const fail of [false, true]) {
    const s = setup(denied, async () => {
      if (fail) throw Error('SYNTHETIC_PRIVATE_OWNER_DIAGNOSTIC');
      return false;
    });
    await s.flow.start();
    assert.equal(s.state.outcome, fail ? 'network-error' : 'account-unavailable');
    assert.equal(s.calls.length, 0);
    assert.equal(s.timers.size, 0);
    assert.ok(!JSON.stringify(s.states).includes('SYNTHETIC_PRIVATE_OWNER_DIAGNOSTIC'));
  }
});

test('product HEAD/RPC 403 outcomes depend on raw HTTP status, never SQLSTATE or private response properties', async () => {
  const s = setup(probe => {
    const response = denied(probe);
    for (const name of ['code', 'body', 'headers', 'error', 'message', 'token', 'key']) {
      Object.defineProperty(response, name, { get() { throw Error('forbidden response read'); } });
    }
    if (probe.id !== 'ready') Object.defineProperty(response, 'data', { get() { throw Error('internal data read forbidden'); } });
    return response;
  });
  await s.flow.start();
  assert.equal(s.state.outcome, 'denials-confirmed');
  assert.ok(s.state.checks.every(row => Object.keys(row).sort().join(',') === 'id,outcome,status'));
});

test('401, raw 404, redirect and server failure are inconclusive and stop immediately', async () => {
  for (const status of [401, 404, 300, 500, 503, 520]) {
    const s = setup(() => ({ status }));
    await s.flow.start();
    assert.equal(s.state.outcome, 'inconclusive');
    assert.equal(s.calls.length, 1);
    assert.equal(s.state.checks[0].status, status);
    assert.equal(s.timers.size, 0);
  }
});

test('missing/invalid status or network rejection is not a denial and sends no next probe', async () => {
  for (const status of [0, -1, 600, NaN, Infinity, 403.5]) {
    const s = setup(() => ({ status }));
    await s.flow.start();
    assert.equal(s.state.outcome, 'network-error');
    assert.equal(s.calls.length, 1);
    assert.equal(s.state.checks.length, 0);
  }
  const s = setup(() => { throw Error('SYNTHETIC_PRIVATE_TRANSPORT_DIAGNOSTIC'); });
  await s.flow.start();
  assert.equal(s.state.outcome, 'network-error');
  assert.equal(s.calls.length, 1);
  assert.ok(!JSON.stringify(s.states).includes('SYNTHETIC_PRIVATE_TRANSPORT_DIAGNOSTIC'));
});

test('any unexpectedly allowed table/internal RPC immediately stops at that stage', async () => {
  for (let position = 0; position < 5; position++) {
    let index = 0;
    const s = setup(probe => index++ === position ? { status: 200 } : denied(probe));
    await s.flow.start();
    assert.equal(s.state.outcome, 'unexpected-allow');
    assert.equal(s.calls.length, position + 1);
    assert.equal(s.state.checks.at(-1)?.outcome, 'unexpected-allow');
    assert.equal(s.timers.size, 0);
  }
});

test('ready requires exactly HTTP 200 and boolean false, not true/null/string/object or alternate success', async () => {
  for (const response of [
    { status: 200, data: true }, { status: 200, data: null }, { status: 200, data: 'false' },
    { status: 200, data: {} }, { status: 200 }, { status: 201, data: false }, { status: 204, data: false },
  ]) {
    const s = setup(probe => probe.id === 'ready' ? response : denied(probe));
    await s.flow.start();
    assert.equal(s.state.outcome, 'unexpected-allow');
    assert.equal(s.calls.length, 6);
    assert.equal(s.timers.size, 0);
  }
});

test('duplicate start while owner or first query is pending does not duplicate auth or transport work', async () => {
  for (const stage of ['owner', 'query']) {
    const wait = deferred<BoundaryResponse>();
    const owner = deferred<boolean>();
    const s = setup(() => wait.promise, () => stage === 'owner' ? owner.promise : Promise.resolve(true));
    const first = s.flow.start();
    await tick();
    await s.flow.start();
    assert.equal(s.ownerChecks, 1);
    assert.equal(s.calls.length, stage === 'owner' ? 0 : 1);
    assert.equal(s.timers.size, 1);
    s.flow.cancel();
    await first;
    owner.resolve(true);
    wait.resolve({ status: 200 });
    await tick();
    assert.equal(s.state.outcome, 'cancelled');
    assert.equal(s.timers.size, 0);
  }
});

test('cancel clears partial results, aborts outstanding work and ignores late resolution or rejection', async () => {
  for (const lateReject of [false, true]) {
    const wait = deferred<BoundaryResponse>();
    const s = setup(probe => probe.id === 'policy' ? wait.promise : denied(probe));
    const run = s.flow.start();
    await tick();
    assert.equal(s.state.checks.length, 1);
    s.flow.cancel();
    await run;
    assert.equal(s.state.outcome, 'cancelled');
    assert.deepEqual(s.state.checks, []);
    assert.equal(s.calls[1].signal.aborted, true);
    const snapshotCount = s.states.length;
    if (lateReject) wait.reject(Error('late synthetic rejection'));
    else wait.resolve({ status: 200 });
    await tick();
    assert.equal(s.states.length, snapshotCount);
    assert.equal(s.calls.length, 2);
    assert.equal(s.timers.size, 0);
    assert.equal(getEventListeners(s.calls[1].signal, 'abort').length, 0);
  }
});

test('account A to B to A invalidates the old job even when late transport ignores abort', async () => {
  const wait = deferred<BoundaryResponse>();
  let first = true;
  const s = setup(probe => {
    if (first) { first = false; return wait.promise; }
    return denied(probe);
  });
  const old = s.flow.start();
  await tick();
  s.flow.invalidate();
  s.flow.invalidate();
  assert.equal(s.state.outcome, 'account-changed');
  assert.deepEqual(s.state.checks, []);
  assert.equal(s.calls[0].signal.aborted, true);
  await s.flow.start();
  assert.equal(s.state.outcome, 'denials-confirmed');
  const snapshotCount = s.states.length;
  wait.resolve({ status: 200 });
  await old;
  await tick();
  assert.equal(s.states.length, snapshotCount);
  assert.equal(s.calls.length, 7);
  assert.equal(s.ownerChecks, 2);
  assert.equal(s.timers.size, 0);
});

test('15-second timeout covers both owner verification and query; 14999ms is still running and no retries occur', async () => {
  for (const stage of ['owner', 'query']) {
    const owner = deferred<boolean>();
    const query = deferred<BoundaryResponse>();
    const s = setup(() => query.promise, () => stage === 'owner' ? owner.promise : Promise.resolve(true));
    const run = s.flow.start();
    await tick();
    assert.deepEqual(s.delays, [15000]);
    s.advance(14999);
    assert.equal(s.state.outcome, 'running');
    s.advance(1);
    await run;
    assert.equal(s.state.outcome, 'timeout');
    assert.deepEqual(s.state.checks, []);
    assert.equal(s.calls.length, stage === 'owner' ? 0 : 1);
    const snapshotCount = s.states.length;
    owner.resolve(true);
    if (stage === 'query') query.reject(Error('late synthetic timeout result'));
    else query.resolve({ status: 200 });
    await tick();
    assert.equal(s.states.length, snapshotCount);
    assert.equal(s.timers.size, 0);
  }
});

test('dispose aborts and releases pending work, publishes no new state and permanently prevents restart', async () => {
  const wait = deferred<BoundaryResponse>();
  const s = setup(() => wait.promise);
  const run = s.flow.start();
  await tick();
  const snapshotCount = s.states.length;
  s.flow.dispose();
  await run;
  wait.resolve({ status: 200 });
  await tick();
  await s.flow.start();
  assert.equal(s.states.length, snapshotCount);
  assert.equal(s.calls.length, 1);
  assert.equal(s.ownerChecks, 1);
  assert.equal(s.calls[0].signal.aborted, true);
  assert.equal(s.timers.size, 0);
});

test('a completed failure may be retried only by a later explicit start', async () => {
  let first = true;
  const s = setup(probe => {
    if (first) { first = false; return { status: 503 }; }
    return denied(probe);
  });
  await s.flow.start();
  assert.equal(s.state.outcome, 'inconclusive');
  await tick();
  assert.equal(s.calls.length, 1);
  await s.flow.start();
  assert.equal(s.state.outcome, 'denials-confirmed');
  assert.equal(s.calls.length, 7);
  assert.equal(s.ownerChecks, 2);
});

test('real SDK + product flow completes six exact synthetic probes; no real account or network is used', async () => {
  const url = 'http://127.0.0.1:54321';
  const calls: { url: string; method: string | undefined }[] = [];
  const sdk = createClient(url, 'sb_publishable_synthetic_boundary_only', {
    global: { fetch: createBoundaryFetch(async (input, init) => {
      const target = String(input);
      assert.ok(target.startsWith(`${url}/rest/v1/`));
      calls.push({ url: target, method: init?.method });
      return target.endsWith('/rpc/ready') ? Response.json(false) : new Response(null, { status: 403 });
    }, url) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const s = setup((probe, signal) => invokeBoundaryProbe(sdk as BoundaryClient, probe, signal));
  await s.flow.start();
  assert.equal(s.state.outcome, 'denials-confirmed');
  assert.deepEqual(calls.map(call => call.method), ['HEAD', 'HEAD', 'HEAD', 'POST', 'POST', 'POST']);
  assert.equal(calls.length, 6);
  assert.equal(s.state.checks.length, 6);
  assert.ok(!JSON.stringify(s.states).includes('key_id'));
  assert.ok(!JSON.stringify(s.states).includes('p_mac'));
});
