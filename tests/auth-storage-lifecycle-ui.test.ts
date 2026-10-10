import assert from 'node:assert/strict';
import test from 'node:test';
import { FIXTURE_OWNER, RECORD_KEY, nodes, storageBrowser, storageTab, tick, type UiNode } from './helpers/storage-ui-fixture.ts';

const AUTH_GATE = 'app/components/AuthGate.tsx';
const OTHER_OWNER = 'synthetic-owner-b';
const editor: UiNode = { type: 'textarea', props: { 'data-fixture-editor': true, defaultValue: 'synthetic unsaved draft' } };
const hasEditor = (tree: UiNode) => nodes(tree).includes(editor);

// These are shipped component handler tests with synthetic hooks, auth responses,
// and explicitly serialized locks. They do not claim real browser/account QA.
test('shipping AuthGate keeps the editor gated until owner preparation has acquired and completed the storage lock', async t => {
  const browser = storageBrowser({ [RECORD_KEY]: JSON.stringify({ original: { dietMemo: 'synthetic existing record' } }) });
  const tab = storageTab(browser, 'auth'); t.after(tab.dispose);
  const release = browser.holdLock(); t.after(release);
  const gate = tab.mount(AUTH_GATE, { children: editor }); t.after(gate.dispose);
  await gate.settle();
  assert.match(gate.text(), /불러오는 중/);
  assert.equal(hasEditor(gate.render()), false);
  assert.equal(tab.pinReads.length, 0, 'PIN lookup cannot outrun owner preparation');
  assert.equal(tab.local.getItem(tab.transactions.STORAGE_OWNER_KEY), null);
  assert.equal(browser.record().original && (browser.record().original as { dietMemo: string }).dietMemo, 'synthetic existing record');
  release(); await gate.settle();
  assert.equal(hasEditor(gate.render()), true);
  assert.equal(gate.render().key, FIXTURE_OWNER);
  assert.equal(tab.transactions.captureStorageOwner().userId, FIXTURE_OWNER);
  assert.deepEqual(tab.pinReads.map(read => read.userId), [FIXTURE_OWNER]);
  assert.equal(browser.maxActive, 1);
  assert.ok(browser.calls.every(call => call.name === tab.transactions.STORAGE_LOCK_NAME && call.mode === 'exclusive'));
});

test('shipping AuthGate retains the keyed mounted editor subtree across same-owner sign-in and token refresh', async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'auth'); t.after(tab.dispose);
  const gate = tab.mount(AUTH_GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  const initial = gate.render(), requests = browser.calls.length, pinReads = tab.pinReads.length;
  assert.equal(hasEditor(initial), true);
  for (const event of ['TOKEN_REFRESHED', 'SIGNED_IN', 'INITIAL_SESSION']) {
    const historyStart = gate.history.length;
    tab.emitAuth(event, FIXTURE_OWNER); gate.render(); tab.flushTimers(); await gate.settle();
    for (const tree of gate.history.slice(historyStart)) {
      assert.equal(tree.type, initial.type, 'Refresh must retain the editor ancestor type');
      assert.equal(tree.key, initial.key, 'Refresh must retain the owner key');
      assert.equal(hasEditor(tree), true, 'No intermediate loading gate may unmount an unsaved editor');
      assert.equal(nodes(tree).find(node => node.props['data-fixture-editor']), editor);
    }
  }
  assert.equal(browser.calls.length, requests, 'Confirmed-owner refresh does not repeat storage preparation');
  assert.equal(tab.pinReads.length, pinReads, 'Confirmed-owner refresh does not repeat PIN lookup');
});

test('shipping AuthGate waits for account-switch preparation before exposing a new owner', async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'auth'); t.after(tab.dispose);
  const gate = tab.mount(AUTH_GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  await tab.transactions.writeStorageBatch(tab.local, { [RECORD_KEY]: JSON.stringify({ original: 'synthetic owner A' }) });
  const release = browser.holdLock(); t.after(release);
  tab.emitAuth('SIGNED_IN', OTHER_OWNER); tab.flushTimers(); await gate.settle();
  assert.match(gate.text(), /불러오는 중/); assert.equal(hasEditor(gate.render()), false);
  assert.equal(tab.local.getItem(tab.transactions.STORAGE_OWNER_KEY), FIXTURE_OWNER);
  assert.deepEqual(tab.pinReads.map(read => read.userId), [FIXTURE_OWNER]);
  release(); await gate.settle();
  assert.equal(gate.render().key, OTHER_OWNER); assert.equal(hasEditor(gate.render()), true);
  assert.equal(tab.local.getItem(RECORD_KEY), null, 'The previous owner records are cleared before mounting a new editor');
  assert.equal(tab.transactions.captureStorageOwner().userId, OTHER_OWNER);
});

