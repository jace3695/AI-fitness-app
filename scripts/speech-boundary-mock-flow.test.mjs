import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockBoundaryFlow, probes } from './speech-boundary-mock-flow.mjs';
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const deny = p => p.id === 'ready' ? { status: 200, data: false } : { status: 403, code: '42501' };
function setup(invoke = deny) {
  const calls = [], timers = new Set();
  const flow = createMockBoundaryFlow((p, signal) => { calls.push({ p, signal }); return invoke(p, signal); }, {
    set(fn) { timers.add(fn); return fn; }, clear(fn) { timers.delete(fn); },
  });
  flow.setOwner('synthetic-A');
  return { flow, calls, timers };
}
test('six mock probes: HEAD only, null internal args, forged expired ready; consume/finish absent', async () => {
  const { flow, calls, timers } = setup();
  assert.equal((await flow.start()).outcome, 'mock-denials-confirmed');
  assert.deepEqual(calls.map(c => c.p.id), ['keys', 'policy', 'total', 'authorized', 'payload', 'ready']);
  assert.ok(calls.slice(0, 3).every(c => c.p.kind === 'head'));
  assert.ok(calls.slice(3, 5).every(c => Object.values(c.p.args).every(v => v === null)));
  assert.equal(calls[5].p.args.p_mac, '0'.repeat(64));
  assert.equal(calls[5].p.args.p_expires_at, 1);
  assert.ok(!calls.some(c => ['consume', 'finish'].includes(c.p.name)));
  assert.equal(timers.size, 0);
});
test('network rejection is not a confirmed denial and stops subsequent probes', async () => {
  const { flow, calls } = setup(() => { throw Error('SYNTHETIC_PRIVATE_MESSAGE'); });
  assert.equal((await flow.start()).outcome, 'network-error'); assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(flow.state).includes('SYNTHETIC_PRIVATE_MESSAGE'));
});
test('401/404/500 and wrong error codes are inconclusive, never security passes', async () => {
  for (const response of [{ status: 401, code: '42501' }, { status: 404, code: 'PGRST202' }, { status: 500 }, { status: 403, code: 'other' }]) {
    const { flow, calls } = setup(() => response);
    assert.equal((await flow.start()).outcome, 'inconclusive'); assert.equal(calls.length, 1);
  }
});
test('unexpected allowed table or internal function immediately stops', async () => {
  for (const position of [0, 1, 2, 3, 4]) {
    let n = 0; const { flow, calls } = setup(p => n++ === position ? { status: 200 } : deny(p));
    assert.equal((await flow.start()).outcome, 'unexpected-allow'); assert.equal(calls.length, position + 1);
  }
});
test('ready true or malformed successful result is not accepted', async () => {
  for (const data of [true, null, 'false', {}]) {
    const { flow } = setup(p => p.id === 'ready' ? { status: 200, data } : deny(p));
    assert.equal((await flow.start()).outcome, 'unexpected-allow');
  }
});
test('duplicate click does not start another request; explicit retry works after error', async () => {
  const wait = deferred(); let first = true;
  const { flow, calls } = setup(() => { if (first) { first = false; return wait.promise; } return { status: 500 }; });
  const run = flow.start(); await tick(); assert.equal((await flow.start()).outcome, 'busy'); assert.equal(calls.length, 1);
  wait.reject(Error('synthetic')); await run; await flow.start(); assert.equal(calls.length, 2);
});
test('cancel ignores late result and starts no further probe', async () => {
  const wait = deferred(); const { flow, calls, timers } = setup(() => wait.promise);
  const run = flow.start(); await tick(); flow.cancel(); await run; wait.resolve({ status: 200 }); await tick();
  assert.equal(flow.state.outcome, 'cancelled'); assert.equal(calls.length, 1); assert.ok(calls[0].signal.aborted); assert.equal(timers.size, 0);
});
test('A to B to A invalidates old run even when transport ignores abort', async () => {
  const wait = deferred(); let first = true;
  const { flow, calls } = setup(p => { if (first) { first = false; return wait.promise; } return deny(p); });
  const old = flow.start(); await tick(); flow.setOwner('synthetic-B'); flow.setOwner('synthetic-A');
  assert.equal((await flow.start()).outcome, 'mock-denials-confirmed'); wait.resolve({ status: 200 }); await old; await tick();
  assert.equal(flow.state.outcome, 'mock-denials-confirmed'); assert.equal(calls.length, 7);
});
test('timeout releases busy state without retry; late rejection cannot update state', async () => {
  const wait = deferred(); const { flow, calls, timers } = setup(() => wait.promise);
  const run = flow.start(); await tick(); assert.equal(timers.size, 1); [...timers][0](); await run;
  wait.reject(Error('late')); await tick(); assert.equal(flow.state.outcome, 'timeout'); assert.equal(calls.length, 1); assert.equal(timers.size, 0);
});
test('dispose aborts work, releases timers and prevents restart', async () => {
  const wait = deferred(); const { flow, calls, timers } = setup(() => wait.promise);
  const run = flow.start(); await tick(); flow.dispose(); await run; wait.resolve(deny(probes[0])); await tick();
  assert.equal(flow.state.outcome, 'disposed'); assert.equal((await flow.start()).outcome, 'unavailable'); assert.equal(calls.length, 1); assert.equal(timers.size, 0);
});
test('response bodies, credentials and messages are never inspected or emitted', async () => {
  const { flow } = setup(p => Object.defineProperties(deny(p), Object.fromEntries(['body', 'headers', 'message', 'token', 'key'].map(k => [k, { get() { throw Error('must not read ' + k); } }]))));
  const result = await flow.start(); assert.equal(result.outcome, 'mock-denials-confirmed');
  assert.ok(result.checks.every(c => Object.keys(c).join(',') === 'id,outcome'));
  assert.ok(!JSON.stringify(result).includes('synthetic-A'));
});
test('no current owner means no requests', async () => {
  const { flow, calls } = setup(); flow.setOwner(null);
  assert.equal((await flow.start()).outcome, 'unavailable'); assert.equal(calls.length, 0);
});
