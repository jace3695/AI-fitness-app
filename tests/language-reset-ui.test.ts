import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as boundary from '../app/data/languageStorageBoundary.ts';
import * as resets from '../app/data/appRecordReset.ts';
import { preparedStorageSeed } from './helpers/storageProtocol.ts';
import { FIXTURE_OWNER, nodes, storageBrowser, storageTab, tick } from './helpers/storage-ui-fixture.ts';

const requestId = '44444444-4444-4444-8444-444444444444';
const marker = `2026-10-09T10:00:00Z|${requestId}`;
function readySeed() {
  const shared = preparedStorageSeed(FIXTURE_OWNER);
  return { ...shared, [boundary.LANGUAGE_OWNER_KEY]: FIXTURE_OWNER,
    [boundary.LANGUAGE_BINDING_KEY]: JSON.stringify({ version: 1, owner: FIXTURE_OWNER, epoch: shared['fitness-cloud-sync-epoch'], status: 'ready', provenance: 'verified' }),
    [boundary.LANGUAGE_RESET_FENCE_KEY]: JSON.stringify({ version: 1, owner: FIXTURE_OWNER, requestId, state: 'uncertain', expectedMarker: null }),
    savedWords: 'synthetic pre-reset words',
  };
}

test('R08 cold-mounted shipped reset panel exposes same-request confirmation without automatic GET/RPC and confirms only after an explicit click', async t => {
  const browser = storageBrowser(readySeed()), tab = storageTab(browser, 'reset-panel'); t.after(tab.dispose);
  let reads = 0, rpcs = 0;
  tab.setModule('app/lib/supabase.ts', { supabase: {
    auth: {
      async getUser() { return { data: { user: { id: FIXTURE_OWNER, email: 'synthetic@example.test' } }, error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from(table: string) { assert.equal(table, 'language_user_state'); return { select() { return { eq(key: string, owner: string) {
      assert.equal(key, 'user_id'); assert.equal(owner, FIXTURE_OWNER); return { async maybeSingle() { reads++; return { data: { state: { [boundary.LANGUAGE_MARKER_KEY]: marker } }, error: null }; } };
    } }; } }; },
    async rpc() { rpcs++; throw new Error('An existing receipt never needs another RPC'); },
  } });
  const panel = tab.mount('app/components/RecordResetPanel.tsx', { app: 'language' }); t.after(panel.dispose); await panel.settle();
  assert.match(panel.text(), /완료되지 않은 일본어 기록 초기화/); panel.button('진행 중인 초기화 결과 확인하기');
  assert.equal(reads, 0); assert.equal(rpcs, 0); assert.equal(tab.local.getItem('savedWords'), 'synthetic pre-reset words');
  panel.click('진행 중인 초기화 결과 확인하기');
  const checkbox = nodes(panel.render()).find(node => node.type === 'input' && node.props.type === 'checkbox'); assert.ok(checkbox);
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  const input = nodes(panel.render()).find(node => node.type === 'input' && node.props.autoComplete === 'off'); assert.ok(input);
  (input.props.onChange as (event: unknown) => void)({ target: { value: '초기화' } });
  panel.click('같은 초기화 요청 확인'); await panel.settle();
  assert.equal(reads, 1); assert.equal(rpcs, 0); assert.equal(tab.reloads, 1);
  assert.equal(tab.local.getItem('savedWords'), null);
  const receipt = boundary.parseLanguageResetFence(tab.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY));
  assert.equal(receipt?.requestId, requestId); assert.equal(receipt?.state, 'completed');
});

test('R08 a different authenticated owner never sees or reuses the prior pending request', async t => {
  const browser = storageBrowser(readySeed()), tab = storageTab(browser, 'reset-panel', 'another-owner'); t.after(tab.dispose);
  const panel = tab.mount('app/components/RecordResetPanel.tsx', { app: 'language' }); t.after(panel.dispose); await panel.settle();
  assert.doesNotMatch(panel.text(), /완료되지 않은 일본어 기록 초기화/);
  assert.match(panel.text(), /계정이 변경되었거나 기록을 준비 중/);
  assert.equal(tab.local.getItem('savedWords'), 'synthetic pre-reset words'); assert.equal(tab.reloads, 0);
});

function listenerFixture(tab: ReturnType<typeof storageTab>) {
  const listeners = new Map<string, (event: { key: string | null; newValue?: string }) => void>();
  const events: string[] = [];
  let reloads = 0, authCalls = 0, cleanup: (() => void) | undefined;
  let resolveAuth!: (value: unknown) => void;
  const auth = new Promise(resolve => { resolveAuth = resolve; });
  const modules: Record<string, unknown> = {
    react: { useEffect(effect: () => () => void) { cleanup = effect(); } },
    '../data/appRecordReset': resets, '../data/languageStorageBoundary.ts': boundary, '../data/storageTransaction.ts': tab.transactions,
    '../lib/supabase': { supabase: { auth: { getUser() { authCalls++; return auth; } } } },
  };
  const win = {
    localStorage: tab.local, location: { reload() { reloads++; } },
    addEventListener(name: string, handler: (event: { key: string | null; newValue?: string }) => void) { listeners.set(name, handler); },
    removeEventListener(name: string) { listeners.delete(name); }, dispatchEvent(event: Event) { events.push(event.type); return true; },
  };
  const code = ts.transpileModule(readFileSync(new URL('../app/components/RecordResetListener.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const api = {} as { default(): null };
  vm.runInNewContext(`(function(exports, require) { ${code}\n})`, { Event, window: win })(api, (key: string) => { assert.ok(key in modules, key); return modules[key]; });
  api.default();
  return { events, get reloads() { return reloads; }, get authCalls() { return authCalls; },
    storage(key: string | null, newValue?: string) { listeners.get('storage')?.({ key, newValue }); },
    finishAuth() { resolveAuth({ data: { user: { id: FIXTURE_OWNER } }, error: null }); },
    dispose() { cleanup?.(); },
  };
}

test('R10 shipped cross-tab reset listener invalidates synchronously before deferred authentication and suppresses stale reload after storage clear', async t => {
  const browser = storageBrowser(readySeed()), tab = storageTab(browser, 'reset-listener'); t.after(tab.dispose);
  const listener = listenerFixture(tab); t.after(listener.dispose);
  listener.storage(resets.RECORD_RESET_STORAGE_EVENT, JSON.stringify({ userId: FIXTURE_OWNER, app: 'language', marker }));
  assert.deepEqual(listener.events, [resets.RECORD_RESET_EVENT]); assert.equal(listener.authCalls, 1); assert.equal(listener.reloads, 0);
  listener.storage(null); assert.equal(listener.events.length, 2); listener.finishAuth(); await tick(); assert.equal(listener.reloads, 0);
});

for (const key of [boundary.LANGUAGE_RESET_FENCE_KEY, boundary.LANGUAGE_MARKER_KEY, 'fitness-cloud-sync-epoch', 'fitness-cloud-sync-user']) test(`R10 storage ${key} invalidates without waiting for or requiring auth`, t => {
  const browser = storageBrowser(readySeed()), tab = storageTab(browser, 'reset-listener'); t.after(tab.dispose);
  const listener = listenerFixture(tab); t.after(listener.dispose); listener.storage(key);
  assert.deepEqual(listener.events, [resets.RECORD_RESET_EVENT]); assert.equal(listener.authCalls, 0); assert.equal(listener.reloads, 0);
});

test('R10 same-owner current reset event may reload only after successful current authentication', async t => {
  const browser = storageBrowser(readySeed()), tab = storageTab(browser, 'reset-listener'); t.after(tab.dispose);
  const listener = listenerFixture(tab); t.after(listener.dispose);
  listener.storage(resets.RECORD_RESET_STORAGE_EVENT, JSON.stringify({ userId: FIXTURE_OWNER, app: 'language', marker }));
  assert.equal(listener.reloads, 0); listener.finishAuth(); await tick(); assert.equal(listener.reloads, 1);
});
