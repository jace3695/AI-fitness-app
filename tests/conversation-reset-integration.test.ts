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
import { languageFixture } from './helpers/languageFixture.ts';
import { conversationLocalKey, readConversationPartition } from '../app/data/languageLocalParticipants.ts';
import { createLanguageSyncCoordinator } from '../app/data/languageSyncCoordinator.ts';
import { canonicalJson, freezeGuidedSource, type ConversationEnvelope } from '../lib/conversation-session/contracts.ts';
import { GUIDED_CONVERSATION_PILOT } from '../data/guidedConversationPilot.ts';
import { planCreateSession } from '../lib/conversation-session/reducer.ts';
import { emptySession, draft, save, stage, append, TIME } from '../lib/conversation-session/fixtures.test-support.ts';

const owner = 'synthetic-conversation-reset-owner';
const request = '11111111-1111-4111-8111-111111111111';
const oldRequest = '22222222-2222-4222-8222-222222222222';
const oldMarker = `2026-10-08T12:00:00.123456Z|${oldRequest}`;
const marker = `2026-10-09T12:00:00.654321Z|${request}`;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function resetFixture(extra: Record<string, string> = {}) {
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
  let afterWrite: ((key: string, value: string) => void) | undefined;
  let observer: ((key: string, value: string | null) => void) | undefined;
  function fail(operation: string, key: string) {
    if (failure?.operation === operation && failure.key === key && --failure.nth === 0) { failure = undefined; throw new Error('synthetic storage failure'); }
  }
  const local = {
    get length() { return values.size; }, key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { fail('get', key); return values.get(key) ?? null; },
    setItem(key: string, value: string) { fail('set', key); values.set(key, value); observer?.(key, value); afterWrite?.(key, value); },
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
  let expectedApp = 'language';
  let authCalls = 0, rpcCalls = 0, getCalls = 0;
  const assertNetwork = () => { assert.equal(active.has(transactions.STORAGE_LOCK_NAME), false); assert.equal(active.has('ai-yeoni-record-reset'), true); };
  const supabase = {
    auth: { async getUser() { assertNetwork(); await authHook?.(++authCalls); return { data: { user: { id: currentAuth } }, error: null }; } },
    async rpc(name: string, args: { p_app: string; p_request_id: string; p_confirmation: string }) {
      assertNetwork(); assert.equal(name, 'reset_my_app_records'); assert.equal(args.p_app, expectedApp); assert.equal(args.p_request_id, request); assert.equal(args.p_confirmation, '초기화'); rpcCalls++;
      await rpcHook?.(); remote = { ...(remote ?? {}), [boundary.LANGUAGE_MARKER_KEY]: marker };
      for (const key of resets.APP_RECORD_KEYS.language) delete remote[key];
      return { data: rpcResult === undefined ? { app: expectedApp, user_id: owner, marker } : rpcResult, error: null };
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
    '../data/storageTransaction': transactions, './supabase': { supabase }, '../data/appRecordReset': resets,
    '../data/growthRoutines': growth, '../budget/lib/pending-save': budget,
    '../data/languageResetFence.ts': resetFence, '../data/languageStorageBoundary.ts': boundary,
  };
  const api = {} as { resetAppRecords(app: string, request: string, owner: string): Promise<{ app: string; user_id: string; marker: string }> };
  vm.runInNewContext(`(function(exports, require) { ${code}\n})`, { window: win, navigator, Event, Error, crypto })(api, (key: string) => { assert.ok(key in modules, key); return modules[key]; });
  return {
    local, values, events, sessions, document, api, active,
    reset: () => api.resetAppRecords('language', request, owner),
    otherReset(app: string) { expectedApp = app; return api.resetAppRecords(app, request, owner); },
    get authCalls() { return authCalls; }, get rpcCalls() { return rpcCalls; }, get getCalls() { return getCalls; },
    project(keys: readonly string[]) { const snapshot = transactions.readStorageSnapshot(local); return Object.fromEntries(keys.map(key => [key, snapshot.getItem(key)])); },
    fail(operation: string, key: string, nth = 1) { failure = { operation, key, nth }; },
    observe(callback: typeof observer) { observer = callback; },
    afterWrite(callback: typeof afterWrite) { afterWrite = callback; },
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
    dispose() { observer = undefined; afterWrite = undefined; locks.restore(); for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } },
  };
}
const ownerKey = conversationLocalKey(owner), otherOwner = 'synthetic-other-owner';
const otherKey = conversationLocalKey(otherOwner);
const recordKeys = [...resets.APP_RECORD_KEYS.language, ownerKey, boundary.LANGUAGE_MARKER_KEY, boundary.languageSyncBaseKey(owner), boundary.languageSyncAckKey(owner)];
function envelope(ownerId = owner, resetMarker: string | null = oldMarker, generationId = 'synthetic-generation-before'): ConversationEnvelope {
  return {
    schemaVersion: 1, ownerId, generationId, marker: resetMarker,
    enrollment: { kind: 'explicit-enrollment', enrollmentId: `enroll-${generationId}`, createdAt: TIME,
      observation: { kind: 'authenticated-remote-observation-received', requestId: 'synthetic-read', ownerId, ownerEpochId: 'synthetic-epoch', lifecycleId: 'synthetic-life', marker: resetMarker, receivedAt: TIME } },
    sessions: [emptySession()], tombstones: [],
  };
}
function populated(ownerId = owner, resetMarker: string | null = oldMarker, generationId = 'synthetic-generation-before') {
  let result = save(envelope(ownerId, resetMarker, generationId), draft('draft-reset', 'PRIVATE_SYNTHETIC_RESET_INPUT'));
  result = stage(result, append(result));
  return result;
}
function partition(storage: Pick<Storage, 'getItem'>, ownerId = owner) {
  const result = readConversationPartition(storage.getItem(conversationLocalKey(ownerId)), ownerId); assert.ok(result); return result;
}
function seeded(extra: Record<string, string> = {}) {
  return resetFixture({ [ownerKey]: canonicalJson(populated()), [otherKey]: canonicalJson(populated(otherOwner)), ...extra });
}

// All values, identities, authenticated responses and failures in this suite are synthetic.
test('P2B reset atomically replaces the exact owner partition together with all 12 legacy records', async t => {
  const f = seeded(); t.after(f.dispose); const before = f.local.getItem(ownerKey), otherBefore = f.local.getItem(otherKey);
  const coherent: Array<{ marker: string | null; partition: string | null; legacy: Array<string | null> }> = [];
  f.observe(() => {
    const snapshot = transactions.readStorageSnapshot(f.local);
    coherent.push({ marker: snapshot.getItem(boundary.LANGUAGE_MARKER_KEY), partition: snapshot.getItem(ownerKey), legacy: resets.APP_RECORD_KEYS.language.map(key => snapshot.getItem(key)) });
  });
  await f.reset();
  const after = partition(f.local);
  assert.equal(after.marker, marker); assert.notEqual(after.generationId, populated().generationId);
  assert.deepEqual(after.sessions, []); assert.deepEqual(after.tombstones, []);
  assert.equal(after.enrollment.kind, 'reset-replacement');
  if (after.enrollment.kind !== 'reset-replacement') assert.fail();
  assert.equal(after.enrollment.previousGenerationId, populated().generationId); assert.equal(after.enrollment.previousMarker, oldMarker);
  assert.equal(after.enrollment.requestId, request); assert.equal(after.enrollment.reason, 'explicit-reset');
  assert.equal(f.local.getItem(otherKey), otherBefore);
  for (const key of ['integratedLearningSettingsV1', 'japaneseAppSettings', 'learningSettings', 'ai-fitness-untouched', 'confusingKana']) assert.notEqual(f.local.getItem(key), null);
  assert.ok(coherent.length > 20);
  for (const row of coherent) {
    if (row.marker === oldMarker) { assert.equal(row.partition, before); assert.ok(row.legacy.every(value => value !== null)); }
    else { assert.equal(row.marker, marker); assert.equal(row.partition, f.local.getItem(ownerKey)); assert.ok(row.legacy.every(value => value === null)); }
  }
  assert.equal(boundary.LANGUAGE_STORAGE_KEYS.length, 16); assert.equal(resets.APP_RECORD_KEYS.language.length, 12);
});

test('P2B queued explicit reset retires fresh lock-time participant bytes saved before its pending fence', async t => {
  const f = seeded(); t.after(f.dispose); const release = await f.hold('ai-yeoni-record-reset');
  const resetting = f.reset();
  const later = populated(owner, oldMarker, 'synthetic-newer-pre-fence-generation');
  await transactions.updateStorageBatch(f.local, () => ({ [ownerKey]: canonicalJson(later) }));
  await release(); await resetting;
  const after = partition(f.local); assert.equal(after.enrollment.kind, 'reset-replacement');
  if (after.enrollment.kind !== 'reset-replacement') assert.fail();
  assert.equal(after.enrollment.previousGenerationId, later.generationId); assert.deepEqual(after.sessions, []);
});

for (const [label, operation, key, nth] of [
  ['prepared journal', 'set', transactions.STORAGE_PROTOCOL_KEY, 1],
  ['participant replacement', 'set', ownerKey, 1],
  ['legacy deletion', 'remove', resets.APP_RECORD_KEYS.language[0], 1],
  ['language marker', 'set', boundary.LANGUAGE_MARKER_KEY, 1],
  ['baseline removal', 'remove', boundary.languageSyncBaseKey(owner), 1],
  ['acknowledgement', 'set', boundary.languageSyncAckKey(owner), 1],
  ['completed fence', 'set', boundary.LANGUAGE_RESET_FENCE_KEY, 1],
  ['durable marker', 'set', transactions.STORAGE_PROTOCOL_KEY, 2],
] as const) test(`P2B ${label} failure preserves participant and legacy before-image; authenticated retry completes once`, async t => {
  const f = seeded(); t.after(f.dispose); let pending!: Record<string, string | null>;
  f.onRpc(() => { pending = f.project(recordKeys); f.fail(operation, key, nth); });
  await assert.rejects(f.reset(), /클라우드 초기화는 완료됐지만/);
  assert.deepEqual(f.project(recordKeys), pending); assert.equal(f.sessions.size, 0);
  assert.equal(f.local.getItem(resets.RECORD_RESET_STORAGE_EVENT), null);
  assert.notEqual(boundary.parseLanguageResetFence(f.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY))?.state, 'completed');
  f.onRpc(undefined); await f.reset(); assert.equal(f.rpcCalls, 1); assert.equal(f.getCalls, 1);
  assert.equal(partition(f.local).marker, marker); assert.deepEqual(partition(f.local).sessions, []);
});

