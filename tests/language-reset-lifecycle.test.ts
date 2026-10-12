import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as transactions from '../app/data/storageTransaction.ts';
import * as boundary from '../app/data/languageStorageBoundary.ts';
import * as resetFence from '../app/data/languageResetFence.ts';
import * as resets from '../app/data/appRecordReset.ts';
import * as growth from '../app/data/growthRoutines.ts';
import * as budget from '../app/budget/lib/pending-save.ts';
import { installStorageLocks, preparedStorageSeed } from './helpers/storageProtocol.ts';

const owner = 'synthetic-language-reset-owner';
const request = '11111111-1111-4111-8111-111111111111';
const oldRequest = '22222222-2222-4222-8222-222222222222';
const oldMarker = `2026-10-08T12:00:00.123456Z|${oldRequest}`;
const marker = `2026-10-09T12:00:00.654321Z|${request}`;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(extra: Record<string, string> = {}) {
  const prior = ['window', 'navigator', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const locks = installStorageLocks();
  const seed = preparedStorageSeed(owner);
  const state = {
    ...Object.fromEntries(resets.APP_RECORD_KEYS.language.map(key => [key, ` {"synthetic":"${key}"} `])),
    integratedLearningSettingsV1: ' {"keep":"integrated"} ', japaneseAppSettings: '{"keep":"app"}', learningSettings: '{"keep":"daily"}',
    [boundary.LANGUAGE_MARKER_KEY]: oldMarker,
  };
  const values = new Map(Object.entries({ ...seed, ...state,
    [boundary.LANGUAGE_OWNER_KEY]: owner,
    [boundary.LANGUAGE_BINDING_KEY]: JSON.stringify({ version: 1, owner, epoch: seed[transactions.STORAGE_SESSION_KEY], status: 'ready', provenance: 'verified' }),
    [boundary.languageSyncBaseKey(owner)]: JSON.stringify(state), [boundary.languageSyncAckKey(owner)]: crypto.randomUUID(),
    'ai-fitness-untouched': 'other app bytes', confusingKana: '["keep legacy bytes"]', ...extra,
  }));
  const sessions = new Map<string, string>();
  let failure: { operation: string; key: string; nth: number } | undefined;
  let observer: ((key: string, value: string | null) => void) | undefined;
  function fail(operation: string, key: string) {
    if (failure?.operation === operation && failure.key === key && --failure.nth === 0) { failure = undefined; throw new Error('synthetic storage failure'); }
  }
  const local = {
    get length() { return values.size; }, key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { fail('get', key); return values.get(key) ?? null; },
    setItem(key: string, value: string) { fail('set', key); values.set(key, value); observer?.(key, value); },
    removeItem(key: string) { fail('remove', key); values.delete(key); observer?.(key, null); },
  };
  const events: string[] = [], active = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  const win = {
    localStorage: local,
    sessionStorage: { getItem: (key: string) => sessions.get(key) ?? null, setItem(key: string, value: string) { fail('session', key); sessions.set(key, value); } },
    dispatchEvent(event: Event) { events.push(event.type); for (const listener of listeners.get(event.type) ?? []) listener(); return true; },
    addEventListener(name: string, listener: () => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(listener); },
  };
  const document = { documentElement: { dataset: { recordReset: '' } } };
  const navigator = { onLine: true, locks: { request<T>(name: string, options: unknown, action: () => T | Promise<T>) {
    return locks.locks.request(name, options, async () => { active.add(name); try { return await action(); } finally { active.delete(name); } });
  } } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  let remote: Record<string, unknown> | null = { ...state };
  let authHook: ((call: number) => Promise<void> | void) | undefined;
  let rpcHook: (() => Promise<void> | void) | undefined;
  let getHook: (() => Promise<void> | void) | undefined;
  let rpcResult: unknown;
  let currentAuth = owner;
  let authCalls = 0, rpcCalls = 0, getCalls = 0;
  const assertNetwork = () => { assert.equal(active.has(transactions.STORAGE_LOCK_NAME), false); assert.equal(active.has('ai-yeoni-record-reset'), true); };
  const supabase = {
    auth: { async getUser() { assertNetwork(); await authHook?.(++authCalls); return { data: { user: { id: currentAuth } }, error: null }; } },
    async rpc(name: string, args: { p_app: string; p_request_id: string; p_confirmation: string }) {
      assertNetwork(); assert.equal(name, 'reset_my_app_records'); assert.equal(args.p_app, 'language'); assert.equal(args.p_request_id, request); assert.equal(args.p_confirmation, '초기화'); rpcCalls++;
      await rpcHook?.(); remote = { ...(remote ?? {}), [boundary.LANGUAGE_MARKER_KEY]: marker };
      for (const key of resets.APP_RECORD_KEYS.language) delete remote[key];
      return { data: rpcResult === undefined ? { app: 'language', user_id: owner, marker } : rpcResult, error: null };
    },
    from(table: string) {
      assertNetwork(); assert.equal(table, 'language_user_state');
      return { select(columns: string) { assert.equal(columns, 'state'); return { eq(key: string, value: string) {
        assert.equal(key, 'user_id'); assert.equal(value, owner); return { async maybeSingle() { assertNetwork(); getCalls++; await getHook?.(); return { data: remote === null ? null : { state: remote }, error: null }; } };
      } }; } };
    },
  };
  const code = ts.transpileModule(readFileSync(new URL('../app/lib/resetAppRecords.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const modules: Record<string, unknown> = {
    '../data/languageLegacyEvidenceRelease.ts': { LANGUAGE_LEGACY_EVIDENCE_RELEASE: { resetProtocol: 'inactive', enrollmentEnabled: false, captureEnabled: false } },
    '../data/languageLegacyEvidenceRepository.ts': { cleanupLanguageLegacyEvidenceForReset() { assert.fail('Inactive reset must never open evidence'); } },
    '../data/storageTransaction': transactions, './supabase': { supabase }, '../data/appRecordReset': resets,
    '../data/growthRoutines': growth, '../budget/lib/pending-save': budget,
    '../data/languageResetFence.ts': resetFence, '../data/languageStorageBoundary.ts': boundary,
  };
  const api = {} as { resetAppRecords(app: string, request: string, owner: string): Promise<{ app: string; user_id: string; marker: string }> };
  vm.runInNewContext(`(function(exports, require) { ${code}\n})`, { window: win, navigator, Event, Error, crypto })(api, (key: string) => { assert.ok(key in modules, key); return modules[key]; });
  return {
    local, values, events, sessions, document, api, active,
    reset: () => api.resetAppRecords('language', request, owner),
    get authCalls() { return authCalls; }, get rpcCalls() { return rpcCalls; }, get getCalls() { return getCalls; },
    project(keys: readonly string[]) { const snapshot = transactions.readStorageSnapshot(local); return Object.fromEntries(keys.map(key => [key, snapshot.getItem(key)])); },
    fail(operation: string, key: string, nth = 1) { failure = { operation, key, nth }; },
    observe(callback: typeof observer) { observer = callback; },
    onAuth(callback: typeof authHook) { authHook = callback; }, onRpc(callback: typeof rpcHook) { rpcHook = callback; }, onGet(callback: typeof getHook) { getHook = callback; },
    rpcResult(value: unknown) { rpcResult = value; }, remote(value: Record<string, unknown> | null) { remote = value; }, auth(value: string) { currentAuth = value; },
    async hold(name = transactions.STORAGE_LOCK_NAME) { const held = deferred(), entered = deferred(); const operation = navigator.locks.request(name, {}, async () => { entered.resolve(); await held.promise; }); await entered.promise; return async () => { held.resolve(); await operation; }; },
    async switchOwner(next: string) {
      const token = transactions.invalidateStorageOwner(local, next);
      await transactions.completeStorageOwnerTransition(local, token, () => ({
        [transactions.STORAGE_OWNER_KEY]: next, [boundary.LANGUAGE_OWNER_KEY]: next,
        [boundary.LANGUAGE_BINDING_KEY]: JSON.stringify({ version: 1, owner: next, epoch: token.epoch, status: 'ready', provenance: 'verified' }),
      }));
    },
    dispose() { observer = undefined; locks.restore(); for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } },
  };
}
const recordKeys = [...resets.APP_RECORD_KEYS.language, boundary.LANGUAGE_MARKER_KEY, boundary.languageSyncBaseKey(owner), boundary.languageSyncAckKey(owner)];

test('R01 language reset commits durable pending fence and rotates ack before first auth or RPC, with no network under shared lock', async t => {
  const b = fixture(); t.after(b.dispose); const ack = b.local.getItem(boundary.languageSyncAckKey(owner));
  b.onAuth(call => { if (call === 1) { const fence = boundary.parseLanguageResetFence(b.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY)); assert.equal(fence?.state, 'pending'); assert.equal(fence?.requestId, request); assert.notEqual(b.local.getItem(boundary.languageSyncAckKey(owner)), ack); } });
  assert.equal((await b.reset()).marker, marker); assert.equal(b.rpcCalls, 1); assert.equal(b.getCalls, 0);
  assert.equal(b.events[0], resets.RECORD_RESET_EVENT);
  for (const key of resets.APP_RECORD_KEYS.language) assert.equal(b.local.getItem(key), null);
  assert.equal(boundary.parseLanguageResetFence(b.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY))?.state, 'completed');
  assert.equal(b.local.getItem(boundary.languageSyncBaseKey(owner)), null);
  for (const key of ['integratedLearningSettingsV1', 'japaneseAppSettings', 'learningSettings', 'ai-fitness-untouched', 'confusingKana']) assert.notEqual(b.local.getItem(key), null);
});

for (const key of [boundary.LANGUAGE_RESET_FENCE_KEY, boundary.languageSyncAckKey(owner), transactions.STORAGE_PROTOCOL_KEY]) test(`R01 pending fence failure at ${key} prevents every auth/RPC and leaves source bytes`, async t => {
  const b = fixture(); t.after(b.dispose); const before = b.project(recordKeys); b.fail('set', key);
  await assert.rejects(b.reset()); assert.equal(b.authCalls, 0); assert.equal(b.rpcCalls, 0); assert.deepEqual(b.project(recordKeys), before); assert.equal(b.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY), null);
});

