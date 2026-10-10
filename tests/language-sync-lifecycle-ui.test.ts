import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { deferred, FIXTURE_OWNER, nodes, storageBrowser, storageTab, type UiNode } from './helpers/storage-ui-fixture.ts';
import type { AuthenticatedStorageOwner } from '../app/data/authenticatedStorageOwner.ts';

const AUTH_GATE = 'app/components/AuthGate.tsx';
const COMPONENT = 'components/LanguageCloudSync.tsx';
const editor: UiNode = { type: 'textarea', props: { 'data-language-editor': true, defaultValue: 'synthetic unsaved language draft' } };
type Row = { state: Record<string, unknown>; updated_at: string };
type SdkResult = { data: Row | { updated_at: string } | null; error: Error | null };

async function languageFixture(t: TestContext, browser = storageBrowser(), name = 'language') {
  const tab = storageTab(browser, name); t.after(tab.dispose);
  const gate = tab.mount(AUTH_GATE, { children: editor }); t.after(gate.dispose); await gate.settle();
  const lease = nodes(gate.render()).find(node => node.props.lease)?.props.lease as AuthenticatedStorageOwner;
  assert.ok(lease?.isCurrent());
  tab.setModule('app/components/AuthenticatedStorageOwner.tsx', { useAuthenticatedStorageOwner: () => lease });
  const original = tab.loadModule('app/lib/supabase.ts') as { supabase: { auth: unknown } };
  const calls: { kind: string; signal?: AbortSignal; filters: [string, unknown][] }[] = [];
  const writeWaits: ReturnType<typeof deferred<SdkResult>>[] = [];
  let nextReadback: ReturnType<typeof deferred<SdkResult>> | null = null;
  const readWaits: ReturnType<typeof deferred<SdkResult>>[] = [];
  let remote: Row | null = { state: {}, updated_at: 'synthetic-0' }, revision = 0;
  let readError: Error | null = null;
  let reusedTimestampRace: Record<string, unknown> | null = null;
  const sdk = { auth: original.supabase.auth, from(table: string) {
    assert.equal(table, 'language_user_state');
    let kind = 'read', payload: Record<string, unknown> = {}, signal: AbortSignal | undefined;
    const filters: [string, unknown][] = [];
    const execute = async (): Promise<SdkResult> => {
      calls.push({ kind, signal, filters: [...filters] });
      if (kind !== 'insert') assert.ok(filters.some(([key, value]) => key === 'user_id' && value === lease.userId));
      if (kind === 'read') {
        if (readWaits.length) return readWaits.shift()!.promise;
        return { data: remote, error: readError };
      }
      if (kind === 'update' && reusedTimestampRace && remote) { remote = { state: reusedTimestampRace, updated_at: remote.updated_at }; reusedTimestampRace = null; }
      if (kind === 'update' && !filters.some(([key, value]) => key === 'updated_at' && value === remote?.updated_at)) return { data: null, error: null };
      if (kind === 'insert') assert.equal(payload.user_id, lease.userId);
      remote = { state: payload.state as Record<string, unknown>, updated_at: `synthetic-${++revision}` };
      if (nextReadback) { readWaits.push(nextReadback); nextReadback = null; }
      if (writeWaits.length) return writeWaits.shift()!.promise;
      return { data: { updated_at: remote.updated_at }, error: null };
    };
    const query = {
      select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      abortSignal(value: AbortSignal) { signal = value; return query; },
      insert(value: Record<string, unknown>) { kind = 'insert'; payload = value; return query; },
      update(value: Record<string, unknown>) { kind = 'update'; payload = value; return query; },
      maybeSingle: execute,
      then(yes: (value: SdkResult) => unknown, no?: (error: unknown) => unknown) { return execute().then(yes, no); },
    };
    return query;
  } };
  tab.setModule('app/lib/supabase.ts', { supabase: sdk });
  return {
    browser, tab, gate, lease, calls,
    mount() { const view = tab.mount(COMPONENT, { children: editor }); t.after(view.dispose); return view; },
    holdRead() { const hold = deferred<SdkResult>(); readWaits.push(hold); return hold; },
    setRemote(state: Record<string, unknown>) { remote = { state, updated_at: `synthetic-${++revision}` }; },
    removeRemote() { remote = null; },
    raceWithReusedTimestamp(state: Record<string, unknown>) { reusedTimestampRace = state; },
    remoteState() { return remote?.state; },
    holdWrite() { const hold = deferred<SdkResult>(); writeWaits.push(hold); return hold; },
    holdReadback() { const hold = deferred<SdkResult>(); nextReadback = hold; return hold; },
    failRead() { readError = new Error('synthetic language GET unavailable'); },
  };
}
const editorContainer = (tree: UiNode) => nodes(tree).find(node => node.type === 'div' && (node.props.children as UiNode | undefined)?.props?.children === editor);

