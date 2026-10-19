import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLedger, summary } from './index.ts';
import { createCoordinator } from './persistence.ts';
import { MemoryStore } from './test-fixtures/memory-store.ts';
const request = (id = 'one', estimatedCost = 60) => ({ id, estimatedCost, fingerprint: 'synthetic', month: '2026-10' });
function setup() {
  const settings = { monthlyBudget: 100, perRequestBudget: 100, monthlyRequestLimit: 10 };
  const store = new MemoryStore(['a', 'b'].map(id => createLedger(id, settings)));
  return { store, api: createCoordinator(store) };
}
const totals = async store => summary((await store.read('a')).value.ledger, '2026-10');

test('CAS rejects stale snapshots without overwriting committed values', async () => {
  const { store, api } = setup();
  const old = await store.read('a');
  await api.reserve('a', request());
  assert.equal(await store.compareAndSwap('a', old.revision, old.value), false);
  assert.equal((await store.read('a')).revision, 1);
  assert.equal((await totals(store)).reserved, 60);
  old.value.ledger.entries.push(request('tampered'));
  assert.equal((await store.read('a')).value.ledger.entries.length, 1);
});
test('competing coordinators reread on CAS conflict and cannot over-reserve', async () => {
  const { store, api } = setup();
  store.synchronizeNextReads(2);
  const results = await Promise.allSettled([
    api.reserve('a', request('one')), createCoordinator(store).reserve('a', request('two')),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'monthly_budget');
  assert.equal(store.conflicts, 1);
  assert.equal((await totals(store)).reserved, 60);
});
test('concurrent same-ID reservations share one entry and concurrent claims grant once', async () => {
  const { store, api } = setup();
  store.synchronizeNextReads(2);
  await Promise.all([api.reserve('a', request()), createCoordinator(store).reserve('a', request())]);
  assert.equal((await totals(store)).requests, 1);
  store.synchronizeNextReads(2);
  let simulatedDispatches = 0;
  const results = await Promise.all(['worker-one', 'worker-two'].map(async owner => {
    const granted = await createCoordinator(store).claimDispatch('a', 'one', owner);
    if (granted) simulatedDispatches++;
    return granted;
  }));
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(simulatedDispatches, 1);
  const claim = (await store.read('a')).value.claims[0];
  assert.equal(await api.claimDispatch('a', 'one', claim.ownerId), false);
});
test('concurrent conflicting same-ID payload fails rather than replacing request', async () => {
  const { store, api } = setup();
  store.synchronizeNextReads(2);
  const results = await Promise.allSettled([api.reserve('a', request()), api.reserve('a', { ...request(), fingerprint: 'different' })]);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'idempotency_conflict');
  assert.equal((await totals(store)).requests, 1);
});
test('process failure after reservation but before claim permits one new claimant', async () => {
  const { store, api } = setup();
  await api.reserve('a', request());
  // Discard the coordinator: storage survives a simulated worker restart.
  const recovered = createCoordinator(store);
  await recovered.reserve('a', request());
  assert.equal(await recovered.claimDispatch('a', 'one', 'recovery-invocation'), true);
  assert.equal((await totals(store)).requests, 1);
});
test('claim commit before/after hypothetical send is never regranted after worker loss', async () => {
  for (const simulatedSent of [false, true]) {
    const { store, api } = setup();
    await api.reserve('a', request());
    assert.equal(await api.claimDispatch('a', 'one', 'lost-worker'), true);
    let simulatedDispatches = simulatedSent ? 1 : 0;
    const recovered = createCoordinator(store);
    if (await recovered.claimDispatch('a', 'one', 'replacement')) simulatedDispatches++;
    assert.equal(simulatedDispatches, simulatedSent ? 1 : 0);
    assert.equal(await recovered.claimDispatch('a', 'one', 'lost-worker'), false);
    assert.equal((await totals(store)).reserved, 60);
    await assert.rejects(recovered.release('a', 'one', 'not_dispatched'), { code: 'dispatch_outcome_unknown' });
  }
});
test('timeout and TTL cannot release liability or transfer ownership', async () => {
  const { store, api } = setup();
  await api.reserve('a', request());
  await api.claimDispatch('a', 'one', 'owner');
  const before = await store.read('a');
  // Caller reports elapsed time; the contract deliberately has no expiry path.
  for (const reason of ['timeout', 'ttl_expired', 'http_error', 'client_disconnected']) {
    await assert.rejects(api.release('a', 'one', reason), { code: 'unconfirmed_billing' });
    assert.equal(await createCoordinator(store).claimDispatch('a', 'one', 'after-' + reason), false);
  }
  assert.deepEqual(await store.read('a'), before);
});
test('write failure before commit grants no dispatch and clean retry can acquire', async () => {
  const { store, api } = setup();
  store.nextWriteFailure = 'before_commit';
  await assert.rejects(api.reserve('a', request()), /synthetic_write_failure/);
  assert.equal((await totals(store)).reserved, 0);
  await api.reserve('a', request());
  store.nextWriteFailure = 'before_commit';
  await assert.rejects(api.claimDispatch('a', 'one', 'owner'), /synthetic_write_failure/);
  assert.equal((await store.read('a')).value.claims.length, 0);
  assert.equal(await api.claimDispatch('a', 'one', 'retry'), true);
});
test('lost reservation acknowledgment is recovered without another reservation', async () => {
  const { store, api } = setup();
  store.nextWriteFailure = 'after_commit';
  await assert.rejects(api.reserve('a', request()), /synthetic_ack_lost/);
  await createCoordinator(store).reserve('a', request());
  assert.equal((await totals(store)).requests, 1);
  assert.equal(await api.claimDispatch('a', 'one', 'owner'), true);
});
test('lost claim acknowledgment yields no grant and retry cannot dispatch', async () => {
  const { store, api } = setup();
  await api.reserve('a', request());
  store.nextWriteFailure = 'after_commit';
  let simulatedDispatches = 0;
  await assert.rejects(async () => {
    if (await api.claimDispatch('a', 'one', 'owner')) simulatedDispatches++;
  }, /synthetic_ack_lost/);
  assert.equal(await api.claimDispatch('a', 'one', 'owner'), false);
  assert.equal(await api.claimDispatch('a', 'one', 'other'), false);
  assert.equal(simulatedDispatches, 0);
  assert.equal((await totals(store)).reserved, 60);
});
test('settlement retry requires original owner and never redispatches after failure', async () => {
  for (const failure of ['before_commit', 'after_commit']) {
    const { store, api } = setup();
    await api.reserve('a', request());
    await api.claimDispatch('a', 'one', 'owner');
    await assert.rejects(api.settle('a', 'one', 'other', 25), { code: 'not_dispatch_owner' });
    store.nextWriteFailure = failure;
    await assert.rejects(api.settle('a', 'one', 'owner', 25));
    assert.equal((await totals(store)).reserved, failure === 'before_commit' ? 60 : 0);
    await createCoordinator(store).settle('a', 'one', 'owner', 25);
    assert.equal((await totals(store)).spent, 25);
    assert.equal(await api.claimDispatch('a', 'one', 'owner'), false);
    await assert.rejects(api.settle('a', 'one', 'owner', 26), { code: 'settlement_conflict' });
  }
});
test('release races with claim: only one wins and claimed liability cannot be cancelled as unsent', async () => {
  const { store, api } = setup();
  await api.reserve('a', request());
  store.synchronizeNextReads(2);
  const [claim, cancellation] = await Promise.allSettled([
    api.claimDispatch('a', 'one', 'owner'), api.release('a', 'one', 'not_dispatched'),
  ]);
  assert.equal(claim.status, 'fulfilled');
  if (claim.value) {
    assert.equal(cancellation.status, 'rejected');
    assert.equal(cancellation.reason.code, 'dispatch_outcome_unknown');
    assert.equal((await totals(store)).reserved, 60);
  } else {
    assert.equal(cancellation.status, 'fulfilled');
    assert.equal((await totals(store)).reserved, 0);
  }
});
test('confirmed release keeps tombstone and account identity isolates same request IDs', async () => {
  const { store, api } = setup();
  await api.reserve('a', request());
  await api.claimDispatch('a', 'one', 'owner');
  // Trusted reconciler has stopped the sender and confirmed no billing.
  await api.release('a', 'one', 'provider_confirmed_unbilled');
  assert.equal(await api.claimDispatch('a', 'one', 'retry'), false);
  assert.equal((await totals(store)).requests, 1);
  await api.reserve('b', request());
  assert.equal(await api.claimDispatch('b', 'one', 'other'), true);
  await assert.rejects(api.settle('a', 'one', 'other', 10), { code: 'not_dispatch_owner' });
});
test('persistent conflicts are bounded; unknown storage outcomes are not treated as conflicts', async () => {
  const { store } = setup();
  let calls = 0;
  const conflictStore = { read: id => store.read(id), compareAndSwap: async () => { calls++; return false; } };
  await assert.rejects(createCoordinator(conflictStore).reserve('a', request()), { code: 'revision_contention' });
  assert.equal(calls, 16);
  calls = 0;
  const unknownStore = { read: id => store.read(id), compareAndSwap: async () => { calls++; throw new Error('unknown'); } };
  await assert.rejects(createCoordinator(unknownStore).reserve('a', request()), /unknown/);
  assert.equal(calls, 1);
});
