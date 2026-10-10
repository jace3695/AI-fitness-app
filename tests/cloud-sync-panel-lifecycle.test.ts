import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { deferred, FIXTURE_OWNER, nodes, storageBrowser, storageTab, textOf, tick, type UiNode } from './helpers/storage-ui-fixture.ts';

const PANEL = 'app/components/CloudSyncPanel.tsx', GATE = 'app/components/AuthGate.tsx';
const OTHER = 'synthetic-owner-b', KEY = 'ai-fitness-daily-notes';
const EDITOR: UiNode = { type: 'textarea', props: { 'data-owner-editor': true } };

function panelFixture(t: TestContext, browser = storageBrowser(), name = 'first', owner: string | null = FIXTURE_OWNER) {
  const tab = storageTab(browser, name, owner); t.after(tab.dispose);
  const cloud = tab.cloud, reads: { userId: string; signal?: AbortSignal }[] = [], writes: string[] = [];
  const remote = new Map([[FIXTURE_OWNER, { [KEY]: { original: 'A preserved' } }], [OTHER, { [KEY]: { original: 'B only' } }]]);
  const readHolds: ReturnType<typeof deferred<void>>[] = [];
  const controls = { resetRunning: false, signOutCalls: 0 };
  let signOutHold: ReturnType<typeof deferred<{ error: Error | null }>> | undefined;
  const authModule = tab.loadModule('app/lib/supabase.ts') as { supabase: { auth: Record<string, unknown> } };
  tab.setModule('app/lib/supabase.ts', { ...authModule, supabase: { ...authModule.supabase, auth: {
    ...authModule.supabase.auth,
    async signOut() { controls.signOutCalls += 1; return signOutHold?.promise ?? { error: null }; },
  } } });
  const resets = tab.loadModule('app/data/appRecordReset.ts');
  tab.setModule('app/data/appRecordReset.ts', { ...resets, isRecordResetRunning: () => controls.resetRunning });
  const realmState = (state: Record<string, unknown>) => {
    const values = Object.fromEntries(Object.entries(state).map(([key, value]) => [key, JSON.stringify(value)]));
    const keys = Object.keys(values);
    return cloud.readLocalCloudState({ length: keys.length, key: (index: number) => keys[index] ?? null, getItem: (key: string) => values[key] ?? null });
  };
  tab.setModule('app/data/cloudSync.ts', { ...cloud,
    async getRemoteState(userId: string, signal?: AbortSignal) {
      assert.equal(cloud.isCurrentCloudSession(userId, cloud.readCloudSyncEpoch()), true, 'Every GET starts from completed current-owner readiness');
      reads.push({ userId, signal }); const state = realmState(remote.get(userId) ?? {});
      const held = readHolds.shift(); if (held) await held.promise;
      return { state, updated_at: 'synthetic-read' };
    },
    async saveRemoteState(userId: string) { writes.push(userId); throw new Error('unexpected insert'); },
    async saveRemoteStateIfUnchanged(userId: string) { writes.push(userId); throw new Error('unexpected update'); },
  });
  tab.setModule('app/lib/unsavedChanges.ts', { requestSafeReload() { assert.fail('unexpected reset reload'); } });
  const gate = tab.mount(GATE, { children: EDITOR }), panel = tab.mount(PANEL, { hideSignedOut: true });
  t.after(panel.dispose); t.after(gate.dispose);
  return { browser, tab, gate, panel, reads, writes, controls,
    async settle() { await gate.settle(); await panel.settle(); },
    holdRead() { const held = deferred<void>(); readHolds.push(held); return held; },
    holdSignOut() { signOutHold = deferred<{ error: Error | null }>(); return signOutHold; },
  };
}