for (const [label, operation, key] of [
  ['notification', 'set', resets.RECORD_RESET_STORAGE_EVENT],
  ['session receipt', 'session', `record-reset-receipt:${owner}:language`],
] as const) test(`P2B ${label} failure leaves durable completion; same-request retry preserves new sessions exactly`, async t => {
  const f = seeded(); t.after(f.dispose); f.fail(operation, key);
  await assert.rejects(f.reset(), /클라우드 초기화는 완료됐지만/);
  assert.equal(boundary.parseLanguageResetFence(f.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY))?.state, 'completed');
  const completed = partition(f.local);
  const later = save({ ...completed, sessions: [emptySession()] }, draft('draft-new-generation', 'PRIVATE_SYNTHETIC_NEW_SESSION'));
  f.values.set(ownerKey, canonicalJson(later)); f.values.set('savedWords', 'later legacy record');
  f.values.set(boundary.languageSyncBaseKey(owner), JSON.stringify({ savedWords: 'later legacy record', [boundary.LANGUAGE_MARKER_KEY]: marker }));
  const before = f.project(recordKeys); await f.reset();
  assert.deepEqual(f.project(recordKeys), before); assert.equal(f.rpcCalls, 1); assert.equal(f.getCalls, 1);
  assert.equal(f.sessions.get(`record-reset-receipt:${owner}:language`), '1');
});