for (const phase of ['outer-lock', 'first-auth', 'rpc', 'post-auth'] as const) test(`R02 language owner ABA during ${phase} suppresses old cleanup and publication`, async t => {
  const b = fixture(); t.after(b.dispose); const entered = deferred(), resume = deferred();
  const release = phase === 'outer-lock' ? await b.hold('ai-yeoni-record-reset') : undefined;
  if (phase === 'first-auth' || phase === 'post-auth') b.onAuth(async call => { if (call === (phase === 'first-auth' ? 1 : 2)) { entered.resolve(); await resume.promise; } });
  if (phase === 'rpc') b.onRpc(async () => { entered.resolve(); await resume.promise; });
  const rejected = assert.rejects(b.reset(), transactions.StorageSessionChangedError);
  if (phase !== 'outer-lock') await entered.promise;
  await b.switchOwner('synthetic-other-owner'); await b.switchOwner(owner);
  b.values.set(resets.APP_RECORD_KEYS.language[0], 'later owner bytes'); const before = b.project(recordKeys);
  resume.resolve(); await release?.(); await rejected;
  assert.deepEqual(b.project(recordKeys), before); assert.equal(b.sessions.size, 0); assert.equal(b.local.getItem(resets.RECORD_RESET_STORAGE_EVENT), null);
});

