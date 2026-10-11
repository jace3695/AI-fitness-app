import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, FIXTURE_OWNER, nodes, storageBrowser, storageTab } from './helpers/storage-ui-fixture.ts';
import type { AuthenticatedStorageOwner } from '../app/data/authenticatedStorageOwner.ts';

const verified = () => ({ data: { user: { id: FIXTURE_OWNER, email: 'synthetic@example.test' } }, error: null });
const GATE = 'app/components/AuthGate.tsx';
const editor = { type: 'textarea', props: { 'data-registry-editor': true } };

for (const kind of ['fake', 'copy', 'serialized', 'foreign-storage', 'wrong-retirement', 'cancelled', 'claimed'] as const)
  test(`a ${kind} recheck cannot obtain or repeat registered Gate authority`, async t => {
    const browser = storageBrowser(), tab = storageTab(browser, 'registry'); t.after(tab.dispose);
    await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
    const runtime = tab.loadModule('app/data/authenticatedStorageOwner.ts') as typeof import('../app/data/authenticatedStorageOwner.ts');
    const retirement = {}, owner = tab.transactions.captureStorageOwner();
    const request = runtime.createAuthenticatedStorageOwnerRecheck(tab.local, owner, retirement);
    assert.equal(runtime.assertAuthenticatedStorageOwnerRecheck(request, tab.local, retirement), undefined, 'The private registration is never returned');
    if (kind === 'cancelled') runtime.cancelAuthenticatedStorageOwnerRecheck(request);
    if (kind === 'claimed') runtime.claimAuthenticatedStorageOwnerRecheck(request, tab.local);
    const candidate = kind === 'copy' ? { ...request } : kind === 'serialized' ? JSON.parse(JSON.stringify(request))
      : kind === 'fake' ? { userId: FIXTURE_OWNER, epoch: owner.epoch!, signal: new AbortController().signal } : request;
    if (kind === 'foreign-storage') assert.throws(() => runtime.assertAuthenticatedStorageOwnerRecheck(candidate, browser.local('other'), retirement));
    else if (kind === 'wrong-retirement') assert.throws(() => runtime.assertAuthenticatedStorageOwnerRecheck(candidate, tab.local, {}));
    else assert.throws(() => runtime.claimAuthenticatedStorageOwnerRecheck(candidate, tab.local));
  });

for (const phase of ['completed-before-request', 'started-before-request'] as const)
  test(`a lease ${phase} cannot be adopted as a fresh requested proof`, async t => {
    const browser = storageBrowser(), tab = storageTab(browser, 'freshness'); t.after(tab.dispose);
    await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
    const runtime = tab.loadModule('app/data/authenticatedStorageOwner.ts') as typeof import('../app/data/authenticatedStorageOwner.ts');
    const auth = deferred<ReturnType<typeof verified>>();
    const pending = runtime.verifyAuthenticatedStorageOwner(tab.local, () => phase === 'started-before-request' ? auth.promise : Promise.resolve(verified()), async () => {});
    const old = phase === 'completed-before-request' ? await pending : undefined;
    const request = runtime.createAuthenticatedStorageOwnerRecheck(tab.local, tab.transactions.captureStorageOwner(), {});
    runtime.claimAuthenticatedStorageOwnerRecheck(request, tab.local);
    auth.resolve(verified()); const proof = old ?? await pending;
    assert.equal(proof.isCurrent(), true);
    assert.throws(() => runtime.registerAuthenticatedStorageOwnerRecheckProof(request, proof, tab.local, () => assert.fail('old proof consumed')));
  });