test('P2B host writes durable marker then throws: read-first recognizes completion without retiring another generation', async t => {
  const f = seeded(); t.after(f.dispose); let threw = false;
  f.afterWrite((key, value) => {
    if (!threw && key === transactions.STORAGE_PROTOCOL_KEY && value.includes('committed') && boundary.parseLanguageResetFence(f.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY))?.state === 'completed') {
      threw = true; throw new Error('PRIVATE_SYNTHETIC_HOST_ERROR');
    }
  });
  await f.reset(); assert.equal(threw, true);
  const before = f.local.getItem(ownerKey); await f.reset(); assert.equal(f.local.getItem(ownerKey), before); assert.equal(f.rpcCalls, 1);
});

test('P2B rollback failure preserves a durable prepared before-image and never publishes cleanup', async t => {
  const f = seeded(); t.after(f.dispose); const before = f.project(recordKeys), set = f.local.setItem;
  let armed = false;
  f.onRpc(() => { armed = true; });
  f.local.setItem = (key, value) => { if (armed && key === ownerKey) throw new Error('PRIVATE_SYNTHETIC_HOST_ERROR'); set(key, value); };
  await assert.rejects(f.reset(), error => { assert.doesNotMatch(String(error), /PRIVATE_SYNTHETIC_HOST_ERROR/); return true; });
  assert.equal(transactions.readStorageSnapshot(f.local).pending, true);
  const expected = { ...before, [boundary.languageSyncAckKey(owner)]: f.project(recordKeys)[boundary.languageSyncAckKey(owner)] };
  assert.deepEqual(f.project(recordKeys), expected); assert.equal(f.sessions.size, 0);
  assert.equal(f.local.getItem(resets.RECORD_RESET_STORAGE_EVENT), null);
  armed = false; f.onRpc(undefined); await transactions.recoverStorageTransaction(f.local); await f.reset();
  assert.equal(f.rpcCalls, 1); assert.equal(partition(f.local).marker, marker);
});