test('shipping AuthGate keeps failed sign-out cleanup behind an explicit retry gate without exposing stale records', async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'auth'); t.after(tab.dispose);
  const gate = tab.mount(AUTH_GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  await tab.transactions.writeStorageBatch(tab.local, { [RECORD_KEY]: JSON.stringify({ original: 'synthetic saved record' }) });
  const before = tab.local.getItem(RECORD_KEY), release = browser.holdLock(); t.after(release);
  browser.rejectNextLock(new Error('synthetic cleanup lock rejected'));
  tab.emitAuth('SIGNED_OUT', null); tab.flushTimers(); await gate.settle();
  assert.match(gate.text(), /불러오는 중/); assert.equal(hasEditor(gate.render()), false);
  release(); await gate.settle();
  assert.match(gate.text(), /로그인 확인을 완료하지 못했어요/);
  assert.match(gate.text(), /synthetic cleanup lock rejected/);
  assert.ok(gate.button('다시 확인')); assert.equal(hasEditor(gate.render()), false);
  assert.equal(tab.local.getItem(RECORD_KEY), before, 'Failed cleanup preserves records behind the gate');
  assert.equal(tab.cloud.isCurrentCloudSession(FIXTURE_OWNER, tab.cloud.readCloudSyncEpoch()), false);
  assert.equal(tab.pinReads.length, 1);
});

for (const phase of ['initial', 'auth-event'] as const) test(`shipping AuthGate rejects an owner change while ${phase} device-PIN lookup is awaiting`, async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'auth'), peer = storageTab(browser, 'peer');
  t.after(tab.dispose); t.after(peer.dispose);
  const initialPin = phase === 'initial' ? tab.holdNextPin() : undefined;
  const gate = tab.mount(AUTH_GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  let pendingPin = initialPin;
  if (phase === 'auth-event') {
    assert.equal(hasEditor(gate.render()), true);
    pendingPin = tab.holdNextPin();
    tab.emitAuth('SIGNED_IN', OTHER_OWNER); tab.flushTimers(); await gate.settle();
  }
  assert.ok(pendingPin); assert.equal(hasEditor(gate.render()), false);
  assert.equal(tab.pinReads.at(-1)?.userId, phase === 'initial' ? FIXTURE_OWNER : OTHER_OWNER);
  const finalOwner = phase === 'initial' ? OTHER_OWNER : FIXTURE_OWNER;
  await peer.cloud.prepareLocalCloudState(finalOwner); await tick();
  pendingPin.resolve(false); await gate.settle();
  assert.equal(hasEditor(gate.render()), false, 'Late PIN response may not unlock the previous owner');
  assert.match(gate.text(), /로그인 확인을 완료하지 못했어요/);
  assert.match(gate.text(), /계정이 변경되었습니다/);
  assert.ok(gate.button('다시 확인'));
  assert.equal(peer.transactions.captureStorageOwner().userId, finalOwner);
});

test('shipping AuthGate turns a cross-tab owner transition into a visible retry gate', async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'auth'), peer = storageTab(browser, 'peer');
  t.after(tab.dispose); t.after(peer.dispose);
  const gate = tab.mount(AUTH_GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  assert.equal(hasEditor(gate.render()), true);
  const release = browser.holdLock(); t.after(release);
  const preparation = peer.cloud.prepareLocalCloudState(OTHER_OWNER);
  await gate.settle();
  assert.equal(hasEditor(gate.render()), false);
  assert.match(gate.text(), /다른 창에서 로그인 상태가 변경되었습니다/);
  assert.ok(gate.button('다시 확인'));
  release(); await preparation; await gate.settle();
  assert.equal(hasEditor(gate.render()), false, 'Another document finishing its transition cannot silently reopen this gate');
});