test('successful requested proof consumption detaches cancellation without revoking its fresh lease', async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'consume'); t.after(tab.dispose);
  await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const runtime = tab.loadModule('app/data/authenticatedStorageOwner.ts') as typeof import('../app/data/authenticatedStorageOwner.ts');
  const retirement = {}, request = runtime.createAuthenticatedStorageOwnerRecheck(tab.local, tab.transactions.captureStorageOwner(), retirement);
  runtime.claimAuthenticatedStorageOwnerRecheck(request, tab.local);
  const proof = await runtime.verifyAuthenticatedStorageOwner(tab.local, async () => verified(), async () => {});
  let detached = 0;
  runtime.registerAuthenticatedStorageOwnerRecheckProof(request, proof, tab.local, () => { detached++; });
  runtime.assertAuthenticatedStorageOwnerRecheckProof(request, proof, tab.local, retirement);
  assert.equal(runtime.isRequestedAuthenticatedStorageOwnerProof(proof), true);
  runtime.consumeAuthenticatedStorageOwnerRecheck(request, proof, tab.local, retirement);
  assert.equal(detached, 1); assert.equal(request.signal.aborted, false); assert.equal(proof.isCurrent(), true);
  runtime.cancelAuthenticatedStorageOwnerRecheck(request);
  assert.equal(proof.isCurrent(), true); assert.equal(request.signal.aborted, false);
  assert.throws(() => runtime.claimAuthenticatedStorageOwnerRecheck(request, tab.local));
  assert.throws(() => runtime.consumeAuthenticatedStorageOwnerRecheck(request, proof, tab.local, retirement));
});

test('nested same-document Gates claim one recheck and never launch duplicate fresh verification', async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'nested'); t.after(tab.dispose);
  const outer = tab.mount(GATE, { children: editor }); t.after(outer.dispose); await outer.settle();
  const inner = tab.mount(GATE, { children: editor }); t.after(inner.dispose); await inner.settle();
  const runtime = tab.loadModule('app/data/authenticatedStorageOwner.ts') as typeof import('../app/data/authenticatedStorageOwner.ts');
  const retirement = {}, request = runtime.createAuthenticatedStorageOwnerRecheck(tab.local, tab.transactions.captureStorageOwner(), retirement);
  const reads = tab.authReads.length, pins = tab.pinReads.length, writes = browser.writes.length, locks = browser.calls.length;
  const auth = tab.holdNextAuth();
  tab.dispatch({ type: runtime.AUTHENTICATED_STORAGE_OWNER_RECHECK_EVENT, detail: request });
  tab.dispatch({ type: runtime.AUTHENTICATED_STORAGE_OWNER_RECHECK_EVENT, detail: request });
  await outer.settle(); await inner.settle(); assert.equal(tab.authReads.length, reads + 1);
  assert.equal(nodes(outer.render()).some(node => node.props.hidden === true && node.props.inert === true), true);
  auth.resolve(verified()); await outer.settle(); await inner.settle();
  const proof = nodes(outer.render()).find(node => node.props.lease)?.props.lease as AuthenticatedStorageOwner;
  runtime.assertAuthenticatedStorageOwnerRecheckProof(request, proof, tab.local, retirement);
  runtime.consumeAuthenticatedStorageOwnerRecheck(request, proof, tab.local, retirement);
  assert.equal(tab.pinReads.length, pins + 1); assert.equal(browser.writes.length, writes); assert.equal(browser.calls.length, locks);
});

test('a missing-ready request cannot preempt a normal Gate preparation waiting for its lock', async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'pending-normal'); t.after(tab.dispose);
  await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const runtime = tab.loadModule('app/data/authenticatedStorageOwner.ts') as typeof import('../app/data/authenticatedStorageOwner.ts');
  const request = runtime.createAuthenticatedStorageOwnerRecheck(tab.local, tab.transactions.captureStorageOwner(), {});
  tab.local.removeItem(tab.transactions.STORAGE_READY_KEY);
  const release = browser.holdLock(); t.after(release);
  const gate = tab.mount(GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  const auth = tab.authReads.length;
  tab.dispatch({ type: runtime.AUTHENTICATED_STORAGE_OWNER_RECHECK_EVENT, detail: request }); await gate.settle();
  assert.equal(tab.authReads.length, auth); assert.match(gate.text(), /불러오는 중/);
  release(); await gate.settle(); assert.ok(nodes(gate.render()).includes(editor));
});