const corruptCases: Array<[string, () => string]> = [
  ['malformed', () => '{PRIVATE_SYNTHETIC_BAD_JSON'],
  ['unsupported version', () => canonicalJson({ ...populated(), schemaVersion: 3 })],
  ['noncanonical whitespace', () => ` ${canonicalJson(populated())}`],
  ['duplicate member', () => canonicalJson(populated()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')],
  ['wrong owner', () => canonicalJson(populated(otherOwner))],
  ['unproven enrollment', () => { const value = envelope(); if (value.enrollment.kind === 'explicit-enrollment') delete value.enrollment.observation; return canonicalJson(value); }],
];
for (const [label, raw] of corruptCases) test(`P2B ${label} partition blocks explicit cleanup without repairing any private or legacy byte`, async t => {
  const original = raw(), f = seeded({ [ownerKey]: original }); t.after(f.dispose);
  const before = f.project([...resets.APP_RECORD_KEYS.language, ownerKey, boundary.LANGUAGE_MARKER_KEY]);
  await assert.rejects(f.reset(), error => { assert.doesNotMatch(String(error), /PRIVATE_SYNTHETIC/); return true; });
  assert.deepEqual(f.project(Object.keys(before)), before); assert.equal(f.local.getItem(ownerKey), original);
  assert.notEqual(boundary.parseLanguageResetFence(f.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY))?.state, 'completed');
  assert.equal(f.sessions.size, 0); assert.equal(f.local.getItem(resets.RECORD_RESET_STORAGE_EVENT), null);
});

test('P2B absent current-owner partition stays absent on explicit reset and does not enumerate-delete another owner', async t => {
  const other = canonicalJson(populated(otherOwner)); const f = resetFixture({ [otherKey]: other }); t.after(f.dispose);
  await f.reset(); assert.equal(f.local.getItem(ownerKey), null); assert.equal(f.local.getItem(otherKey), other);
});

test('P2B another app reset preserves every conversation owner partition exactly', async t => {
  const f = seeded(); t.after(f.dispose); const before = f.project([ownerKey, otherKey]);
  await f.otherReset('fitness'); assert.deepEqual(f.project([ownerKey, otherKey]), before);
});

for (const raw of ['{}', 'null', '{bad', JSON.stringify({ version: 1, owner, requestId: request, expectedMarker: oldMarker, state: 'completed', marker: oldMarker })]) test(`P2B malformed or mismatched reset fence blocks before RPC and preserves partition (${raw})`, async t => {
  const f = seeded({ [boundary.LANGUAGE_RESET_FENCE_KEY]: raw }); t.after(f.dispose); const before = [...f.values];
  await assert.rejects(f.reset()); assert.equal(f.rpcCalls, 0); assert.equal(f.authCalls, 0); assert.deepEqual([...f.values], before);
});

test('P2B completed same-marker post-observation enrollment survives retry of a pre-feature reset', async t => {
  const raw = canonicalJson(populated(owner, marker, 'generation-after-pre-feature-reset'));
  const fence = JSON.stringify({ version: 1, owner, requestId: request, expectedMarker: oldMarker, state: 'completed', marker });
  const f = seeded({ [ownerKey]: raw, [boundary.LANGUAGE_MARKER_KEY]: marker, [boundary.LANGUAGE_RESET_FENCE_KEY]: fence }); t.after(f.dispose);
  f.remote({ [boundary.LANGUAGE_MARKER_KEY]: marker }); await f.reset(); assert.equal(f.local.getItem(ownerKey), raw); assert.equal(f.rpcCalls, 0);
});

for (const kind of ['old generation', 'contradictory receipt', 'UUID case conflict'] as const) test(`P2B completed retry with ${kind} preserves opaque bytes and refuses another cleanup`, async t => {
  const f = seeded(); t.after(f.dispose); await f.reset();
  let raw: string;
  if (kind === 'old generation') raw = canonicalJson(populated());
  else {
    const current = structuredClone(partition(f.local)); assert.equal(current.enrollment.kind, 'reset-replacement');
    if (current.enrollment.kind !== 'reset-replacement') assert.fail();
    if (kind === 'contradictory receipt') current.enrollment.requestId = oldRequest;
    else { current.enrollment.requestId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'; current.enrollment.marker = '2026-10-09T12:00:00.654321Z|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; current.marker = current.enrollment.marker; }
    raw = canonicalJson(current);
  }
  f.values.set(ownerKey, raw); const before = f.project(recordKeys); await assert.rejects(f.reset());
  assert.deepEqual(f.project(recordKeys), before); assert.equal(f.rpcCalls, 1);
});

async function observationFixture(localMarker: string | null, participantRaw: string | null, remoteMarker: string | null) {
  const f = languageFixture(); const lease = await f.owner('a');
  const local = { ...(localMarker === null ? {} : { [boundary.LANGUAGE_MARKER_KEY]: localMarker }), savedWords: 'synthetic retained legacy record', japaneseAppSettings: 'synthetic retained setting' };
  for (const [key, value] of Object.entries(local)) f.values.set(key, value);
  f.values.set(boundary.languageSyncBaseKey('a'), JSON.stringify(local)); f.values.set(boundary.languageSyncAckKey('a'), crypto.randomUUID());
  if (participantRaw !== null) f.values.set(conversationLocalKey('a'), participantRaw);
  f.values.set(otherKey, canonicalJson(populated(otherOwner))); f.values.set('ai-fitness-untouched', 'other-app-preserved');
  const remote = remoteMarker === localMarker ? local : { ...(remoteMarker === null ? {} : { [boundary.LANGUAGE_MARKER_KEY]: remoteMarker }), japaneseAppSettings: local.japaneseAppSettings };
  const states: Array<ReturnType<ReturnType<typeof createLanguageSyncCoordinator>['getState']>> = [];
  let writes = 0, reads = 0;
  const coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState: state => states.push(state), transport: {
    async verifyOwner() { assert.equal(f.locks.active, 0); return true; },
    async read() { assert.equal(f.locks.active, 0); reads++; return { state: remote, updatedAt: 'synthetic-time' }; },
    async insert() { writes++; throw new Error('Unexpected insert'); },
    async update() { writes++; throw new Error('Unexpected update'); },
  } });
  return { ...f, coordinator, states, get reads() { return reads; }, get writes() { return writes; }, dispose() { coordinator.dispose(); f.restore(); } };
}

