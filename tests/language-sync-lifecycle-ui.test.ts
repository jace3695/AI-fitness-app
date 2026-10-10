import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { deferred, FIXTURE_OWNER, nodes, storageBrowser, storageTab, type UiNode } from './helpers/storage-ui-fixture.ts';
import type { AuthenticatedStorageOwner } from '../app/data/authenticatedStorageOwner.ts';

const AUTH_GATE = 'app/components/AuthGate.tsx';
const COMPONENT = 'components/LanguageCloudSync.tsx';
const editor: UiNode = { type: 'textarea', props: { 'data-language-editor': true, defaultValue: 'synthetic unsaved language draft' } };
type Row = { state: Record<string, unknown>; updated_at: string };
type SdkResult = { data: Row | { updated_at: string } | null; error: Error | null };

async function languageFixture(t: TestContext) {
  const browser = storageBrowser(), tab = storageTab(browser, 'language'); t.after(tab.dispose);
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
const editorContainer = (tree: UiNode) => nodes(tree).find(node => node.type === 'div' && node.props.children === editor);

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
  assert.match(view.text(), /synthetic language GET unavailable/);
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
  f.failRead(); f.tab.dispatch({ type: 'online' }); await view.settle();
  const blocked = editorContainer(view.render());
  assert.equal(blocked?.key, container?.key); assert.equal(blocked?.props.children, editor);
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