for (const newerGoal of [3, 5]) test(`warm language settings PATCH retains verified editing, queues goal ${newerGoal}, and confirms only exact readback`, async t => {
  const f = await languageFixture(t);
  const integrated = '{"dailyMinutes":10,"unknown":90071992547409933333}';
  f.setRemote({ learningSettings: '{"dailyGoalCount":5}', integratedLearningSettingsV1: integrated });
  const view = f.mount(); await view.settle();
  const container = editorContainer(view.render())!;
  const context = (container.props.children as UiNode).props.context as import('../app/data/languageCloudSync.ts').LanguageRecordContext;
  const language = f.tab.loadModule('app/data/languageCloudSync.ts') as typeof import('../app/data/languageCloudSync.ts');
  const settings = f.tab.loadModule('app/data/languageSettingsMutations.ts') as typeof import('../app/data/languageSettingsMutations.ts');
  const saveGoal = async (current: typeof context, dailyGoalCount: number) => {
    const source = language.readLanguageRecordSnapshot(current);
    const receipt = await settings.runLanguageSettingsMutation(settings.createLearningSettingsMutation(current, source, Object.assign(Object.create(null), { dailyGoalCount })), current);
    assert.equal(receipt.acknowledged, true);
    await view.settle();
  };
  await saveGoal(context, 4);
  assert.match(view.text(), /학습 기록 · 기기 저장, 서버 반영 대기/);
  const heldWrite = f.holdWrite(), heldReadback = f.holdReadback();
  f.tab.flushTimers(); await view.settle();
  assert.equal(f.calls.at(-1)!.kind, 'update');
  assert.match(view.text(), /학습 기록 · 서버 반영 중…/);
  assert.equal(editorContainer(view.render())?.props.hidden, false);
  assert.equal(editorContainer(view.render())?.props.inert, false);
  assert.equal((editorContainer(view.render())!.props.children as UiNode).props.context, context);
  assert.equal(editorContainer(view.render())?.key, container.key);
  assert.doesNotMatch(view.text(), /학습 기록 · 서버 저장 확인/);
  // Reobserving the sent bytes is not a newer edit and must not change the label.
  f.tab.dispatch({ type: f.tab.transactions.RECORDS_CHANGED_EVENT }); await view.settle();
  assert.match(view.text(), /학습 기록 · 서버 반영 중…/);
  await saveGoal(context, newerGoal);
  assert.match(view.text(), /학습 기록 · 기기 저장, 서버 반영 대기/);
  assert.equal(editorContainer(view.render())?.props.hidden, false);
  assert.equal(f.tab.pendingTimers, 0, 'A newer edit does not dispatch a parallel request');
  assert.equal(f.calls.filter(call => call.kind === 'update').length, 1);
  assert.equal(f.remoteState()?.learningSettings, '{"dailyGoalCount":4}');
  const acknowledgement = f.tab.local.getItem(`language-cloud-sync-ack:${f.lease.userId}`);
  heldWrite.resolve({ data: { updated_at: 'synthetic-2' }, error: null }); await view.settle();
  assert.equal(f.calls.at(-1)!.kind, 'read');
  assert.equal(f.tab.local.getItem(`language-cloud-sync-ack:${f.lease.userId}`), acknowledgement);
  assert.doesNotMatch(view.text(), /학습 기록 · 서버 저장 확인/);
  heldReadback.resolve({ data: { state: f.remoteState()!, updated_at: 'synthetic-2' }, error: null }); await view.settle();
  assert.equal(f.tab.local.getItem('learningSettings'), JSON.stringify({ dailyGoalCount: newerGoal }));
  assert.equal(f.tab.local.getItem('integratedLearningSettingsV1'), integrated);
  assert.match(view.text(), /학습 기록 · 기기 저장, 서버 반영 대기/);
  assert.equal(f.tab.pendingTimers, 1);
  f.tab.flushTimers(); await view.settle();
  assert.equal(f.remoteState()?.learningSettings, JSON.stringify({ dailyGoalCount: newerGoal }));
  assert.equal(f.remoteState()?.integratedLearningSettingsV1, integrated);
  assert.equal(f.calls.filter(call => call.kind === 'update').length, 2);
  assert.match(view.text(), /학습 기록 · 서버 저장 확인/);
  assert.equal(f.tab.pendingTimers, 0);
});

for (const phase of ['auth', 'read', 'retry'] as const) test(`warm settings ${phase} verification never exposes old editing authority`, async t => {
  const f = await languageFixture(t), view = f.mount(); await view.settle();
  const original = editorContainer(view.render())!;
  f.tab.local.setItem('learningSettings', '{"dailyGoalCount":4}');
  const held = phase === 'auth' ? f.tab.holdNextAuth() : f.holdRead();
  if (phase === 'retry') { f.tab.dispatch({ type: 'pagehide' }); view.click('학습 기록 다시 확인'); }
  else f.tab.dispatch({ type: 'focus' });
  await view.settle();
  const gated = editorContainer(view.render())!;
  assert.equal(gated.key, original.key); assert.equal(gated.props.hidden, true); assert.equal(gated.props.inert, true);
  assert.equal((gated.props.children as UiNode).props.context, null);
  assert.doesNotMatch(view.text(), /서버 반영 중|서버 저장 확인/);
  assert.equal(f.calls.filter(call => call.kind !== 'read').length, 0);
  // Cleanup retires the unresolved validation without manufacturing a result.
  view.dispose();
  if (phase === 'auth') (held as ReturnType<typeof f.tab.holdNextAuth>).resolve({ data: { user: { id: FIXTURE_OWNER, email: 'a@example.test' } }, error: null });
  else (held as ReturnType<typeof f.holdRead>).resolve({ data: { state: {}, updated_at: 'late-verification' }, error: null });
  await view.settle();
  assert.equal(f.calls.filter(call => call.kind !== 'read').length, 0);
});