test('P2B authenticated remote reset atomically clears current-owner participant and legacy records', async t => {
  const original = canonicalJson(populated('a')), f = await observationFixture(oldMarker, original, marker); t.after(f.dispose);
  const key = conversationLocalKey('a'), other = f.storage.getItem(otherKey), projections: Array<[string | null, string | null, string | null]> = [];
  const set = f.storage.setItem, remove = f.storage.removeItem;
  const inspect = () => { const snapshot = transactions.readStorageSnapshot(f.storage); projections.push([snapshot.getItem(boundary.LANGUAGE_MARKER_KEY), snapshot.getItem(key), snapshot.getItem('savedWords')]); };
  f.storage.setItem = (key, value) => { set(key, value); inspect(); }; f.storage.removeItem = key => { remove(key); inspect(); };
  await f.coordinator.start(); assert.equal(f.coordinator.getState().status, 'ready'); assert.equal(f.coordinator.getState().reset, true);
  const after = partition(f.storage, 'a'); assert.equal(after.marker, marker); assert.deepEqual(after.sessions, []);
  assert.equal(after.enrollment.kind, 'reset-replacement');
  if (after.enrollment.kind !== 'reset-replacement') assert.fail();
  assert.equal(after.enrollment.reason, 'remote-reset'); assert.equal(after.enrollment.requestId, request);
  assert.equal(f.storage.getItem(otherKey), other); assert.equal(f.storage.getItem('ai-fitness-untouched'), 'other-app-preserved'); assert.equal(f.writes, 0);
  for (const [visibleMarker, raw, legacy] of projections) {
    if (visibleMarker === oldMarker) { assert.equal(raw, original); assert.equal(legacy, 'synthetic retained legacy record'); }
    else { assert.equal(visibleMarker, marker); assert.equal(raw, f.storage.getItem(key)); assert.equal(legacy, null); }
  }
});

test('P2B ordinary authenticated observation catches an older conversation generation without repeating legacy reset', async t => {
  const f = await observationFixture(marker, canonicalJson(populated('a')), marker); t.after(f.dispose);
  const legacyBefore = boundary.projectLanguageBytes(f.storage), other = f.storage.getItem(otherKey);
  await f.coordinator.start(); assert.equal(f.coordinator.getState().status, 'ready'); assert.equal(f.coordinator.getState().reset, false);
  const after = partition(f.storage, 'a'); assert.equal(after.marker, marker); assert.deepEqual(after.sessions, []);
  assert.equal(after.enrollment.kind, 'reset-replacement');
  if (after.enrollment.kind !== 'reset-replacement') assert.fail();
  assert.equal(after.enrollment.reason, 'observation-catch-up'); assert.equal(after.enrollment.previousMarker, oldMarker);
  assert.ok(after.enrollment.observation); assert.equal(after.enrollment.observation.marker, marker);
  assert.deepEqual(boundary.projectLanguageBytes(f.storage), legacyBefore); assert.equal(f.storage.getItem(otherKey), other); assert.equal(f.writes, 0);
});

for (const localMarker of [null, marker]) test(`P2B ordinary observation keeps an absent owner partition absent (${localMarker})`, async t => {
  const f = await observationFixture(localMarker, null, localMarker); t.after(f.dispose);
  await f.coordinator.start(); assert.equal(f.coordinator.getState().status, 'ready'); assert.equal(f.storage.getItem(conversationLocalKey('a')), null);
});