test('a password-recovery Gate never mounts private editor children to preserve a nonexistent draft', async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'password-recovery'); t.after(tab.dispose);
  const gate = tab.mount(GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  tab.emitAuth('PASSWORD_RECOVERY', FIXTURE_OWNER); tab.flushTimers(); await gate.settle();
  assert.match(gate.text(), /새 비밀번호 설정/); assert.equal(nodes(gate.render()).includes(editor), false);
  const runtime = tab.loadModule('app/data/authenticatedStorageOwner.ts') as typeof import('../app/data/authenticatedStorageOwner.ts');
  const request = runtime.createAuthenticatedStorageOwnerRecheck(tab.local, tab.transactions.captureStorageOwner(), {});
  const auth = tab.holdNextAuth(), history = gate.history.length;
  tab.dispatch({ type: runtime.AUTHENTICATED_STORAGE_OWNER_RECHECK_EVENT, detail: request }); await gate.settle();
  assert.equal(nodes(gate.render()).includes(editor), false);
  auth.resolve(verified()); await gate.settle();
  for (const tree of gate.history.slice(history)) assert.equal(nodes(tree).includes(editor), false);
  assert.match(gate.text(), /새 비밀번호 설정/);
});

test('entering password recovery cancels a suspended editor instead of preserving it behind the reset form', async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'enter-recovery'); t.after(tab.dispose);
  const gate = tab.mount(GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  const runtime = tab.loadModule('app/data/authenticatedStorageOwner.ts') as typeof import('../app/data/authenticatedStorageOwner.ts');
  const request = runtime.createAuthenticatedStorageOwnerRecheck(tab.local, tab.transactions.captureStorageOwner(), {});
  const auth = tab.holdNextAuth(); tab.dispatch({ type: runtime.AUTHENTICATED_STORAGE_OWNER_RECHECK_EVENT, detail: request }); await gate.settle();
  assert.ok(nodes(gate.render()).includes(editor));
  tab.emitAuth('PASSWORD_RECOVERY', FIXTURE_OWNER); tab.flushTimers(); await gate.settle();
  auth.resolve(verified()); await gate.settle();
  assert.equal(request.signal.aborted, true); assert.equal(nodes(gate.render()).includes(editor), false);
  assert.match(gate.text(), /새 비밀번호 설정/);
});

test('exact-ready recheck supersedes a pending normal lookup without accepting its pre-request result', async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'supersede-normal'); t.after(tab.dispose);
  await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const old = tab.holdNextAuth(), gate = tab.mount(GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  const runtime = tab.loadModule('app/data/authenticatedStorageOwner.ts') as typeof import('../app/data/authenticatedStorageOwner.ts');
  const retirement = {}, request = runtime.createAuthenticatedStorageOwnerRecheck(tab.local, tab.transactions.captureStorageOwner(), retirement);
  const auth = tab.holdNextAuth(), writes = browser.writes.length, locks = browser.calls.length;
  tab.dispatch({ type: runtime.AUTHENTICATED_STORAGE_OWNER_RECHECK_EVENT, detail: request });
  old.resolve(verified()); await gate.settle();
  assert.equal(nodes(gate.render()).includes(editor), false);
  auth.resolve(verified()); await gate.settle();
  const proof = nodes(gate.render()).find(node => node.props.lease)?.props.lease as AuthenticatedStorageOwner;
  runtime.assertAuthenticatedStorageOwnerRecheckProof(request, proof, tab.local, retirement);
  assert.equal(browser.writes.length, writes); assert.equal(browser.calls.length, locks);
  runtime.consumeAuthenticatedStorageOwnerRecheck(request, proof, tab.local, retirement);
});