for (const wrong of [
  { app: 'fitness', user_id: owner, marker }, { app: 'language', user_id: 'wrong-owner', marker },
  { app: 'language', user_id: owner, marker: oldMarker }, { app: 'language', user_id: owner, marker: 'null' },
  { app: 'language', user_id: owner, marker: null },
]) test(`R05 invalid RPC receipt preserves language records (${JSON.stringify(wrong)})`, async t => {
  const b = fixture(); t.after(b.dispose); const before = b.project(recordKeys.filter(key => key !== boundary.languageSyncAckKey(owner))); b.rpcResult(wrong);
  await assert.rejects(b.reset()); assert.deepEqual(b.project(Object.keys(before)), before);
  assert.equal(boundary.parseLanguageResetFence(b.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY))?.state, 'uncertain'); assert.equal(b.sessions.size, 0);
});

for (const [key, raw] of [[boundary.LANGUAGE_MARKER_KEY, 'null'], [boundary.languageSyncBaseKey(owner), '{broken'], [boundary.languageSyncBaseKey(owner), 'null'], [boundary.LANGUAGE_BINDING_KEY, '{bad'], [boundary.LANGUAGE_RESET_FENCE_KEY, '{}'], [boundary.languageSyncAckKey(owner), 'bad-ack']]) test(`R05 malformed ${key} is not repaired by reset`, async t => {
  const b = fixture({ [key]: raw }); t.after(b.dispose); const before = [...b.values]; await assert.rejects(b.reset()); assert.equal(b.rpcCalls, 0); assert.equal(b.authCalls, 0); assert.deepEqual([...b.values], before);
});