test('P2B matching authenticated observation preserves every byte of supported sessions and staged commands', async t => {
  const raw = canonicalJson(populated('a', marker)), f = await observationFixture(marker, raw, marker); t.after(f.dispose);
  await f.coordinator.start(); assert.equal(f.coordinator.getState().status, 'ready'); assert.equal(f.storage.getItem(conversationLocalKey('a')), raw);
});

for (const [label, partitionMarker] of [
  ['ahead', '2026-10-10T12:00:00Z|33333333-3333-4333-8333-333333333333'],
  ['tied different UUID', `2026-10-09T12:00:00.654321Z|${oldRequest}`],
  ['submillisecond tied different marker', `2026-10-09T12:00:00.654322Z|${oldRequest}`],
] as const) test(`P2B ordinary observation blocks ${label} partition marker and preserves all records`, async t => {
  const raw = canonicalJson(populated('a', partitionMarker)), f = await observationFixture(marker, raw, marker); t.after(f.dispose);
  const before = new Map(f.values); await f.coordinator.start(); assert.notEqual(f.coordinator.getState().status, 'ready');
  assert.deepEqual(f.values, before); assert.equal(f.coordinator.getState().context, undefined); assert.equal(f.writes, 0);
});

for (const [label, raw] of corruptCases) test(`P2B authenticated observation rejects ${label} partition without legacy or participant repair`, async t => {
  // The current-owner mismatch case deliberately remains a foreign owner; all other
  // fixtures need the observation fixture's own authenticated identity.
  const source = label === 'wrong owner' ? raw() : raw().replaceAll(owner, 'a');
  const f = await observationFixture(marker, source, marker); t.after(f.dispose); const before = new Map(f.values);
  await f.coordinator.start(); assert.notEqual(f.coordinator.getState().status, 'ready'); assert.equal(f.coordinator.getState().context, undefined);
  assert.deepEqual(f.values, before); assert.doesNotMatch(JSON.stringify(f.states), /PRIVATE_SYNTHETIC/); assert.equal(f.writes, 0);
});

for (const [label, operation, target, nth] of [
  ['prepared journal', 'set', transactions.STORAGE_PROTOCOL_KEY, 1],
  ['participant replacement', 'set', conversationLocalKey('a'), 1],
  ['legacy deletion', 'remove', 'savedWords', 1],
  ['language marker', 'set', boundary.LANGUAGE_MARKER_KEY, 1],
  ['baseline replacement', 'set', boundary.languageSyncBaseKey('a'), 1],
  ['acknowledgement', 'set', boundary.languageSyncAckKey('a'), 1],
  ['durable marker', 'set', transactions.STORAGE_PROTOCOL_KEY, 2],
] as const) test(`P2B remote-reset ${label} failure restores participant plus legacy atomically and can retry from authenticated observation`, async t => {
  const f = await observationFixture(oldMarker, canonicalJson(populated('a')), marker); t.after(f.dispose);
  const keys = [...boundary.LANGUAGE_STORAGE_KEYS, conversationLocalKey('a'), otherKey, boundary.languageSyncBaseKey('a'), boundary.languageSyncAckKey('a')];
  const project = () => { const snapshot = transactions.readStorageSnapshot(f.storage); return Object.fromEntries(keys.map(key => [key, snapshot.getItem(key)])); };
  const before = project(), set = f.storage.setItem, remove = f.storage.removeItem; let remaining: number = nth, failed = false;
  const maybeFail = (mode: string, key: string) => { if (!failed && mode === operation && key === target && --remaining === 0) { failed = true; throw new Error('PRIVATE_SYNTHETIC_REMOTE_QUOTA'); } };
  f.storage.setItem = (key, value) => { maybeFail('set', key); set(key, value); }; f.storage.removeItem = key => { maybeFail('remove', key); remove(key); };
  await f.coordinator.start(); assert.equal(failed, true); assert.notEqual(f.coordinator.getState().status, 'ready'); assert.deepEqual(project(), before);
  assert.doesNotMatch(JSON.stringify(f.states), /PRIVATE_SYNTHETIC/); assert.equal(f.coordinator.getState().context, undefined);
  await f.coordinator.refresh(); assert.equal(f.coordinator.getState().status, 'ready'); assert.equal(partition(f.storage, 'a').marker, marker);
  assert.deepEqual(partition(f.storage, 'a').sessions, []); assert.equal(f.writes, 0); assert.equal(f.reads, 2);
});