for (const boundary of ['signout', 'owner-change', 'reset', 'clear'] as const) test(`warm settings PATCH ${boundary} revokes editing and rejects its late acknowledgement`, async t => {
  const f = await languageFixture(t), view = f.mount(); await view.settle();
  const language = f.tab.loadModule('app/data/languageCloudSync.ts') as typeof import('../app/data/languageCloudSync.ts');
  const context = (editorContainer(view.render())!.props.children as UiNode).props.context as import('../app/data/languageCloudSync.ts').LanguageRecordContext;
  f.tab.local.setItem('learningSettings', '{"dailyGoalCount":4}');
  const hold = f.holdWrite(); f.tab.dispatch({ type: 'focus' }); await view.settle();
  assert.match(view.text(), /서버 반영 중…/); assert.equal(editorContainer(view.render())?.props.hidden, false);
  const request = f.calls.at(-1)!;
  if (boundary === 'signout') f.tab.emitAuth('SIGNED_OUT', null);
  else if (boundary === 'owner-change') f.tab.emitAuth('SIGNED_IN', 'synthetic-other-owner');
  else if (boundary === 'reset') {
    f.tab.local.setItem('language-reset-fence-v1', JSON.stringify({ version: 1, owner: f.lease.userId,
      requestId: '11111111-1111-4111-8111-111111111111', expectedMarker: null, state: 'pending' }));
    f.tab.dispatch({ type: 'storage', key: 'language-reset-fence-v1' });
  } else f.tab.dispatch({ type: 'storage', key: null });
  assert.equal(request.signal?.aborted, true); assert.equal(language.isLanguageRecordContextCurrent(context), false);
  assert.equal(editorContainer(view.render())?.props.hidden, true);
  assert.equal((editorContainer(view.render())!.props.children as UiNode).props.context, null);
  const ack = f.tab.local.getItem(`language-cloud-sync-ack:${f.lease.userId}`);
  const calls = f.calls.length;
  hold.resolve({ data: { updated_at: 'late-write' }, error: null }); await view.settle();
  assert.equal(f.calls.length, calls, 'Retired PATCH must not start readback');
  assert.equal(f.tab.local.getItem(`language-cloud-sync-ack:${f.lease.userId}`), ack);
  assert.equal(editorContainer(view.render())?.props.hidden, true);
  assert.doesNotMatch(view.text(), /서버 반영 중|서버 저장 확인/);
});

for (const failure of ['rejected-write', 'lost-response', 'mismatched-readback'] as const) test(`warm settings ${failure} gates the editor and never acknowledges the outstanding write`, async t => {
  const f = await languageFixture(t), view = f.mount(); await view.settle();
  const context = (editorContainer(view.render())!.props.children as UiNode).props.context as import('../app/data/languageCloudSync.ts').LanguageRecordContext;
  const language = f.tab.loadModule('app/data/languageCloudSync.ts') as typeof import('../app/data/languageCloudSync.ts');
  f.tab.local.setItem('learningSettings', '{"dailyGoalCount":4}');
  const hold = failure === 'mismatched-readback' ? f.holdReadback() : f.holdWrite();
  f.tab.dispatch({ type: 'focus' }); await view.settle();
  assert.equal(editorContainer(view.render())?.props.hidden, false); assert.match(view.text(), /서버 반영 중…/);
  const ack = f.tab.local.getItem(`language-cloud-sync-ack:${f.lease.userId}`);
  if (failure === 'lost-response') hold.reject(new Error('synthetic transport loss'));
  else if (failure === 'rejected-write') hold.resolve({ data: null, error: new Error('synthetic 412 precondition rejected') });
  else hold.resolve({ data: { state: { learningSettings: '{"dailyGoalCount":2}' }, updated_at: 'competitor' }, error: null });
  await view.settle();
  assert.equal(editorContainer(view.render())?.props.hidden, true); assert.equal(language.isLanguageRecordContextCurrent(context), false);
  assert.equal(f.tab.local.getItem(`language-cloud-sync-ack:${f.lease.userId}`), ack);
  assert.equal(f.tab.local.getItem('learningSettings'), '{"dailyGoalCount":4}');
  assert.doesNotMatch(view.text(), /서버 반영 중|서버 저장 확인/);
  assert.match(view.text(), /서버 반영 여부는 다음 연결에서 먼저 조회/);
});

test('warm settings conditional miss hides editing before the next GET and accepts a remote reset only as a new generation', async t => {
  const f = await languageFixture(t), view = f.mount(); await view.settle();
  const original = editorContainer(view.render())!;
  f.tab.local.setItem('savedWords', '["pre-reset local edit"]');
  const heldWrite = f.holdWrite(), heldRead = f.holdReadback();
  f.tab.dispatch({ type: 'focus' }); await view.settle();
  assert.equal(editorContainer(view.render())?.props.hidden, false);
  heldWrite.resolve({ data: null, error: null }); await view.settle();
  assert.equal(f.calls.at(-1)!.kind, 'read');
  assert.equal(editorContainer(view.render())?.props.hidden, true);
  assert.equal((editorContainer(view.render())!.props.children as UiNode).props.context, null);
  assert.doesNotMatch(view.text(), /서버 반영 중|서버 저장 확인/);
  const marker = '2026-10-11T00:00:00.000Z|11111111-1111-4111-8111-111111111111';
  heldRead.resolve({ data: { state: { languageRecordResetV1: marker }, updated_at: 'remote-reset' }, error: null }); await view.settle();
  assert.equal(f.tab.local.getItem('savedWords'), null); assert.equal(f.tab.local.getItem('languageRecordResetV1'), marker);
  assert.notEqual(editorContainer(view.render())?.key, original.key);
  assert.equal(editorContainer(view.render())?.props.hidden, false);
  assert.equal(f.calls.filter(call => call.kind === 'update').length, 1);
  assert.match(view.text(), /서버 저장 확인/);
});