test('R05 unavailable storage cannot authorize cleanup or an RPC', async t => {
  const b = fixture(); t.after(b.dispose); b.fail('get', boundary.LANGUAGE_MARKER_KEY); await assert.rejects(b.reset()); assert.equal(b.rpcCalls, 0); assert.equal(b.local.getItem(boundary.LANGUAGE_MARKER_KEY), oldMarker);
});

for (const [operation, key, nth] of [
  ...resets.APP_RECORD_KEYS.language.map(key => ['remove', key, 1] as const),
  ['set', boundary.LANGUAGE_MARKER_KEY, 1], ['remove', boundary.languageSyncBaseKey(owner), 1],
  ['set', boundary.languageSyncAckKey(owner), 1], ['set', boundary.LANGUAGE_RESET_FENCE_KEY, 1],
  ['set', transactions.STORAGE_PROTOCOL_KEY, 2],
] as const) test(`R06 reset receipt failure at ${key} rolls back every record/base/ack and a read-first retry finishes`, async t => {
  const b = fixture(); t.after(b.dispose); let pending!: Record<string, string | null>;
  b.onRpc(() => { pending = b.project(recordKeys); b.fail(operation, key, nth); });
  await assert.rejects(b.reset(), /클라우드 초기화는 완료됐지만/); assert.deepEqual(b.project(recordKeys), pending);
  assert.equal(b.sessions.size, 0); assert.equal(b.local.getItem(resets.RECORD_RESET_STORAGE_EVENT), null);
  b.onRpc(undefined); await b.reset(); assert.equal(b.rpcCalls, 1, 'Receipt comes from authenticated GET; no repeated reset RPC'); assert.equal(b.getCalls, 1);
  for (const key of resets.APP_RECORD_KEYS.language) assert.equal(b.local.getItem(key), null);
});

for (const mode of ['event', 'session']) test(`R07 ${mode} publication failure retries completed receipt without deleting newer records or base`, async t => {
  const b = fixture(); t.after(b.dispose);
  b.fail(mode === 'event' ? 'set' : 'session', mode === 'event' ? resets.RECORD_RESET_STORAGE_EVENT : `record-reset-receipt:${owner}:language`);
  await assert.rejects(b.reset(), /클라우드 초기화는 완료됐지만/);
  assert.equal(boundary.parseLanguageResetFence(b.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY))?.state, 'completed');
  b.values.set('savedWords', 'new-generation-record'); b.values.set(boundary.languageSyncBaseKey(owner), JSON.stringify({ savedWords: 'new-generation-record', [boundary.LANGUAGE_MARKER_KEY]: marker }));
  const before = b.project(recordKeys); await b.reset(); assert.deepEqual(b.project(recordKeys), before); assert.equal(b.rpcCalls, 1); assert.equal(b.getCalls, 1);
  assert.equal(b.sessions.get(`record-reset-receipt:${owner}:language`), '1');
});