async function retireAndPrepare(f: ReturnType<typeof panelFixture>) {
  const owner = f.tab.transactions.captureStorageOwner();
  f.tab.local.removeItem(f.tab.transactions.STORAGE_READY_KEY);
  f.tab.dispatch({ type: f.tab.transactions.CLOUD_SESSION_CHANGED_EVENT });
  assert.match(f.panel.text(), /다른 창에서 로그인 상태가 변경되었습니다/);
  assert.equal(nodes(f.gate.render()).some(node => node.props['data-owner-editor']), false, 'Readiness loss also gates private content');
  await f.tab.cloud.prepareLocalCloudState(owner.userId!);
  assert.equal(f.tab.cloud.isCurrentCloudSession(owner.userId!, owner.epoch), true);
  return owner;
}

function syncButton(f: ReturnType<typeof panelFixture>) {
  const button = nodes(f.panel.render()).find(node => node.type === 'button' && /^(다시 시도|지금 동기화)$/.test(textOf(node)));
  assert.ok(button, 'The real panel must expose its explicit sync action');
  return button.props.onClick as () => void;
}

test('shipping global cloud panel switches two shared-storage documents to B without replaying A', async t => {
  const a = panelFixture(t); await a.settle(); assert.match(a.panel.text(), /서버 반영 완료/);
  const b = panelFixture(t, a.browser, 'peer'); await b.settle(); await a.settle(); assert.match(b.panel.text(), /서버 반영 완료/);
  a.tab.emitAuth('SIGNED_OUT', null); b.tab.emitAuth('SIGNED_OUT', null);
  a.tab.flushTimers(); b.tab.flushTimers(); await a.settle(); await b.settle();
  assert.equal(a.tab.local.getItem(KEY), null);
  a.tab.emitAuth('SIGNED_IN', OTHER); b.tab.emitAuth('SIGNED_IN', OTHER);
  a.tab.flushTimers(); b.tab.flushTimers(); await a.settle(); await b.settle();
  assert.match(a.panel.text(), /서버 반영 완료/); assert.match(b.panel.text(), /서버 반영 완료/);
  assert.ok(a.reads.some(read => read.userId === OTHER)); assert.ok(b.reads.some(read => read.userId === OTHER));
  assert.equal(a.tab.local.getItem(KEY), JSON.stringify({ original: 'B only' }));
  assert.deepEqual(a.writes, []); assert.deepEqual(b.writes, []);
});

test('a completed same-owner preparation and fresh callback cannot leave the cloud loop permanently stopped', async t => {
  const f = panelFixture(t); await f.settle(); assert.match(f.panel.text(), /서버 반영 완료/);
  const owner = f.tab.transactions.captureStorageOwner(), reads = f.reads.length;
  // A readiness loss is a genuine cancellation boundary. Completing the
  // authenticated preparation restores this exact desired owner generation.
  f.tab.local.removeItem(f.tab.transactions.STORAGE_READY_KEY);
  f.tab.dispatch({ type: f.tab.transactions.CLOUD_SESSION_CHANGED_EVENT });
  assert.match(f.panel.text(), /다른 창에서 로그인 상태가 변경되었습니다/);
  await f.tab.cloud.prepareLocalCloudState(owner.userId!);
  assert.equal(f.tab.cloud.isCurrentCloudSession(owner.userId!, owner.epoch), true);
  f.tab.emitAuth('TOKEN_REFRESHED', owner.userId); await f.settle();
  assert.ok(f.reads.length > reads, 'A fresh same-owner callback must restore a read loop after successful preparation');
  assert.match(f.panel.text(), /서버 반영 완료/);
  assert.deepEqual(f.writes, []);
});