test('shipping AuthGate fails closed when initial preparation cannot use Web Locks', async t => {
  const browser = storageBrowser({ [RECORD_KEY]: JSON.stringify({ original: 'synthetic saved record' }) });
  const tab = storageTab(browser, 'auth'); t.after(tab.dispose); tab.disableLocks();
  const before = [...browser.values];
  const gate = tab.mount(AUTH_GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  assert.equal(hasEditor(gate.render()), false);
  assert.match(gate.text(), /Web Locks/); assert.ok(gate.button('다시 확인'));
  assert.deepEqual([...browser.values], before); assert.equal(tab.pinReads.length, 0);
});

test('shipping AuthGate retries failed sign-out cleanup when getUser is null and stays gated until that retry commits', async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'auth'); t.after(tab.dispose);
  const gate = tab.mount(AUTH_GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  await tab.transactions.writeStorageBatch(tab.local, { [RECORD_KEY]: JSON.stringify({ original: 'synthetic owner A record' }) });
  browser.rejectNextLock(new Error('synthetic initial cleanup failure'));
  tab.emitAuth('SIGNED_OUT', null); tab.flushTimers(); await gate.settle();
  assert.match(gate.text(), /synthetic initial cleanup failure/);
  const before = tab.local.getItem(RECORD_KEY), release = browser.holdLock(); t.after(release);
  const requests = browser.calls.length;
  gate.click('다시 확인'); await gate.settle();
  assert.equal(browser.calls.length, requests + 1, 'Retry must queue the failed cleanup even though getUser returns null');
  assert.match(gate.text(), /불러오는 중/);
  assert.equal(hasEditor(gate.render()), false);
  assert.doesNotMatch(gate.text(), /한 번 로그인하고 나의 모든 앱/);
  assert.equal(tab.local.getItem(RECORD_KEY), before);
  release(); await gate.settle();
  assert.equal(tab.local.getItem(RECORD_KEY), null);
  assert.equal(tab.local.getItem(tab.transactions.STORAGE_OWNER_KEY), null);
  assert.match(gate.text(), /한 번 로그인하고 나의 모든 앱/);
  assert.doesNotMatch(gate.text(), /로그인 확인을 완료하지 못했어요/);
  assert.equal(hasEditor(gate.render()), false);
});

test('shipping AuthGate with no authenticated user preserves legacy recovery bytes behind its retry gate', async t => {
  const initial = JSON.stringify({ original: 'synthetic previous owner record' });
  const journal = JSON.stringify({ [RECORD_KEY]: initial });
  const browser = storageBrowser({ [RECORD_KEY]: initial, 'fitness-cloud-sync-user': FIXTURE_OWNER, 'yeoni-storage-transaction-v1': journal });
  const tab = storageTab(browser, 'auth', null); t.after(tab.dispose);
  const gate = tab.mount(AUTH_GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  assert.match(gate.text(), /로그인 확인을 완료하지 못했어요/);
  assert.match(gate.text(), /이전 버전.*복구 정보/);
  assert.ok(gate.button('다시 확인')); assert.equal(hasEditor(gate.render()), false);
  assert.equal(tab.local.getItem(RECORD_KEY), initial);
  assert.equal(tab.local.getItem(tab.transactions.STORAGE_JOURNAL_KEY), journal);
  assert.doesNotMatch(gate.text(), /한 번 로그인하고 나의 모든 앱/);
});

for (const errorName of ['AuthRetryableFetchError', 'AuthApiError']) test(`shipping AuthGate preserves records when getUser resolves with ${errorName} and no user`, async t => {
  const browser = storageBrowser({ [RECORD_KEY]: JSON.stringify({ original: 'synthetic offline record' }) });
  const tab = storageTab(browser, 'auth'); t.after(tab.dispose);
  await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const error = Object.assign(new Error('synthetic user verification failed'), { name: errorName, __isAuthError: true });
  tab.setAuthError(error);
  const before = [...browser.values], requests = browser.calls.length;
  const gate = tab.mount(AUTH_GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  assert.match(gate.text(), /로그인 확인을 완료하지 못했어요/);
  assert.match(gate.text(), /synthetic user verification failed/);
  assert.ok(gate.button('다시 확인')); assert.equal(hasEditor(gate.render()), false);
  assert.deepEqual([...browser.values], before, 'A verification error does not authorize destructive signed-out cleanup');
  assert.equal(browser.calls.length, requests); assert.equal(tab.pinReads.length, 0);
  tab.setAuthError(null); gate.click('다시 확인'); await gate.settle();
  assert.equal(hasEditor(gate.render()), true, 'A subsequent successful verification can reopen the same owner');
  assert.deepEqual([...browser.values], before);
});

test('shipping AuthGate treats AuthSessionMissingError as signed out and awaits safe cleanup', async t => {
  const browser = storageBrowser({ [RECORD_KEY]: JSON.stringify({ original: 'synthetic prior session record' }) });
  const tab = storageTab(browser, 'auth'); t.after(tab.dispose); await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  tab.setAuthError(Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError', __isAuthError: true }));
  const release = browser.holdLock(); t.after(release);
  const gate = tab.mount(AUTH_GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  assert.match(gate.text(), /불러오는 중/); assert.equal(hasEditor(gate.render()), false);
  assert.notEqual(tab.local.getItem(RECORD_KEY), null);
  release(); await gate.settle();
  assert.equal(tab.local.getItem(RECORD_KEY), null);
  assert.match(gate.text(), /한 번 로그인하고 나의 모든 앱/);
  assert.doesNotMatch(gate.text(), /로그인 확인을 완료하지 못했어요/);
});