test('P2B remote reset keeps absent participant absent while clearing only legacy records', async t => {
  const f = await observationFixture(oldMarker, null, marker); t.after(f.dispose); const other = f.storage.getItem(otherKey);
  await f.coordinator.start(); assert.equal(f.coordinator.getState().status, 'ready'); assert.equal(f.storage.getItem(conversationLocalKey('a')), null);
  assert.equal(f.storage.getItem('savedWords'), null); assert.equal(f.storage.getItem(otherKey), other);
});

test('P2B ordinary observation catch-up replacement failure leaves new legacy records and old participant untouched', async t => {
  const f = await observationFixture(marker, canonicalJson(populated('a')), marker); t.after(f.dispose);
  const before = boundary.projectLanguageBytes(f.storage), raw = f.storage.getItem(conversationLocalKey('a')), set = f.storage.setItem; let failed = false;
  f.storage.setItem = (key, value) => { if (!failed && key === conversationLocalKey('a')) { failed = true; throw new Error('synthetic catch-up failure'); } set(key, value); };
  await f.coordinator.start(); assert.equal(failed, true); assert.notEqual(f.coordinator.getState().status, 'ready');
  assert.equal(f.storage.getItem(conversationLocalKey('a')), raw); assert.deepEqual(boundary.projectLanguageBytes(f.storage), before);
  await f.coordinator.refresh(); assert.equal(f.coordinator.getState().status, 'ready'); assert.equal(f.coordinator.getState().reset, false);
  assert.equal(partition(f.storage, 'a').marker, marker); assert.deepEqual(boundary.projectLanguageBytes(f.storage), before);
});

test('P2B notification queue failure rejects explicit reset acknowledgement but preserves completed receipt and post-reset sessions on retry', async t => {
  const f = seeded(); t.after(f.dispose); const originalQueueMicrotask = globalThis.queueMicrotask;
  t.after(() => { globalThis.queueMicrotask = originalQueueMicrotask; });
  const fenceStates: string[] = []; let failed = false;
  f.observe((key, raw) => { if (key === boundary.LANGUAGE_RESET_FENCE_KEY) fenceStates.push(boundary.parseLanguageResetFence(raw)!.state); });
  f.onRpc(() => {
    globalThis.queueMicrotask = callback => {
      if (!failed && boundary.parseLanguageResetFence(f.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY))?.state === 'completed') {
        failed = true; throw new Error('PRIVATE_SYNTHETIC_QUEUE_HOST_ERROR');
      }
      originalQueueMicrotask(callback);
    };
  });
  await assert.rejects(f.reset(), error => {
    assert.match(String(error), /클라우드 초기화는 완료됐지만/); assert.doesNotMatch(String(error), /PRIVATE_SYNTHETIC_QUEUE_HOST_ERROR/); return true;
  });
  assert.equal(failed, true); assert.deepEqual(fenceStates, ['pending', 'completed']);
  assert.equal(boundary.parseLanguageResetFence(f.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY))?.state, 'completed');
  const completed = partition(f.local); assert.equal(completed.marker, marker); assert.deepEqual(completed.sessions, []);
  assert.equal(f.sessions.size, 0); assert.equal(f.local.getItem(resets.RECORD_RESET_STORAGE_EVENT), null);
  const later = save({ ...completed, sessions: [emptySession()] }, draft('draft-after-notification-failure', 'PRIVATE_SYNTHETIC_NEW_POST_RESET_SESSION'));
  f.values.set(ownerKey, canonicalJson(later)); f.values.set('savedWords', 'synthetic new legacy records');
  const before = f.project(recordKeys), fenceBefore = f.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY);
  globalThis.queueMicrotask = originalQueueMicrotask; f.onRpc(undefined); await f.reset();
  assert.deepEqual(f.project(recordKeys), before); assert.equal(f.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY), fenceBefore);
  assert.deepEqual(fenceStates, ['pending', 'completed']); assert.equal(f.rpcCalls, 1); assert.equal(f.getCalls, 1);
  assert.equal(f.sessions.get(`record-reset-receipt:${owner}:language`), '1');
});

test('P2B direct reset completion exposes committed acknowledgement error with fixed diagnostics after notification queue failure', async t => {
  const f = seeded(); t.after(f.dispose); const context = await resetFence.establishLanguageReset(resetFence.captureLanguageReset(request, owner));
  const originalQueueMicrotask = globalThis.queueMicrotask; t.after(() => { globalThis.queueMicrotask = originalQueueMicrotask; });
  let failed = false;
  globalThis.queueMicrotask = callback => {
    if (!failed && boundary.parseLanguageResetFence(f.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY))?.state === 'completed') {
      failed = true; throw new Error('PRIVATE_SYNTHETIC_DIRECT_NOTIFICATION_ERROR');
    }
    originalQueueMicrotask(callback);
  };
  await assert.rejects(resetFence.completeLanguageReset(context, marker), error => {
    assert.ok(error instanceof resetFence.LanguageResetAcknowledgementError); assert.equal(error.committed, true);
    assert.equal(error.message, new resetFence.LanguageResetAcknowledgementError().message);
    assert.doesNotMatch(JSON.stringify({ ...error, name: error.name, message: error.message }), /PRIVATE_SYNTHETIC_DIRECT_NOTIFICATION_ERROR/);
    return true;
  });
  assert.equal(failed, true); assert.equal(boundary.parseLanguageResetFence(f.local.getItem(boundary.LANGUAGE_RESET_FENCE_KEY))?.state, 'completed');
  assert.equal(partition(f.local).marker, marker); assert.deepEqual(partition(f.local).sessions, []);
  for (const key of resets.APP_RECORD_KEYS.language) assert.equal(f.local.getItem(key), null);
});