test('R08 unknown RPC response leaves durable uncertainty after DOM running flag clears, with the exact request available to a later panel', async t => {
  const b = fixture(); t.after(b.dispose); resets.setRecordResetRunning(true);
  b.onRpc(() => { b.remote({ [boundary.LANGUAGE_MARKER_KEY]: marker }); throw new Error('synthetic lost response'); });
  await assert.rejects(b.reset(), error => error instanceof Error && /서버 처리 결과가 아직 확인되지/.test(error.message) && !/lost response/.test(error.message)); resets.setRecordResetRunning(false);
  assert.equal(resets.isRecordResetRunning(), false); assert.deepEqual(resetFence.readPendingLanguageReset(owner), { requestId: request, state: 'uncertain' });
  const token = transactions.captureStorageOwner(); assert.equal(boundary.readLanguageBoundary(transactions.readStorageSnapshot(b.local), token).status, 'unavailable');
  assert.equal(b.rpcCalls, 1); b.onRpc(undefined); await b.reset(); assert.equal(b.rpcCalls, 1); assert.equal(b.getCalls, 1);
});

test('R09 a later server reset marker blocks old-intent redispatch and preserves local bytes', async t => {
  const b = fixture(); t.after(b.dispose); b.onRpc(() => { throw new Error('lost response'); }); await assert.rejects(b.reset());
  const newer = `2026-10-10T12:00:00Z|33333333-3333-4333-8333-333333333333`; b.remote({ [boundary.LANGUAGE_MARKER_KEY]: newer });
  const before = b.project(recordKeys); b.onRpc(undefined); await assert.rejects(b.reset(), /이전 요청을 다시 실행하지/); assert.deepEqual(b.project(recordKeys), before); assert.equal(b.rpcCalls, 1);
});

test('R09 exact unchanged expected server marker permits retrying the original request only', async t => {
  const b = fixture(); t.after(b.dispose); b.onRpc(() => { throw new Error('dispatch failed'); }); await assert.rejects(b.reset()); b.onRpc(undefined);
  await assert.rejects(b.api.resetAppRecords('language', oldRequest, owner), /같은 요청/); assert.equal(b.rpcCalls, 1);
  await b.reset(); assert.equal(b.rpcCalls, 2); assert.equal(b.getCalls, 1);
});

test('R09 a legacy equal marker without a completed fence never authorizes another bulk clear', async t => {
  const b = fixture({ [boundary.LANGUAGE_MARKER_KEY]: marker }); t.after(b.dispose); b.remote({ [boundary.LANGUAGE_MARKER_KEY]: marker });
  const before = b.project(recordKeys.filter(key => key !== boundary.languageSyncAckKey(owner)));
  await assert.rejects(b.reset(), /별도 복구/); assert.deepEqual(b.project(Object.keys(before)), before); assert.equal(b.rpcCalls, 0); assert.equal(b.getCalls, 1);
  assert.equal(resetFence.readPendingLanguageReset(owner)?.requestId, request);
});

test('R02 post-durable owner invalidation suppresses reset publication without undoing the committed receipt', async t => {
  const b = fixture(); t.after(b.dispose); let triggered = false;
  b.observe((key, raw) => {
    if (!triggered && key === transactions.STORAGE_PROTOCOL_KEY && raw?.includes('committed') && boundary.parseLanguageResetFence(b.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY))?.state === 'completed') {
      triggered = true; transactions.invalidateStorageOwner(b.local, owner);
    }
  });
  await assert.rejects(b.reset(), transactions.StorageSessionChangedError); assert.equal(triggered, true);
  assert.equal(b.local.getItem(boundary.LANGUAGE_MARKER_KEY), marker); assert.equal(b.sessions.size, 0); assert.equal(b.local.getItem(resets.RECORD_RESET_STORAGE_EVENT), null);
  b.observe(undefined); await b.switchOwner(owner); b.values.set('savedWords', 'later-owner-record'); await tick(); assert.equal(b.local.getItem('savedWords'), 'later-owner-record');
});

