import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { deferred, FIXTURE_OWNER, nodes, storageBrowser, storageTab, textOf, tick, type UiNode } from './helpers/storage-ui-fixture.ts';
import type { AuthenticatedStorageOwner } from '../app/data/authenticatedStorageOwner.ts';

const PANEL = 'app/components/CloudSyncPanel.tsx', GATE = 'app/components/AuthGate.tsx';
const OTHER = 'synthetic-owner-b', KEY = 'ai-fitness-daily-notes';
const EDITOR: UiNode = { type: 'textarea', props: { 'data-owner-editor': true } };

function panelFixture(t: TestContext, browser = storageBrowser(), name = 'first', owner: string | null = FIXTURE_OWNER, holdGate = false) {
  const tab = storageTab(browser, name, owner); t.after(tab.dispose);
  const cloud = tab.cloud, reads: { userId: string; signal?: AbortSignal }[] = [], writes: string[] = [];
  const remote = new Map<string, Record<string, unknown>>([[FIXTURE_OWNER, { [KEY]: { original: 'A preserved' } }], [OTHER, { [KEY]: { original: 'B only' } }]]);
  const readHolds: ReturnType<typeof deferred<void>>[] = [];
  const controls = { resetRunning: false, signOutCalls: 0, allowWrites: false };
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
    async saveRemoteStateIfUnchanged(userId: string, state: Record<string, unknown>) {
      writes.push(userId); if (!controls.allowWrites) throw new Error('unexpected update');
      remote.set(userId, structuredClone(state)); return true;
    },
  });
  tab.setModule('app/lib/unsavedChanges.ts', { requestSafeReload() { assert.fail('unexpected reset reload'); } });
  const gateAuth = holdGate ? tab.holdNextAuth() : undefined;
  const gate = tab.mount(GATE, { children: EDITOR }), panel = tab.mount(PANEL, { hideSignedOut: true });
  t.after(panel.dispose); t.after(gate.dispose);
  return { browser, tab, gate, gateAuth, panel, reads, writes, controls,
    remoteState: (userId: string) => remote.get(userId),
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

const READY = 'yeoni-authenticated-storage-owner-ready', RESET = 'ai-yeoni-record-reset';
const verified = (id = OTHER) => ({ data: { user: { id, email: `${id}@example.test` } }, error: null });
function ownership(f: ReturnType<typeof panelFixture>) {
  return f.tab.loadModule('app/data/authenticatedStorageOwner.ts') as typeof import('../app/data/authenticatedStorageOwner.ts');
}
function gateLease(f: ReturnType<typeof panelFixture>) {
  const lease = nodes(f.gate.render()).find(node => node.props.lease)?.props.lease as AuthenticatedStorageOwner | undefined;
  assert.ok(lease); return lease;
}
function transientlyRetire(f: ReturnType<typeof panelFixture>) {
  const get = f.tab.local.getItem; let samples = 0;
  f.tab.local.getItem = key => key === f.tab.transactions.STORAGE_PROTOCOL_KEY && samples < 12
    ? JSON.stringify({ version: 2, state: 'committed', generation: `synthetic-concurrent-${++samples}` }) : get(key);
  try { f.tab.dispatch({ type: 'storage', key: f.tab.transactions.STORAGE_PROTOCOL_KEY }); }
  finally { f.tab.local.getItem = get; }
  assert.match(f.panel.text(), /다른 창에서 로그인 상태가 변경되었습니다/);
}
async function pendingGateRetirement(t: TestContext, mode: 'epoch' | 'snapshot' = 'epoch') {
  const f = panelFixture(t, storageBrowser(), 'first', OTHER, true); await f.settle();
  assert.match(f.panel.text(), /서버 반영 완료/);
  const peer = storageTab(f.browser, 'peer', OTHER); t.after(peer.dispose);
  if (mode === 'epoch') {
    peer.transactions.invalidateStorageOwner(peer.local, OTHER);
    await peer.cloud.prepareLocalCloudState(OTHER); await f.settle();
  } else transientlyRetire(f);
  assert.match(f.panel.text(), /다른 창에서 로그인 상태가 변경되었습니다/);
  return { ...f, peer };
}
async function finishPendingGate(f: ReturnType<typeof panelFixture>) {
  f.gateAuth!.resolve(verified()); await f.gate.settle();
  return gateLease(f);
}

for (const mode of ['epoch', 'snapshot'] as const) test(`a fresh Gate proof recovers ${mode} retirement only after independent auth and a new read`, async t => {
  const f = await pendingGateRetirement(t, mode), auth = f.tab.holdNextAuth(), reads = f.reads.length;
  const lease = await finishPendingGate(f);
  assert.equal(nodes(f.gate.render()).some(node => node.props['data-owner-editor']), true);
  assert.equal(f.reads.length, reads); assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
  const read = f.holdRead(); auth.resolve(verified()); await f.settle();
  assert.equal(f.reads.length, reads + 1); assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
  read.resolve(); await f.settle();
  assert.match(f.panel.text(), /서버 반영 완료/); assert.equal(f.tab.local.getItem(KEY), JSON.stringify({ original: 'B only' }));
  assert.deepEqual(f.writes, []);
  const authReads = f.tab.authReads.length;
  f.tab.dispatch({ type: READY, detail: lease }); await f.settle();
  assert.equal(f.tab.authReads.length, authReads); assert.equal(f.reads.length, reads + 1);
});

for (const result of ['error', 'null', 'mismatch'] as const) test(`Gate wake cannot recover after ${result} panel verification or replay the same proof`, async t => {
  const f = await pendingGateRetirement(t), auth = f.tab.holdNextAuth(), reads = f.reads.length;
  const lease = await finishPendingGate(f);
  auth.resolve(result === 'error' ? { data: { user: null }, error: new Error('synthetic auth unavailable') }
    : result === 'null' ? { data: { user: null }, error: null } : verified(FIXTURE_OWNER));
  await f.settle(); const authReads = f.tab.authReads.length;
  f.tab.dispatch({ type: READY, detail: lease }); f.tab.dispatch({ type: 'focus' }); f.tab.pollIntervals(); f.tab.flushTimers(); await f.settle();
  assert.equal(f.reads.length, reads); assert.equal(f.tab.authReads.length, authReads);
  assert.doesNotMatch(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

for (const kind of ['fake', 'copy', 'revoked', 'foreign-document', 'wrong-owner', 'stale-epoch', 'serialized'] as const) test(`a ${kind} runtime proof cannot authorize panel recovery`, async t => {
  const f = await pendingGateRetirement(t), authReads = f.tab.authReads.length, reads = f.reads.length;
  const authority = ownership(f);
  const issuer = kind === 'foreign-document' ? f.peer : f.tab;
  const issuerAuthority = issuer.loadModule('app/data/authenticatedStorageOwner.ts') as typeof import('../app/data/authenticatedStorageOwner.ts');
  const lease = await issuerAuthority.verifyAuthenticatedStorageOwner(issuer.local, async () => verified(kind === 'wrong-owner' ? FIXTURE_OWNER : OTHER), id => issuer.cloud.prepareLocalCloudState(id));
  if (kind === 'revoked') authority.revokeAuthenticatedStorageOwner(lease);
  if (kind === 'stale-epoch') { f.peer.transactions.invalidateStorageOwner(f.peer.local, OTHER); await f.peer.cloud.prepareLocalCloudState(OTHER); }
  const proof = kind === 'copy' ? { ...lease } : kind === 'serialized' ? JSON.parse(JSON.stringify(lease))
    : kind === 'fake' ? { userId: OTHER, epoch: lease.epoch, signal: new AbortController().signal, isCurrent: () => true } : lease;
  f.tab.dispatch({ type: READY, detail: proof }); await f.settle();
  assert.equal(f.tab.authReads.length, authReads); assert.equal(f.reads.length, reads); assert.deepEqual(f.writes, []);
});

for (const fault of ['prepared', 'legacy', 'corrupt', 'missing-ready', 'owner-change', 'aba', 'reset-cycle', 'signout', 'revoke', 'unmount'] as const)
  test(`a ${fault} boundary during Gate-wake authentication prevents activation`, async t => {
    const f = await pendingGateRetirement(t), auth = f.tab.holdNextAuth(), reads = f.reads.length;
    const lease = await finishPendingGate(f);
    if (fault === 'prepared') f.tab.local.setItem(f.tab.transactions.STORAGE_PROTOCOL_KEY, JSON.stringify({ version: 2, state: 'prepared', generation: 'synthetic', transactionId: 'synthetic', before: {} }));
    if (fault === 'legacy') f.tab.local.setItem(f.tab.transactions.STORAGE_JOURNAL_KEY, '{}');
    if (fault === 'corrupt') f.tab.local.setItem(f.tab.transactions.STORAGE_PROTOCOL_KEY, '{broken');
    if (fault === 'missing-ready') f.tab.local.removeItem(f.tab.transactions.STORAGE_READY_KEY);
    if (fault === 'owner-change' || fault === 'aba') await f.peer.cloud.prepareLocalCloudState(FIXTURE_OWNER);
    if (fault === 'aba') await f.peer.cloud.prepareLocalCloudState(OTHER);
    if (fault === 'reset-cycle') { f.controls.resetRunning = true; f.tab.dispatch({ type: RESET }); f.controls.resetRunning = false; f.tab.dispatch({ type: RESET }); }
    if (fault === 'signout') { f.tab.emitAuth('SIGNED_OUT', null); f.tab.flushTimers(); }
    if (fault === 'revoke') ownership(f).revokeAuthenticatedStorageOwner(lease);
    if (fault === 'unmount') f.panel.dispose();
    auth.resolve(verified()); await f.settle();
    assert.equal(f.reads.length, reads); assert.deepEqual(f.writes, []);
    if (fault !== 'unmount') assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
  });

for (const boundary of ['revoke', 'reset-cycle', 'signout', 'owner-change'] as const) test(`${boundary} also fences a published Gate recovery before its effect mounts`, async t => {
  const f = await pendingGateRetirement(t), auth = f.tab.holdNextAuth(), reads = f.reads.length;
  const lease = await finishPendingGate(f); auth.resolve(verified());
  for (let index = 0; index < 3; index++) await tick();
  assert.equal(f.reads.length, reads, 'No effect has mounted yet');
  if (boundary === 'revoke') ownership(f).revokeAuthenticatedStorageOwner(lease);
  if (boundary === 'reset-cycle') { f.controls.resetRunning = true; f.tab.dispatch({ type: RESET }); f.controls.resetRunning = false; f.tab.dispatch({ type: RESET }); }
  if (boundary === 'signout') { f.tab.emitAuth('SIGNED_OUT', null); f.tab.flushTimers(); }
  if (boundary === 'owner-change') await f.peer.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  await f.settle(); assert.equal(f.reads.length, reads); assert.deepEqual(f.writes, []);
});

test('route Gate cleanup after activation does not revoke the independent global panel loop', async t => {
  const f = await pendingGateRetirement(t); const lease = await finishPendingGate(f); await f.settle();
  assert.match(f.panel.text(), /서버 반영 완료/);
  const signal = f.reads.at(-1)!.signal, reads = f.reads.length;
  f.gate.dispose(); assert.equal(lease.signal.aborted, true); await f.panel.settle();
  assert.equal(signal?.aborted, false); assert.match(f.panel.text(), /서버 반영 완료/);
  const nextGate = f.tab.mount(GATE, { children: EDITOR }); t.after(nextGate.dispose); await nextGate.settle(); await f.panel.settle();
  assert.equal(f.reads.length, reads); f.tab.dispatch({ type: 'focus' }); await f.panel.settle();
  assert.equal(f.reads.length, reads + 1); assert.match(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

test('a still-valid proof delivered before retirement is not replayed afterward', async t => {
  const f = panelFixture(t, storageBrowser(), 'first', OTHER); await f.settle(); f.gate.dispose();
  const lease = await ownership(f).verifyAuthenticatedStorageOwner(f.tab.local, async () => verified(), id => f.tab.cloud.prepareLocalCloudState(id));
  f.tab.dispatch({ type: READY, detail: lease });
  const authReads = f.tab.authReads.length, reads = f.reads.length;
  transientlyRetire(f); assert.equal(lease.isCurrent(), true);
  f.tab.dispatch({ type: READY, detail: lease }); await f.panel.settle();
  assert.equal(f.tab.authReads.length, authReads); assert.equal(f.reads.length, reads); assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
});

test('explicit retry supersedes a pending Gate proof without accepting its late auth result', async t => {
  const f = await pendingGateRetirement(t), old = f.tab.holdNextAuth(), reads = f.reads.length;
  await finishPendingGate(f); const retry = f.tab.holdNextAuth(); syncButton(f)();
  old.resolve(verified()); await f.settle(); assert.equal(f.reads.length, reads);
  retry.resolve({ data: { user: null }, error: new Error('explicit retry unavailable') }); await f.settle();
  assert.equal(f.reads.length, reads); assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
});

test('a newer auth owner replaces pending proof without a late old activation or old status', async t => {
  const f = await pendingGateRetirement(t), old = f.tab.holdNextAuth(); await finishPendingGate(f);
  f.tab.emitAuth('SIGNED_IN', FIXTURE_OWNER); f.tab.flushTimers(); await f.settle();
  const reads = f.reads.length; assert.equal(f.reads.at(-1)?.userId, FIXTURE_OWNER);
  old.resolve(verified()); await f.settle();
  assert.equal(f.reads.length, reads); assert.equal(f.tab.local.getItem(KEY), JSON.stringify({ original: 'A preserved' }));
  assert.match(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

test('the old same-epoch panel acknowledgment cannot mutate after retirement releases its held lock', async t => {
  const f = panelFixture(t, storageBrowser(), 'first', OTHER, true), old = f.holdRead(); await f.settle();
  const release = f.browser.holdLock(); t.after(release); const calls = f.browser.calls.length;
  old.resolve(); await f.settle(); assert.ok(f.browser.calls.length > calls);
  transientlyRetire(f);
  assert.equal(f.reads[0].signal?.aborted, true);
  const before = [...f.browser.values], writes = f.browser.writes.length;
  release(); await f.settle(); assert.deepEqual([...f.browser.values], before); assert.equal(f.browser.writes.length, writes);
  await finishPendingGate(f); await f.settle();
  assert.match(f.panel.text(), /서버 반영 완료/); assert.equal(f.tab.local.getItem(KEY), JSON.stringify({ original: 'B only' }));
  assert.deepEqual(f.writes, []);
});

test('an old delayed GET cannot change the recovered loop or its acknowledged B snapshot', async t => {
  const f = panelFixture(t, storageBrowser(), 'first', OTHER, true), old = f.holdRead(); await f.settle();
  transientlyRetire(f); await finishPendingGate(f); await f.settle();
  const before = [...f.browser.values], reads = f.reads.length;
  assert.match(f.panel.text(), /서버 반영 완료/); old.resolve(); await f.settle();
  assert.deepEqual([...f.browser.values], before); assert.equal(f.reads.length, reads);
  assert.match(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

for (const failure of ['auth-error', 'pending-proof-revocation'] as const) test(`a new route Gate proof can retry ${failure} without replaying the old proof`, async t => {
  const f = await pendingGateRetirement(t), auth = f.tab.holdNextAuth(), reads = f.reads.length;
  await finishPendingGate(f);
  if (failure === 'auth-error') auth.resolve({ data: { user: null }, error: new Error('temporary synthetic auth failure') });
  else {
    auth.resolve(verified()); for (let index = 0; index < 3; index++) await tick();
    f.gate.dispose();
  }
  await f.panel.settle(); assert.equal(f.reads.length, reads);
  f.gate.dispose();
  const next = f.tab.mount(GATE, { children: EDITOR }); t.after(next.dispose);
  await next.settle(); await f.panel.settle();
  assert.equal(f.reads.length, reads + 1); assert.match(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

test('duplicate fresh proofs coalesce and a newer proof supersedes an older pending auth result', async t => {
  const f = await pendingGateRetirement(t), older = f.tab.holdNextAuth(), reads = f.reads.length;
  const oldLease = await finishPendingGate(f), authReads = f.tab.authReads.length;
  f.tab.dispatch({ type: READY, detail: oldLease });
  assert.equal(f.tab.authReads.length, authReads);
  f.gate.dispose(); const newer = f.tab.holdNextAuth();
  const newGate = f.tab.mount(GATE, { children: EDITOR }); t.after(newGate.dispose);
  const newest = f.tab.holdNextAuth(); newer.resolve(verified()); await newGate.settle();
  newest.resolve(verified()); await f.panel.settle();
  assert.equal(f.reads.length, reads + 1);
  older.resolve(verified(FIXTURE_OWNER)); await f.panel.settle();
  assert.equal(f.reads.length, reads + 1); assert.match(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

for (const failure of ['legacy', 'corrupt'] as const) test(`failed ${failure} Gate preparation never emits a recovery authority`, async t => {
  const f = await pendingGateRetirement(t), reads = f.reads.length, authReads = f.tab.authReads.length;
  if (failure === 'legacy') f.tab.local.setItem(f.tab.transactions.STORAGE_JOURNAL_KEY, '{}');
  else f.tab.local.setItem(f.tab.transactions.STORAGE_PROTOCOL_KEY, '{broken');
  f.gateAuth!.resolve(verified()); await f.settle();
  assert.equal(f.tab.authReads.length, authReads); assert.equal(f.reads.length, reads);
  assert.match(f.gate.text(), /로그인 확인을 완료하지 못했어요/); assert.doesNotMatch(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

test('recovery reads a fresh B request including newer B edits and never changes A state', async t => {
  const f = await pendingGateRetirement(t, 'snapshot');
  const oldA = structuredClone(f.remoteState(FIXTURE_OWNER)), next = { original: 'B only', newer: 'synthetic B edit while stopped' };
  await f.tab.transactions.writeStorageBatch(f.tab.local, { [KEY]: JSON.stringify(next) });
  f.controls.allowWrites = true; await finishPendingGate(f); await f.settle();
  assert.match(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, [OTHER]);
  assert.deepEqual(f.remoteState(FIXTURE_OWNER), oldA);
  assert.equal(JSON.stringify(f.remoteState(OTHER)?.[KEY]), JSON.stringify(next));
  assert.equal(f.tab.local.getItem(KEY), JSON.stringify(next));
});

test('a pending or locked device PIN cannot issue a panel recovery wake', async t => {
  const f = await pendingGateRetirement(t), pin = f.tab.holdNextPin(), reads = f.reads.length, authReads = f.tab.authReads.length;
  f.gateAuth!.resolve(verified()); await f.gate.settle();
  assert.equal(f.tab.authReads.length, authReads); assert.equal(f.reads.length, reads);
  pin.resolve(true); await f.settle();
  assert.equal(f.tab.authReads.length, authReads); assert.equal(f.reads.length, reads);
  assert.equal(nodes(f.gate.render()).some(node => node.props['data-owner-editor']), false);
  assert.doesNotMatch(f.panel.text(), /서버 반영 완료/); assert.deepEqual(f.writes, []);
});

test('fresh Gate verification does not silently retry an ordinary live network error', async t => {
  const f = panelFixture(t, storageBrowser(), 'first', OTHER, true), read = f.holdRead(); await f.settle();
  read.reject(new Error('synthetic remote read unavailable')); await f.settle();
  const reads = f.reads.length, authReads = f.tab.authReads.length;
  await finishPendingGate(f); await f.settle();
  assert.equal(f.reads.length, reads); assert.equal(f.tab.authReads.length, authReads);
  assert.match(f.panel.text(), /synthetic remote read unavailable/); assert.deepEqual(f.writes, []);
});

const RECHECK = 'yeoni-authenticated-storage-owner-recheck', RECHECK_READY = 'yeoni-authenticated-storage-owner-recheck-ready';
function retireOnlyPanel(f: ReturnType<typeof panelFixture>) {
  const get = f.tab.local.getItem; let samples = 0;
  f.tab.local.getItem = key => {
    if (key !== f.tab.transactions.STORAGE_PROTOCOL_KEY) return get(key);
    samples++;
    // Gate's two coherent checks precede the panel's two exhausted snapshots.
    return samples > 4 && samples <= 16 ? JSON.stringify({ version: 2, state: 'committed', generation: `synthetic-overlap-${samples}` }) : get(key);
  };
  try { f.tab.dispatch({ type: 'storage', key: f.tab.transactions.STORAGE_PROTOCOL_KEY }); }
  finally { f.tab.local.getItem = get; }
  assert.match(f.panel.text(), /다른 창에서 로그인 상태가 변경되었습니다/);
}
function observeRecheck(f: ReturnType<typeof panelFixture>) {
  const runtime = ownership(f), create = runtime.createAuthenticatedStorageOwnerRecheck, register = runtime.registerAuthenticatedStorageOwnerRecheckProof;
  const requests: import('../app/data/authenticatedStorageOwner.ts').AuthenticatedStorageOwnerRecheck[] = [];
  const proofs: AuthenticatedStorageOwner[] = [];
  runtime.createAuthenticatedStorageOwnerRecheck = (...args) => { const request = create(...args); requests.push(request); return request; };
  runtime.registerAuthenticatedStorageOwnerRecheckProof = (...args) => { register(...args); proofs.push(args[1]); };
  return { runtime, requests, proofs };
}
const suspendedWrapper = (f: ReturnType<typeof panelFixture>) => nodes(f.gate.render()).find(node => node.props.hidden === true && node.props.inert === true);

test('a pre-retirement Gate proof gets one fresh exact-ready recheck without losing its mounted same-owner draft', async t => {
  const f = panelFixture(t, storageBrowser(), 'first', OTHER); await f.settle();
  const observed = observeRecheck(f), oldLease = gateLease(f), originalTree = f.gate.render(), oldLoop = f.reads.at(-1)!.signal;
  const reads = f.reads.length, authReads = f.tab.authReads.length, writes = f.browser.writes.length, locks = f.browser.calls.length;
  const auth = f.tab.holdNextAuth(), panelAuth = f.tab.holdNextAuth();
  retireOnlyPanel(f); assert.equal(oldLease.isCurrent(), true); assert.equal(f.tab.authReads.length, authReads);
  f.tab.flushTimers(); await f.settle();
  assert.equal(observed.requests.length, 1); assert.equal(f.tab.authReads.length, authReads + 1);
  assert.equal(oldLease.signal.aborted, true); assert.equal(oldLoop?.aborted, true);
  const hidden = suspendedWrapper(f); assert.ok(hidden); assert.equal(JSON.stringify(hidden.props.style), JSON.stringify({ display: 'none' }));
  assert.equal(hidden.props['aria-hidden'], true); assert.ok(nodes(hidden).includes(EDITOR));
  assert.equal(f.gate.render().type, originalTree.type); assert.equal(f.gate.render().key, originalTree.key);
  const beforeProvider = nodes(originalTree).find(node => 'lease' in node.props)!;
  const pendingProvider = nodes(f.gate.render()).find(node => 'lease' in node.props)!;
  assert.equal(pendingProvider.type, beforeProvider.type); assert.equal(pendingProvider.props.lease, null);
  assert.throws(() => { observed.runtime.assertAuthenticatedStorageOwner(oldLease); f.tab.local.setItem(KEY, 'forbidden stale action'); });
  assert.equal(f.browser.writes.length, writes, 'A captured lease-backed action cannot write while its subtree stays mounted');
  for (let i = 0; i < 3; i++) { f.tab.dispatch({ type: 'focus' }); f.tab.pollIntervals(); f.tab.dispatch({ type: RECHECK, detail: observed.requests[0] }); f.tab.flushTimers(); }
  assert.equal(f.tab.authReads.length, authReads + 1);
  auth.resolve(verified()); await f.settle();
  assert.equal(observed.proofs.length, 1); assert.notEqual(observed.proofs[0], oldLease);
  assert.equal(suspendedWrapper(f), undefined); assert.ok(nodes(f.gate.render()).includes(EDITOR));
  assert.equal(f.tab.authReads.length, authReads + 2); assert.equal(f.reads.length, reads);
  const result = { request: observed.requests[0], proof: observed.proofs[0] };
  // Neither a duplicate dedicated response nor the wrong response channel can
  // cancel or replace the legitimate in-flight panel authentication.
  f.tab.dispatch({ type: RECHECK_READY, detail: result }); f.tab.dispatch({ type: READY, detail: result.proof });
  await f.settle(); assert.equal(result.request.signal.aborted, false); assert.equal(f.reads.length, reads);
  panelAuth.resolve(verified()); await f.settle();
  assert.match(f.panel.text(), /서버 반영 완료/); assert.equal(f.reads.length, reads + 1);
  assert.equal(f.browser.calls.length, locks + 1, 'Only the new read acknowledgment may acquire a lock; recheck never prepares storage');
  assert.equal(f.browser.writes.length, writes); assert.deepEqual(f.writes, []);
  assert.throws(() => observed.runtime.assertAuthenticatedStorageOwnerRecheck(result.request, f.tab.local));
  const signal = f.reads.at(-1)!.signal;
  f.tab.dispatch({ type: RECHECK, detail: result.request }); f.tab.dispatch({ type: RECHECK_READY, detail: result }); await f.settle();
  assert.equal(f.reads.length, reads + 1); assert.equal(f.tab.authReads.length, authReads + 2);
  f.gate.dispose(); await f.panel.settle(); assert.equal(result.proof.signal.aborted, true); assert.equal(signal?.aborted, false);
  assert.match(f.panel.text(), /서버 반영 완료/);
});

test('automatic replacement inherits its consumed budget and cannot form a repeated recheck loop', async t => {
  const f = panelFixture(t, storageBrowser(), 'first', OTHER); await f.settle(); const observed = observeRecheck(f);
  retireOnlyPanel(f); f.tab.flushTimers(); await f.settle(); assert.match(f.panel.text(), /서버 반영 완료/);
  const reads = f.reads.length, auth = f.tab.authReads.length;
  retireOnlyPanel(f); f.tab.flushTimers(); await f.settle();
  for (let i = 0; i < 3; i++) { f.tab.dispatch({ type: 'focus' }); f.tab.dispatch({ type: 'storage' }); f.tab.pollIntervals(); f.tab.flushTimers(); await f.settle(); }
  assert.equal(observed.requests.length, 1); assert.equal(f.tab.authReads.length, auth); assert.equal(f.reads.length, reads);
  assert.match(f.panel.text(), /다른 창에서 로그인 상태가 변경되었습니다/);
  syncButton(f)(); await f.settle(); assert.match(f.panel.text(), /서버 반영 완료/);
});

for (const fault of ['ready', 'language', 'prepared', 'legacy', 'corrupt', 'epoch', 'reset'] as const)
  test(`a ${fault} boundary before the one deferred attempt never supersedes normal Gate work`, async t => {
    const f = panelFixture(t, storageBrowser(), 'first', OTHER); await f.settle(); const observed = observeRecheck(f);
    retireOnlyPanel(f); const reads = f.tab.authReads.length;
    if (fault === 'ready') f.tab.local.removeItem(f.tab.transactions.STORAGE_READY_KEY);
    if (fault === 'language') f.tab.local.removeItem('language-storage-binding-v1');
    if (fault === 'prepared') f.tab.local.setItem(f.tab.transactions.STORAGE_PROTOCOL_KEY, JSON.stringify({ version: 2, state: 'prepared', generation: 'synthetic', transactionId: 'synthetic', before: {} }));
    if (fault === 'legacy') f.tab.local.setItem(f.tab.transactions.STORAGE_JOURNAL_KEY, '{}');
    if (fault === 'corrupt') f.tab.local.setItem(f.tab.transactions.STORAGE_PROTOCOL_KEY, '{broken');
    if (fault === 'epoch') f.tab.transactions.invalidateStorageOwner(f.tab.local, OTHER);
    if (fault === 'reset') { f.controls.resetRunning = true; f.tab.dispatch({ type: RESET }); }
    const before = [...f.browser.values], writes = f.browser.writes.length;
    f.tab.flushTimers(); await f.settle();
    assert.equal(observed.requests.length, 0); assert.equal(f.tab.authReads.length, reads);
    assert.deepEqual([...f.browser.values], before); assert.equal(f.browser.writes.length, writes);
  });

for (const phase of ['gate-auth', 'pin', 'panel-auth', 'activation'] as const)
  for (const boundary of ['signout', 'owner-change', 'epoch-aba', 'reset', 'gate-unmount', 'panel-unmount'] as const)
    test(`${boundary} fences exact-ready recheck at ${phase} without resurrecting its hidden draft or old result`, async t => {
      const f = panelFixture(t, storageBrowser(), 'first', OTHER); await f.settle(); const observed = observeRecheck(f);
      const held = phase === 'gate-auth' ? f.tab.holdNextAuth() : phase === 'pin' ? f.tab.holdNextPin() : undefined;
      const panelAuth = phase === 'panel-auth' || phase === 'activation' ? f.tab.holdNextAuth() : undefined;
      // For a held panel lookup the Gate lookup must consume an earlier entry.
      const firstAuth = panelAuth ? panelAuth : undefined;
      retireOnlyPanel(f); f.tab.flushTimers(); await f.settle();
      if (firstAuth) {
        const actualPanelAuth = f.tab.holdNextAuth(); firstAuth.resolve(verified()); await f.settle();
        if (phase === 'activation') { actualPanelAuth.resolve(verified()); for (let i = 0; i < 3; i++) await tick(); }
        else (f as unknown as { heldPanel: typeof actualPanelAuth }).heldPanel = actualPanelAuth;
      }
      const reads = f.reads.length;
      if (boundary === 'signout') f.tab.emitAuth('SIGNED_OUT', null);
      if (boundary === 'owner-change') { const peer = storageTab(f.browser, 'boundary', FIXTURE_OWNER); t.after(peer.dispose); await peer.cloud.prepareLocalCloudState(FIXTURE_OWNER); await tick(); }
      if (boundary === 'epoch-aba') { const peer = storageTab(f.browser, 'boundary', OTHER); t.after(peer.dispose); peer.transactions.invalidateStorageOwner(peer.local, OTHER); await peer.cloud.prepareLocalCloudState(OTHER); await tick(); }
      if (boundary === 'reset') { f.controls.resetRunning = true; f.tab.dispatch({ type: RESET }); f.controls.resetRunning = false; f.tab.dispatch({ type: RESET }); }
      if (boundary === 'gate-unmount') f.gate.dispose();
      if (boundary === 'panel-unmount') f.panel.dispose();
      if (phase === 'gate-auth') (held as ReturnType<typeof f.tab.holdNextAuth>).resolve(verified());
      if (phase === 'pin') (held as ReturnType<typeof f.tab.holdNextPin>).resolve(false);
      (f as unknown as { heldPanel?: ReturnType<typeof f.tab.holdNextAuth> }).heldPanel?.resolve(verified());
      f.tab.flushTimers(); await f.settle();
      assert.equal(observed.requests.length, 1); assert.equal(observed.requests[0].signal.aborted, true);
      assert.equal(f.reads.length, reads); assert.deepEqual(f.writes, []);
      if (boundary !== 'gate-unmount') { assert.equal(suspendedWrapper(f), undefined); assert.equal(nodes(f.gate.render()).includes(EDITOR), false); assert.doesNotMatch(f.gate.text(), /불러오는 중/); }
      if (boundary !== 'panel-unmount') assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
    });

for (const fault of ['error', 'null', 'mismatch', 'pin-error', 'pin-locked'] as const)
  test(`exact-ready ${fault} failure cannot expose the preserved draft or automatically retry`, async t => {
    const f = panelFixture(t, storageBrowser(), 'first', OTHER); await f.settle(); const observed = observeRecheck(f);
    const auth = f.tab.holdNextAuth(), pin = fault.startsWith('pin') ? f.tab.holdNextPin() : undefined;
    retireOnlyPanel(f); f.tab.flushTimers(); await f.settle();
    const reads = f.reads.length, writes = f.browser.writes.length;
    auth.resolve(fault === 'error' ? { data: { user: null }, error: new Error('synthetic recheck failure') }
      : fault === 'null' ? { data: { user: null }, error: null } : verified(fault === 'mismatch' ? FIXTURE_OWNER : OTHER));
    await f.settle(); if (fault === 'pin-error') pin!.reject(new Error('synthetic PIN failure')); else pin?.resolve(true);
    await f.settle(); const authReads = f.tab.authReads.length;
    f.tab.dispatch({ type: RECHECK, detail: observed.requests[0] }); f.tab.flushTimers(); f.tab.pollIntervals(); await f.settle();
    assert.equal(f.tab.authReads.length, authReads); assert.equal(f.reads.length, reads); assert.equal(f.browser.writes.length, writes);
    assert.equal(nodes(f.gate.render()).includes(EDITOR), false); assert.equal(suspendedWrapper(f), undefined);
    assert.equal(observed.proofs.length, 0); assert.doesNotMatch(f.gate.text(), /불러오는 중/);
  });

for (const phase of ['gate-auth', 'panel-auth'] as const) for (const successor of ['manual-retry', 'same-owner-callback'] as const)
  test(`${successor} supersedes correlated ${phase} and its late result cannot clear the new binding`, async t => {
    const f = panelFixture(t, storageBrowser(), 'first', OTHER); await f.settle(); const observed = observeRecheck(f);
    const gateAuth = f.tab.holdNextAuth(); retireOnlyPanel(f); f.tab.flushTimers(); await f.settle();
    let old = gateAuth;
    if (phase === 'panel-auth') { old = f.tab.holdNextAuth(); gateAuth.resolve(verified()); await f.settle(); }
    if (successor === 'manual-retry') syncButton(f)();
    else { f.tab.emitAuth('TOKEN_REFRESHED', OTHER); f.tab.flushTimers(); }
    await f.settle(); assert.match(f.panel.text(), /서버 반영 완료/);
    const reads = f.reads.length, signal = f.reads.at(-1)!.signal, current = successor === 'same-owner-callback' ? gateLease(f) : undefined;
    assert.equal(observed.requests[0].signal.aborted, true);
    old.resolve(verified()); await f.settle();
    assert.equal(f.reads.length, reads); assert.equal(signal?.aborted, false); assert.match(f.panel.text(), /서버 반영 완료/);
    if (current) assert.equal(gateLease(f), current);
    else { assert.equal(nodes(f.gate.render()).includes(EDITOR), false); assert.doesNotMatch(f.gate.text(), /불러오는 중/); }
  });

for (const failure of ['error', 'null', 'mismatch'] as const)
  test(`correlated panel ${failure} cancels the published requested Gate proof without read or hidden-draft revival`, async t => {
    const f = panelFixture(t, storageBrowser(), 'first', OTHER); await f.settle(); const observed = observeRecheck(f);
    const gateAuth = f.tab.holdNextAuth(); retireOnlyPanel(f); f.tab.flushTimers(); await f.settle();
    const auth = f.tab.holdNextAuth(), reads = f.reads.length, writes = f.browser.writes.length;
    gateAuth.resolve(verified()); await f.settle(); assert.equal(observed.proofs.length, 1);
    auth.resolve(failure === 'error' ? { data: { user: null }, error: new Error('synthetic panel verification failure') }
      : failure === 'null' ? { data: { user: null }, error: null } : verified(FIXTURE_OWNER));
    await f.settle();
    assert.equal(observed.requests[0].signal.aborted, true); assert.equal(observed.proofs[0].signal.aborted, true);
    assert.equal(f.reads.length, reads); assert.equal(f.browser.writes.length, writes); assert.equal(nodes(f.gate.render()).includes(EDITOR), false);
    assert.equal(suspendedWrapper(f), undefined); assert.doesNotMatch(f.gate.text(), /불러오는 중/);
    assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
  });