test('a same-owner live effect retains its exact loop without redundant auth or record reads', async t => {
  const f = panelFixture(t); await f.settle();
  const auth = f.tab.authReads.length, reads = f.reads.length, signal = f.reads.at(-1)!.signal;
  for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION']) { f.tab.emitAuth(event, FIXTURE_OWNER); await f.settle(); }
  assert.equal(f.tab.authReads.length, auth); assert.equal(f.reads.length, reads); assert.equal(signal?.aborted, false);
  assert.match(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

test('a live manual sync remains a single fresh read without unnecessary reauthentication', async t => {
  const f = panelFixture(t); await f.settle();
  const auth = f.tab.authReads.length, reads = f.reads.length, old = f.reads.at(-1)!.signal;
  syncButton(f)(); await f.settle();
  assert.equal(f.tab.authReads.length, auth); assert.equal(f.reads.length, reads + 1); assert.equal(old?.aborted, true);
  assert.match(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

test('explicit stopped-loop retry holds dispatch until its fresh owner check and read complete', async t => {
  const f = panelFixture(t); await f.settle(); await retireAndPrepare(f);
  const auth = f.tab.holdNextAuth(), reads = f.reads.length, read = f.holdRead();
  syncButton(f)(); await f.settle();
  assert.equal(f.reads.length, reads); assert.equal(nodes(f.gate.render()).some(node => node.props['data-owner-editor']), false);
  auth.resolve({ data: { user: { id: FIXTURE_OWNER, email: 'a@example.test' } }, error: null }); await f.settle();
  assert.equal(f.reads.length, reads + 1); assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
  read.resolve(); await f.settle(); assert.match(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

for (const result of ['error', 'mismatch'] as const) test(`explicit stopped-loop retry cannot bypass ${result} fresh verification`, async t => {
  const f = panelFixture(t); await f.settle(); await retireAndPrepare(f);
  const auth = f.tab.holdNextAuth(), reads = f.reads.length;
  const renewal = result === 'mismatch' ? f.tab.holdNextAuth() : undefined;
  syncButton(f)(); await f.settle(); assert.equal(f.reads.length, reads);
  auth.resolve(result === 'error' ? { data: { user: null }, error: new Error('synthetic unavailable verification') }
    : { data: { user: { id: FIXTURE_OWNER, email: 'a@example.test' } }, error: null });
  await f.settle(); assert.equal(f.reads.length, reads);
  renewal?.resolve({ data: { user: { id: OTHER, email: 'b@example.test' } }, error: null });
  await f.settle(); f.tab.dispatch({ type: 'focus' }); f.tab.pollIntervals(); await f.settle();
  assert.equal(f.reads.length, reads); assert.deepEqual(f.writes, []); assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
  assert.equal(nodes(f.gate.render()).some(node => node.props['data-owner-editor']), false);
});

test('explicit retry fences a replacement that is published but has not mounted', async t => {
  const f = panelFixture(t); await f.settle(); const click = syncButton(f);
  await retireAndPrepare(f); f.tab.emitAuth('TOKEN_REFRESHED', FIXTURE_OWNER);
  for (let i = 0; i < 4; i++) await tick();
  const reads = f.reads.length, held = f.tab.holdNextAuth(); click();
  await f.settle(); assert.equal(f.reads.length, reads);
  held.resolve({ data: { user: null }, error: new Error('synthetic unavailable verification') });
  await f.settle(); assert.equal(f.reads.length, reads); assert.deepEqual(f.writes, []);
});

for (const pending of ['activation', 'authentication'] as const) test(`sign-out fences pending ${pending} before its request finishes`, async t => {
  const f = panelFixture(t); await f.settle();
  const signOut = f.panel.button('로그아웃').props.onClick as () => void;
  await retireAndPrepare(f);
  const auth = pending === 'authentication' ? f.tab.holdNextAuth() : undefined;
  f.tab.emitAuth('TOKEN_REFRESHED', FIXTURE_OWNER);
  for (let i = 0; i < 4; i++) await tick();
  const reads = f.reads.length, held = f.holdSignOut(); signOut();
  assert.equal(f.controls.signOutCalls, 1);
  auth?.resolve({ data: { user: { id: FIXTURE_OWNER, email: 'a@example.test' } }, error: null });
  await f.settle(); assert.equal(f.reads.length, reads); assert.deepEqual(f.writes, []);
  held.resolve({ error: null }); f.tab.emitAuth('SIGNED_OUT', null); await f.settle();
  assert.equal(f.reads.length, reads); assert.equal(f.tab.local.getItem(KEY), null);
  assert.equal(nodes(f.gate.render()).some(node => node.props['data-owner-editor']), false);
});

for (const result of ['error', 'mismatch'] as const) test(`a not-yet-mounted binding cannot start a GET during ${result} revalidation`, async t => {
  const f = panelFixture(t);
  // Let authentication/preparation publish state without rendering the panel's
  // replacement effect yet, then deliver another real same-owner callback.
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(f.tab.cloud.isCurrentCloudSession(FIXTURE_OWNER, f.tab.cloud.readCloudSyncEpoch()), true);
  assert.equal(f.reads.length, 0);
  const held = f.tab.holdNextAuth(); f.tab.emitAuth('TOKEN_REFRESHED', FIXTURE_OWNER);
  f.panel.render(); await f.panel.settle();
  assert.equal(f.reads.length, 0, 'The superseded pending binding must be fenced before the verification await');
  held.resolve(result === 'error' ? { data: { user: null }, error: new Error('synthetic unavailable verification') }
    : { data: { user: { id: OTHER, email: 'b@example.test' } }, error: null });
  await f.settle(); assert.equal(f.reads.length, 0); assert.deepEqual(f.writes, []);
  assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
});

test('the replacement binding cannot read B before owner preparation completes', async t => {
  const f = panelFixture(t); await f.settle(); const reads = f.reads.length;
  const release = f.browser.holdLock(); t.after(release);
  f.tab.emitAuth('SIGNED_IN', OTHER); f.tab.flushTimers(); await f.settle();
  assert.equal(f.reads.length, reads); assert.equal(nodes(f.gate.render()).some(node => node.props['data-owner-editor']), false);
  release(); await f.settle();
  assert.equal(f.reads.at(-1)?.userId, OTHER); assert.match(f.panel.text(), /서버 반영 완료/);
  assert.equal(f.tab.local.getItem(KEY), JSON.stringify({ original: 'B only' })); assert.deepEqual(f.writes, []);
});

test('retired-loop renewal stays private during fresh authentication and only then begins its new read', async t => {
  const f = panelFixture(t); await f.settle(); await retireAndPrepare(f);
  const auth = f.tab.holdNextAuth(), reads = f.reads.length, heldRead = f.holdRead();
  f.tab.emitAuth('TOKEN_REFRESHED', FIXTURE_OWNER); await f.settle();
  assert.equal(f.reads.length, reads); assert.equal(nodes(f.gate.render()).some(node => node.props['data-owner-editor']), false);
  auth.resolve({ data: { user: { id: FIXTURE_OWNER, email: 'a@example.test' } }, error: null }); await f.settle();
  assert.equal(f.reads.length, reads + 1); assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
  heldRead.resolve(); await f.settle(); assert.match(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

for (const result of ['error', 'mismatch'] as const) test(`stopped-loop ${result} verification cannot restore dispatch or private content`, async t => {
  const f = panelFixture(t); await f.settle(); await retireAndPrepare(f);
  const held = f.tab.holdNextAuth(), reads = f.reads.length, before = f.tab.local.getItem(KEY);
  f.tab.emitAuth('TOKEN_REFRESHED', FIXTURE_OWNER); await f.settle();
  held.resolve(result === 'error' ? { data: { user: null }, error: new Error('synthetic verification failure') }
    : { data: { user: { id: OTHER, email: 'b@example.test' } }, error: null });
  await f.settle(); f.tab.dispatch({ type: 'focus' }); f.tab.pollIntervals(); await f.settle();
  assert.equal(f.reads.length, reads); assert.deepEqual(f.writes, []); assert.equal(f.tab.local.getItem(KEY), before);
  assert.match(f.panel.text(), /로그인 상태를 확인하지 못했습니다/);
  assert.equal(nodes(f.gate.render()).some(node => node.props['data-owner-editor']), false);
});

test('late same-owner verification cannot displace a newer B activation or clear its live registration', async t => {
  const f = panelFixture(t); await f.settle(); await retireAndPrepare(f);
  const old = f.tab.holdNextAuth(); f.tab.emitAuth('TOKEN_REFRESHED', FIXTURE_OWNER); await f.settle();
  f.tab.emitAuth('SIGNED_IN', OTHER); f.tab.flushTimers(); await f.settle();
  const reads = f.reads.length; assert.equal(f.reads.at(-1)?.userId, OTHER);
  old.resolve({ data: { user: { id: FIXTURE_OWNER, email: 'a@example.test' } }, error: null }); await f.settle();
  assert.equal(f.reads.length, reads); assert.equal(f.tab.local.getItem(KEY), JSON.stringify({ original: 'B only' }));
  const authReads = f.tab.authReads.length; f.tab.emitAuth('TOKEN_REFRESHED', OTHER); await f.settle();
  assert.equal(f.tab.authReads.length, authReads); assert.equal(f.reads.length, reads);
  assert.match(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

test('duplicate retired-loop callbacks publish only the latest verified generation', async t => {
  const f = panelFixture(t); await f.settle(); await retireAndPrepare(f);
  const older = f.tab.holdNextAuth(), latest = f.tab.holdNextAuth(), reads = f.reads.length;
  f.tab.emitAuth('SIGNED_IN', FIXTURE_OWNER); f.tab.emitAuth('TOKEN_REFRESHED', FIXTURE_OWNER); await f.settle();
  assert.equal(f.reads.length, reads);
  latest.resolve({ data: { user: { id: FIXTURE_OWNER, email: 'a@example.test' } }, error: null }); await f.settle();
  assert.equal(f.reads.length, reads + 1);
  older.resolve({ data: { user: null }, error: new Error('obsolete auth failure') }); await f.settle();
  assert.equal(f.reads.length, reads + 1); assert.match(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

for (const previous of [FIXTURE_OWNER, OTHER]) test(`an old ${previous} read stays aborted after the other owner becomes current`, async t => {
  const next = previous === FIXTURE_OWNER ? OTHER : FIXTURE_OWNER;
  const expected = JSON.stringify({ original: next === OTHER ? 'B only' : 'A preserved' });
  const f = panelFixture(t, storageBrowser(), 'first', previous), old = f.holdRead(); await f.settle();
  const signal = f.reads[0].signal; assert.equal(signal?.aborted, false);
  f.tab.emitAuth('SIGNED_IN', next); f.tab.flushTimers(); await f.settle();
  assert.equal(signal?.aborted, true); assert.equal(f.tab.local.getItem(KEY), expected);
  const reads = f.reads.length; old.resolve(); await f.settle();
  assert.equal(f.reads.length, reads); assert.equal(f.tab.local.getItem(KEY), expected);
  assert.match(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

test('unmount retires a pending renewal before its late verified owner can dispatch', async t => {
  const f = panelFixture(t); await f.settle(); await retireAndPrepare(f);
  const held = f.tab.holdNextAuth(), reads = f.reads.length;
  f.tab.emitAuth('TOKEN_REFRESHED', FIXTURE_OWNER); await f.settle(); f.panel.dispose();
  held.resolve({ data: { user: { id: FIXTURE_OWNER, email: 'a@example.test' } }, error: null }); await f.settle();
  assert.equal(f.reads.length, reads); assert.deepEqual(f.writes, []);
});

test('renewal cannot dispatch during reset or bypass failed owner preparation', async t => {
  const f = panelFixture(t); await f.settle(); await retireAndPrepare(f);
  f.controls.resetRunning = true; const reads = f.reads.length;
  f.tab.emitAuth('TOKEN_REFRESHED', FIXTURE_OWNER); await f.settle();
  assert.equal(f.reads.length, reads); assert.deepEqual(f.writes, []);
  f.controls.resetRunning = false;
  f.tab.local.setItem(f.tab.transactions.STORAGE_JOURNAL_KEY, JSON.stringify({ [KEY]: f.tab.local.getItem(KEY) }));
  f.tab.emitAuth('SIGNED_IN', OTHER); await f.settle();
  assert.equal(f.reads.length, reads); assert.deepEqual(f.writes, []); assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
});