test('same-origin peer acknowledgement pauses private drafts and explicit reconnect verifies fresh authority without a refresh loop', async t => {
  const first = await languageFixture(t), a = first.mount(); await a.settle();
  const original = editorContainer(a.render())!;
  const oldContext = (original.props.children as UiNode).props.context as import('../app/data/languageCloudSync.ts').LanguageRecordContext;
  const adapter = first.tab.loadModule('app/data/languageCloudSync.ts') as typeof import('../app/data/languageCloudSync.ts');
  const second = await languageFixture(t, first.browser, 'peer'), b = second.mount(); await b.settle(); await a.settle();
  assert.equal(first.lease.isCurrent(), true, 'The peer did not change the authenticated owner');
  assert.equal(adapter.isLanguageRecordContextCurrent(oldContext), false, 'A peer acknowledgement retires the old write capability');
  const paused = editorContainer(a.render())!;
  assert.equal(paused.key, original.key); assert.equal((paused.props.children as UiNode).props.children, editor);
  assert.equal(paused.props.hidden, true); assert.equal(paused.props.inert, true);
  assert.equal((paused.props.children as UiNode).props.context, null);
  assert.equal(editorContainer(b.render())?.props.hidden, false);
  assert.equal(first.tab.pendingTimers, 0); assert.equal(second.tab.pendingTimers, 0, 'Peer acknowledgements must not trigger an automatic ping-pong');
  const authReads = first.tab.authReads.length, reads = first.calls.filter(call => call.kind === 'read').length;
  const held = first.holdRead();
  a.click('학습 기록 다시 확인'); await a.settle();
  assert.ok(first.tab.authReads.length > authReads); assert.equal(first.calls.filter(call => call.kind === 'read').length, reads + 1);
  assert.equal(editorContainer(a.render())?.props.hidden, true, 'Explicit retry stays private until fresh server confirmation');
  held.resolve({ data: { state: {}, updated_at: 'fresh-peer-recovery' }, error: null }); await a.settle(); await b.settle();
  assert.equal(editorContainer(a.render())?.props.hidden, false); assert.equal(editorContainer(a.render())?.key, original.key);
  assert.match(a.text(), /학습 기록 · 서버 저장 확인/);
  assert.equal(editorContainer(b.render())?.props.hidden, true);
  assert.equal(first.tab.pendingTimers, 0); assert.equal(second.tab.pendingTimers, 0);
  assert.equal(first.calls.filter(call => call.kind !== 'read').length, 0); assert.equal(second.calls.filter(call => call.kind !== 'read').length, 0);
});

for (const failure of ['auth', 'read'] as const) test(`warm paused reconnect ${failure} failure preserves private draft without reporting ready`, async t => {
  const f = await languageFixture(t), view = f.mount(); await view.settle();
  const original = editorContainer(view.render())!;
  f.tab.dispatch({ type: 'pagehide' });
  if (failure === 'auth') f.tab.setAuthError(new Error('synthetic unavailable owner verification'));
  else f.failRead();
  const reads = f.calls.length;
  view.click('학습 기록 다시 확인'); await view.settle();
  const retained = editorContainer(view.render())!;
  assert.equal(retained.key, original.key); assert.equal((retained.props.children as UiNode).props.children, editor);
  assert.equal(retained.props.hidden, true); assert.equal(retained.props.inert, true);
  assert.equal((retained.props.children as UiNode).props.context, null);
  assert.doesNotMatch(view.text(), /서버 저장 확인|학습 기록 다시 확인/);
  if (failure === 'auth') assert.equal(f.calls.length, reads, 'Failed fresh owner verification cannot dispatch a record read');
});

test('warm paused recovery cannot start from a hidden document or reuse an owner revoked during authentication', async t => {
  const f = await languageFixture(t), view = f.mount(); await view.settle();
  f.tab.setVisibility('hidden'); const reads = f.calls.length, authReads = f.tab.authReads.length;
  view.click('학습 기록 다시 확인'); await view.settle();
  assert.equal(f.calls.length, reads); assert.equal(f.tab.authReads.length, authReads);
  f.tab.setVisibility('visible'); await view.settle();
  f.tab.dispatch({ type: 'pagehide' });
  const held = f.tab.holdNextAuth(), before = f.calls.length;
  view.click('학습 기록 다시 확인'); await view.settle();
  f.tab.emitAuth('SIGNED_IN', 'synthetic-other-owner');
  assert.equal(f.lease.signal.aborted, true);
  held.resolve({ data: { user: { id: FIXTURE_OWNER, email: 'a@example.test' } }, error: null }); await view.settle();
  assert.equal(f.calls.length, before); assert.equal(editorContainer(view.render())?.props.hidden, true);
  assert.doesNotMatch(view.text(), /서버 저장 확인/);
});