test('R02 owner invalidation while the local cleanup transaction is queued preserves later-owner records', async t => {
  const b = fixture(); t.after(b.dispose); const entered = deferred(), resume = deferred();
  b.onAuth(async call => { if (call === 2) { entered.resolve(); await resume.promise; } });
  const rejected = assert.rejects(b.reset(), transactions.StorageSessionChangedError); await entered.promise;
  const release = await b.hold(); resume.resolve(); await tick();
  const transition = b.switchOwner(owner); b.values.set('savedWords', 'later owner while old cleanup queued');
  await release(); await transition; await rejected;
  assert.equal(b.local.getItem('savedWords'), 'later owner while old cleanup queued'); assert.equal(b.local.getItem(boundary.LANGUAGE_MARKER_KEY), oldMarker); assert.equal(b.sessions.size, 0);
});

test('R02 exact marker captured before the outer lock cannot be reinterpreted after a newer reset wins', async t => {
  const b = fixture(); t.after(b.dispose); const release = await b.hold('ai-yeoni-record-reset');
  const rejected = assert.rejects(b.reset(), /초기화 상태가 바뀌었습니다/);
  await transactions.updateStorageBatch(b.local, () => ({ [boundary.LANGUAGE_MARKER_KEY]: marker, savedWords: 'newer reset generation' }));
  await release(); await rejected; assert.equal(b.authCalls, 0); assert.equal(b.rpcCalls, 0); assert.equal(b.local.getItem('savedWords'), 'newer reset generation');
});

test('R08 failed uncertainty persistence leaves the durable pending fence available after reset stops', async t => {
  const b = fixture(); t.after(b.dispose);
  b.onRpc(() => { b.fail('set', boundary.LANGUAGE_RESET_FENCE_KEY); throw new Error('unknown dispatch result'); });
  await assert.rejects(b.reset(), /서버 처리 결과가 아직 확인되지/); resets.setRecordResetRunning(false);
  assert.deepEqual(resetFence.readPendingLanguageReset(owner), { requestId: request, state: 'pending' }); assert.equal(b.local.getItem(boundary.LANGUAGE_MARKER_KEY), oldMarker);
});

test('R05 corruption appearing after RPC dispatch remains byte-exact and blocks local cleanup', async t => {
  const b = fixture(); t.after(b.dispose); const before = b.project(resets.APP_RECORD_KEYS.language);
  b.onRpc(() => { b.values.set(boundary.languageSyncBaseKey(owner), '{retain original corrupt bytes'); });
  await assert.rejects(b.reset()); assert.deepEqual(b.project(resets.APP_RECORD_KEYS.language), before);
  assert.equal(b.local.getItem(boundary.languageSyncBaseKey(owner)), '{retain original corrupt bytes'); assert.equal(b.local.getItem(boundary.LANGUAGE_MARKER_KEY), oldMarker); assert.equal(b.sessions.size, 0);
});

test('R09 owner change during retry GET prevents stale old-request redispatch or cleanup', async t => {
  const b = fixture(); t.after(b.dispose); b.onRpc(() => { throw new Error('unknown'); }); await assert.rejects(b.reset()); b.onRpc(undefined);
  const entered = deferred(), resume = deferred(); b.onGet(async () => { entered.resolve(); await resume.promise; });
  const rejected = assert.rejects(b.reset(), transactions.StorageSessionChangedError); await entered.promise;
  await b.switchOwner('synthetic-other-owner'); await b.switchOwner(owner); b.values.set('savedWords', 'later owner after GET');
  resume.resolve(); await rejected; assert.equal(b.rpcCalls, 1); assert.equal(b.local.getItem('savedWords'), 'later owner after GET');
});