test('P2B known corrupt participant with dirty legacy records blocks before any authenticated transport read or update', async t => {
  const f = await observationFixture(marker, canonicalJson(populated('a', marker)), marker); t.after(f.dispose);
  f.values.set(conversationLocalKey('a'), '{PRIVATE_SYNTHETIC_PREFLIGHT_CORRUPTION');
  f.values.set('savedWords', 'synthetic dirty legacy records not yet uploaded');
  const before = new Map(f.values); await f.coordinator.start();
  assert.notEqual(f.coordinator.getState().status, 'ready'); assert.equal(f.coordinator.getState().context, undefined);
  assert.equal(f.reads, 0); assert.equal(f.writes, 0); assert.deepEqual(f.values, before);
  assert.doesNotMatch(JSON.stringify(f.states), /PRIVATE_SYNTHETIC_PREFLIGHT_CORRUPTION/);
});

function guidedResetEnvelope(ownerId = owner, resetMarker = oldMarker) {
  const current = populated(ownerId, resetMarker), script = GUIDED_CONVERSATION_PILOT[2];
  const result = planCreateSession(current, current, { ...emptySession('guided-reset-session'), source: freezeGuidedSource(script.scriptId, script.scriptRevision)! });
  assert.notEqual(result.status, 'blocked'); if (result.status === 'blocked') assert.fail(); return result.envelope;
}
test('G5 actual explicit reset atomically preserves v2 and same-marker retry preserves new post-reset guided session', async t => {
  const initial = guidedResetEnvelope(), f = seeded({ [ownerKey]: canonicalJson(initial) }); t.after(f.dispose);
  f.fail('set', resets.RECORD_RESET_STORAGE_EVENT); await assert.rejects(f.reset());
  const after = partition(f.local); assert.equal(after.schemaVersion, 2); assert.deepEqual(after.sessions, []);
  assert.equal(after.enrollment.kind, 'reset-replacement'); if (after.enrollment.kind !== 'reset-replacement') assert.fail();
  assert.equal(after.enrollment.previousGenerationId, initial.generationId); assert.equal(after.enrollment.reason, 'explicit-reset');
  const script = GUIDED_CONVERSATION_PILOT[0], next = planCreateSession(after, after, { ...emptySession('post-reset-guided'), source: freezeGuidedSource(script.scriptId, script.scriptRevision)! });
  assert.notEqual(next.status, 'blocked'); if (next.status === 'blocked') assert.fail();
  const raw = canonicalJson(next.envelope); f.values.set(ownerKey, raw); await f.reset();
  assert.equal(f.local.getItem(ownerKey), raw); assert.equal(f.rpcCalls, 1); assert.equal(f.getCalls, 1);
});
for (const catchUp of [false, true]) test(`G5 actual authenticated ${catchUp ? 'catch-up' : 'remote reset'} retains v2 empty replacement`, async t => {
  const initial = guidedResetEnvelope('a'), raw = canonicalJson(initial), f = await observationFixture(catchUp ? marker : oldMarker, raw, marker); t.after(f.dispose);
  const oldLegacy = boundary.projectLanguageBytes(f.storage), other = f.storage.getItem(otherKey);
  await f.coordinator.start(); assert.equal(f.coordinator.getState().status, 'ready');
  const after = partition(f.storage, 'a'); assert.equal(after.schemaVersion, 2); assert.deepEqual(after.sessions, []); assert.deepEqual(after.tombstones, []);
  assert.equal(after.enrollment.kind, 'reset-replacement'); if (after.enrollment.kind !== 'reset-replacement') assert.fail();
  assert.equal(after.enrollment.previousGenerationId, initial.generationId); assert.equal(after.enrollment.reason, catchUp ? 'observation-catch-up' : 'remote-reset');
  assert.equal(after.enrollment.observation?.marker, marker); assert.equal(f.storage.getItem(otherKey), other); assert.equal(f.writes, 0);
  if (catchUp) assert.deepEqual(boundary.projectLanguageBytes(f.storage), oldLegacy);
});