test('an incomplete reset is never presented as ordinary warm-paused recovery', async t => {
  const f = await languageFixture(t), view = f.mount(); await view.settle();
  f.tab.local.setItem('language-reset-fence-v1', JSON.stringify({ version: 1, owner: f.lease.userId,
    requestId: '11111111-1111-4111-8111-111111111111', expectedMarker: null, state: 'pending' }));
  const reads = f.calls.length; f.tab.dispatch({ type: 'pagehide' }); await view.settle();
  assert.equal(editorContainer(view.render())?.props.hidden, true);
  assert.doesNotMatch(view.text(), /학습 기록 다시 확인|서버 저장 확인/);
  assert.ok(nodes(view.render()).some(node => node.props.app === 'language'));
  assert.equal(f.calls.length, reads);
});

for (const boundary of ['hidden', 'unmount'] as const) test(`warm paused reconnect ${boundary} retires its held read without exposing a late result`, async t => {
  const f = await languageFixture(t), view = f.mount(); await view.settle();
  f.tab.dispatch({ type: 'pagehide' }); const held = f.holdRead();
  view.click('학습 기록 다시 확인'); await view.settle();
  const signal = f.calls.at(-1)!.signal!; assert.equal(signal.aborted, false);
  if (boundary === 'hidden') f.tab.setVisibility('hidden'); else view.dispose();
  assert.equal(signal.aborted, true);
  held.resolve({ data: { state: { savedWords: '["late private result"]' }, updated_at: 'late' }, error: null }); await view.settle();
  assert.equal(f.tab.local.getItem('savedWords'), null); assert.equal(editorContainer(view.render())?.props.hidden, true);
  assert.doesNotMatch(view.text(), /서버 저장 확인/);
});

for (const boundary of ['hidden', 'pagehide', 'unmount'] as const) test(`R11 shipping LanguageCloudSync ${boundary} aborts a cold pending GET and cannot initialize from its late reply`, async t => {
  const f = await languageFixture(t), hold = f.holdRead(), view = f.mount(); await view.settle();
  const request = f.calls.at(-1)!; assert.equal(request.kind, 'read'); assert.equal(request.signal?.aborted, false);
  if (boundary === 'hidden') f.tab.setVisibility('hidden');
  else if (boundary === 'pagehide') f.tab.dispatch({ type: 'pagehide' });
  else view.dispose();
  assert.equal(request.signal?.aborted, true, 'Cancellation is synchronous before any new auth await');
  hold.resolve({ data: { state: { savedWords: '["obsolete"]' }, updated_at: 'old' }, error: null });
  await view.settle();
  assert.equal(editorContainer(view.render()), undefined);
  assert.equal(f.tab.local.getItem('savedWords'), null);
});

test('R12 shipping cold GET error never mounts raw language editors', async t => {
  const f = await languageFixture(t); f.failRead(); const view = f.mount(); await view.settle();
  assert.match(view.text(), /학습 기록을 확인하지 못했습니다/);
  assert.doesNotMatch(view.text(), /synthetic language GET unavailable/);
  assert.equal(editorContainer(view.render()), undefined);
  assert.ok(view.button('다시 연결하기'));
});

test('R10 storage reset and null-key clear synchronously retire a pending GET before deferred authentication', async t => {
  const f = await languageFixture(t), hold = f.holdRead(), view = f.mount(); await view.settle();
  const pending = f.calls.at(-1)!.signal!;
  const auth = f.tab.holdNextAuth();
  f.tab.dispatch({ type: 'storage', key: 'ai-yeoni-record-reset-event', newValue: '{"app":"language"}' });
  assert.equal(pending.aborted, true); assert.equal(editorContainer(view.render()), undefined);
  f.tab.dispatch({ type: 'pageshow', persisted: true }); await view.settle();
  const readCount = f.calls.length;
  f.tab.dispatch({ type: 'storage', key: null });
  auth.resolve({ data: { user: { id: FIXTURE_OWNER, email: 'a@example.test' } }, error: null });
  hold.resolve({ data: { state: { savedWords: '["old reset response"]' }, updated_at: 'old' }, error: null });
  await view.settle();
  assert.equal(f.calls.length, readCount, 'The auth continuation after clear must not dispatch a GET');
  assert.equal(f.tab.local.getItem('savedWords'), null); assert.equal(editorContainer(view.render()), undefined);
});

test('R11/R12 BFCache resume verifies a fresh context and a late pre-hide GET cannot replace it', async t => {
  const f = await languageFixture(t), old = f.holdRead(), view = f.mount(); await view.settle();
  const oldSignal = f.calls.at(-1)!.signal;
  f.tab.setVisibility('hidden'); f.tab.setVisibility('visible'); await view.settle();
  assert.equal(oldSignal?.aborted, true);
  assert.equal(editorContainer(view.render())?.props.hidden, false);
  const key = editorContainer(view.render())?.key;
  old.resolve({ data: { state: { savedWords: '["late old reply"]' }, updated_at: 'old' }, error: null }); await view.settle();
  assert.equal(f.tab.local.getItem('savedWords'), null);
  assert.equal(editorContainer(view.render())?.key, key);
  const authReads = f.tab.authReads.length;
  f.tab.dispatch({ type: 'pagehide' });
  assert.equal(editorContainer(view.render())?.props.hidden, true);
  assert.equal(editorContainer(view.render())?.props.inert, true);
  f.tab.dispatch({ type: 'pageshow', persisted: true }); await view.settle();
  assert.ok(f.tab.authReads.length > authReads);
  assert.equal(editorContainer(view.render())?.props.hidden, false);
  assert.equal(editorContainer(view.render())?.key, key, 'Same-owner pause preserves the editor ancestor');
});

test('R11 warm resume failure preserves mounted draft but gates interaction, never reporting old ready state', async t => {
  const f = await languageFixture(t), view = f.mount(); await view.settle();
  const container = editorContainer(view.render()); assert.equal(container?.props.hidden, false);
  const adapter = f.tab.loadModule('app/data/languageCloudSync.ts') as typeof import('../app/data/languageCloudSync.ts');
  const context = (container?.props.children as UiNode)?.props.context as import('../app/data/languageCloudSync.ts').LanguageRecordContext;
  assert.ok(adapter.isLanguageRecordContextCurrent(context), 'Provider receives the exact registered coordinator context');
  f.failRead(); f.tab.dispatch({ type: 'online' }); await view.settle();
  const blocked = editorContainer(view.render());
  assert.equal(blocked?.key, container?.key); assert.equal((blocked?.props.children as UiNode)?.props.children, editor);
  assert.equal((blocked?.props.children as UiNode)?.props.context, null, 'Retained drafts receive no write capability while paused');
  assert.equal(blocked?.props.hidden, true); assert.equal(blocked?.props.inert, true);
  assert.doesNotMatch(view.text(), /서버 저장 확인/);
});

test('R11 committed remote reset replaces the old editor generation while ordinary pauses retain it', async t => {
  const f = await languageFixture(t), view = f.mount(); await view.settle();
  const key = editorContainer(view.render())?.key;
  f.tab.local.setItem('savedWords', '["pre-reset local draft"]');
  f.setRemote({ languageRecordResetV1: '2026-10-09T12:00:00.000Z|11111111-1111-4111-8111-111111111111' });
  f.tab.dispatch({ type: 'focus' }); await view.settle();
  assert.equal(f.tab.local.getItem('savedWords'), null);
  assert.equal(editorContainer(view.render())?.props.hidden, false);
  assert.notEqual(editorContainer(view.render())?.key, key, 'Pre-reset raw editor must remount after accepted reset');
});

for (const state of ['pending', 'uncertain'] as const) test(`R08 shipping language wrapper exposes exact-owner ${state} reset recovery without mounting raw editors or resetting automatically`, async t => {
  const f = await languageFixture(t);
  const requestId = '11111111-1111-4111-8111-111111111111';
  f.tab.local.setItem('language-reset-fence-v1', JSON.stringify({ version: 1, owner: f.lease.userId, requestId, expectedMarker: null, state }));
  const view = f.mount(); await view.settle();
  assert.equal(editorContainer(view.render()), undefined);
  const panel = nodes(view.render()).find(node => node.props.app === 'language');
  assert.ok(panel, 'Existing reset panel must be reachable outside the unavailable editor subtree');
  assert.equal(f.calls.length, 0, 'An incomplete reset blocks automatic language remote dispatch');
  assert.equal(JSON.parse(f.tab.local.getItem('language-reset-fence-v1')!).requestId, requestId);
});

test('R08 another owner or corrupt reset intent never exposes the recovery action', async t => {
  const f = await languageFixture(t);
  f.tab.local.setItem('language-reset-fence-v1', JSON.stringify({ version: 1, owner: 'other-owner', requestId: '11111111-1111-4111-8111-111111111111', expectedMarker: null, state: 'pending' }));
  const view = f.mount(); await view.settle();
  assert.equal(editorContainer(view.render()), undefined);
  assert.equal(nodes(view.render()).some(node => node.props.app === 'language'), false);
  assert.equal(f.calls.length, 0);
});

test('A09 shipping owner-filtered remote-command wake survives an in-flight GET and own acknowledgement stops scheduling', async t => {
  const f = await languageFixture(t), hold = f.holdRead(), view = f.mount(); await view.settle();
  const event = f.tab.transactions.CLOUD_RECORDS_REFRESH_EVENT;
  f.tab.dispatch({ type: event, detail: { ownerId: 'unrelated-owner' } });
  assert.equal(f.tab.pendingTimers, 0);
  f.tab.dispatch({ type: event, detail: { ownerId: f.lease.userId } });
  hold.resolve({ data: { state: {}, updated_at: 'synthetic-old' }, error: null }); await view.settle();
  assert.equal(f.calls.filter(call => call.kind === 'read').length, 1);
  assert.equal(f.tab.pendingTimers, 1, 'The independent wake must survive this acknowledgement');
  f.tab.flushTimers(); await view.settle();
  assert.equal(f.calls.filter(call => call.kind === 'read').length, 2);
  assert.equal(f.tab.pendingTimers, 0, 'Own acknowledgement does not create an infinite follow-up loop');
  assert.equal(editorContainer(view.render())?.props.hidden, false);
});

for (const phase of ['insert', 'update', 'readback'] as const) for (const boundary of ['hidden', 'pagehide', 'unmount'] as const) test(`R03/R11 shipping ${boundary} during ${phase} aborts transport and cannot publish its old acknowledgement`, async t => {
  const f = await languageFixture(t);
  let view: ReturnType<typeof f.mount>;
  let hold: ReturnType<typeof deferred<SdkResult>>;
  if (phase === 'insert') {
    f.removeRemote(); hold = f.holdWrite(); view = f.mount();
  } else {
    view = f.mount(); await view.settle();
    f.tab.local.setItem('savedWords', '["synthetic pending edit"]');
    hold = phase === 'readback' ? f.holdReadback() : f.holdWrite();
    f.tab.dispatch({ type: 'focus' });
  }
  await view.settle();
  const request = f.calls.at(-1)!;
  assert.equal(request.kind, phase === 'readback' ? 'read' : phase);
  const oldAck = f.tab.local.getItem(`language-cloud-sync-ack:${f.lease.userId}`);
  const oldBase = f.tab.local.getItem(`language-cloud-sync-base:${f.lease.userId}`);
  assert.equal(request.signal?.aborted, false);
  if (phase === 'insert') { assert.equal(editorContainer(view.render()), undefined); assert.doesNotMatch(view.text(), /서버 반영 중|서버 저장 확인/); }
  else { assert.equal(editorContainer(view.render())?.props.hidden, false); assert.match(view.text(), /서버 반영 중…/); }
  if (boundary === 'hidden') f.tab.setVisibility('hidden');
  else if (boundary === 'pagehide') f.tab.dispatch({ type: 'pagehide' });
  else view.dispose();
  assert.equal(request.signal?.aborted, true);
  if (boundary !== 'unmount') assert.match(view.text(), /서버 요청의 결과를 아직 확인하지 못했습니다/);
  hold.resolve({ data: phase === 'readback' ? { state: { savedWords: '["synthetic pending edit"]' }, updated_at: 'late' } : { updated_at: 'late' }, error: null });
  await view.settle();
  assert.equal(f.tab.local.getItem(`language-cloud-sync-ack:${f.lease.userId}`), oldAck);
  assert.equal(f.tab.local.getItem(`language-cloud-sync-base:${f.lease.userId}`), oldBase);
  assert.notEqual(editorContainer(view.render())?.props.hidden, false);
});

test('N02 shipping timestamp-only PATCH can overwrite a competitor that deliberately reuses the observed timestamp', async t => {
  const f = await languageFixture(t), view = f.mount(); await view.settle();
  f.tab.local.setItem('savedWords', '["our local edit"]');
  f.raceWithReusedTimestamp({ savedWords: '["competing remote edit"]', remoteOnlyNew: 'arrived after GET' });
  f.tab.dispatch({ type: 'focus' }); await view.settle();
  assert.equal(f.calls.filter(call => call.kind === 'update').length, 1);
  assert.equal(f.remoteState()?.savedWords, '["our local edit"]');
  assert.equal(f.remoteState()?.remoteOnlyNew, undefined, 'Negative demonstration: timestamp reuse evades this CAS and readback cannot undo the overwrite');
  assert.match(view.text(), /서버 저장 확인/, 'Readback acknowledges exact sent bytes, not absence of an intervening lost competitor');
});

test('A01/R11 cross-tab participating record/protocol events retain an already-sent response and preserve the newer edit', async t => {
  const f = await languageFixture(t), view = f.mount(); await view.settle();
  f.tab.local.setItem('savedWords', '["sent edit"]');
  const hold = f.holdWrite(); f.tab.dispatch({ type: 'focus' }); await view.settle();
  const sent = f.calls.at(-1)!; assert.equal(sent.kind, 'update');
  const peer = storageTab(f.browser, 'peer'); t.after(peer.dispose);
  await peer.cloud.prepareLocalCloudState(f.lease.userId);
  await peer.transactions.writeStorageBatch(peer.local, { savedWords: '["newer participating edit"]' });
  await view.settle();
  assert.equal(sent.signal?.aborted, false, 'Protocol/generation events must not blanket-abort an already-sent acknowledgement');
  hold.resolve({ data: { updated_at: 'synthetic-1' }, error: null }); await view.settle();
  assert.equal(f.tab.local.getItem('savedWords'), '["newer participating edit"]');
  assert.match(view.text(), /서버 반영 대기/);
  assert.equal(editorContainer(view.render())?.props.hidden, false);
});


test('P2B shipping SDK GET binds exact receipt time/owner/epoch/lifecycle and local create/close preserves it', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T02:00:00.000Z').getTime() });
  const f = await languageFixture(t), held = f.holdRead(), view = f.mount(); await view.settle();
  t.mock.timers.tick(10_000);
  held.resolve({ data: { state: {}, updated_at: 'synthetic-response' }, error: null }); await view.settle();
  const context = (editorContainer(view.render())?.props.children as UiNode).props.context as import('../app/data/languageCloudSync.ts').LanguageRecordContext;
  const facade = f.tab.loadModule('app/data/conversationLocalRecords.ts') as typeof import('../app/data/conversationLocalRecords.ts');
  const source = facade.readConversationSnapshot(context), observed = source.observation;
  assert.equal(observed.receivedAt, '2026-10-10T02:00:10.000Z'); assert.equal(observed.ownerId, f.lease.userId);
  assert.equal(observed.ownerEpochId, JSON.parse(f.lease.epoch!).id); assert.ok(observed.requestId); assert.ok(observed.lifecycleId);
  assert.equal(source.envelope, null);
  t.mock.timers.tick(60_000);
  const created = await facade.runConversationEdit(facade.captureConversationSession(source, 'legacy-cafe', 'UTC'));
  assert.equal(created.acknowledged, true);
  const close = facade.captureConversationClose(facade.readConversationSnapshot(context), created.effect.sessionId);
  await facade.stageConversationIntent(close); await facade.applyConversationIntent(close);
  const closed = facade.readConversationSnapshot(context).envelope!.sessions[0].closed!;
  assert.equal(closed.observation.receivedAt, observed.receivedAt); assert.equal(closed.observation.requestId, observed.requestId);
  assert.equal(closed.closedAt, '2026-10-10T02:01:10.000Z');
  f.tab.dispatch({ type: 'focus' }); await view.settle();
  const nextContext = (editorContainer(view.render())?.props.children as UiNode).props.context as import('../app/data/languageCloudSync.ts').LanguageRecordContext;
  const next = facade.readConversationSnapshot(nextContext);
  assert.equal(next.observation.receivedAt, '2026-10-10T02:01:10.000Z'); assert.notEqual(next.observation.requestId, observed.requestId);
  assert.equal(next.envelope!.sessions[0].closed!.observation.requestId, observed.requestId);
});

test('P2B shipping ordinary participant catch-up keeps the unrelated dirty legacy editor mounted', async t => {
  const f = await languageFixture(t);
  const marker = '2026-10-09T12:00:00.000Z|11111111-1111-4111-8111-111111111111';
  f.setRemote({ languageRecordResetV1: marker }); const view = f.mount(); await view.settle();
  const original = editorContainer(view.render()); assert.ok(original); const key = original.key;
  const contracts = f.tab.loadModule('lib/conversation-session/contracts.ts') as typeof import('../lib/conversation-session/contracts.ts');
  const participants = f.tab.loadModule('app/data/languageLocalParticipants.ts') as typeof import('../app/data/languageLocalParticipants.ts');
  const raw = contracts.canonicalJson({ schemaVersion: 1, ownerId: f.lease.userId, generationId: 'older-conversation-generation', marker: null,
    enrollment: { kind: 'explicit-enrollment', enrollmentId: 'old-enrollment', createdAt: '2026-10-08T01:00:00.000Z', observation: {
      kind: 'authenticated-remote-observation-received', requestId: 'old-read', ownerId: f.lease.userId, ownerEpochId: 'old-epoch', lifecycleId: 'old-life', marker: null, receivedAt: '2026-10-08T01:00:00.000Z',
    } }, sessions: [], tombstones: [] });
  f.tab.local.setItem(participants.conversationLocalKey(f.lease.userId), raw);
  f.tab.dispatch({ type: 'focus' }); await view.settle();
  const current = editorContainer(view.render()); assert.equal(current?.key, key); assert.equal(current?.props.hidden, false);
  assert.equal((current?.props.children as UiNode).props.children, editor);
  const replaced = JSON.parse(f.tab.local.getItem(participants.conversationLocalKey(f.lease.userId))!);
  assert.equal(replaced.enrollment.reason, 'observation-catch-up'); assert.equal(replaced.marker, marker);
  assert.notEqual(replaced.generationId, 'older-conversation-generation');
});

test('P2B shipping SDK write/readback uses the readback receive time and preserves exact marker provenance', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T03:00:00.000Z').getTime() });
  const f = await languageFixture(t), view = f.mount(); await view.settle();
  const facade = f.tab.loadModule('app/data/conversationLocalRecords.ts') as typeof import('../app/data/conversationLocalRecords.ts');
  const originalContext = (editorContainer(view.render())?.props.children as UiNode).props.context as import('../app/data/languageCloudSync.ts').LanguageRecordContext;
  const original = facade.readConversationSnapshot(originalContext).observation;
  f.tab.local.setItem('savedWords', '["synthetic pending legacy edit"]');
  const held = f.holdReadback(); t.mock.timers.tick(1_000); f.tab.dispatch({ type: 'focus' }); await view.settle();
  assert.equal(f.calls.at(-1)?.kind, 'read'); assert.equal(f.calls.filter(call => call.kind === 'update').length, 1);
  t.mock.timers.tick(30_000); held.resolve({ data: { state: { savedWords: '["synthetic pending legacy edit"]' }, updated_at: 'exact-readback' }, error: null }); await view.settle();
  const nextContext = (editorContainer(view.render())?.props.children as UiNode).props.context as import('../app/data/languageCloudSync.ts').LanguageRecordContext;
  const next = facade.readConversationSnapshot(nextContext).observation;
  assert.equal(next.receivedAt, '2026-10-10T03:00:31.000Z'); assert.notEqual(next.requestId, original.requestId);
  assert.equal(next.marker, null); assert.equal(next.lifecycleId, original.lifecycleId); assert.equal(next.ownerEpochId, original.ownerEpochId);
  assert.throws(() => facade.readConversationSnapshot(originalContext));
});
