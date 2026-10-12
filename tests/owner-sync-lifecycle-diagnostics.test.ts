import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as diagnostics from '../app/data/ownerSyncDiagnostics.ts';
import * as transactions from '../app/data/storageTransaction.ts';
import { assertAuthenticatedStorageOwner, assertAuthenticatedStorageOwnerRecheck, AUTHENTICATED_STORAGE_OWNER_READY_EVENT, AUTHENTICATED_STORAGE_OWNER_RECHECK_EVENT, AUTHENTICATED_STORAGE_OWNER_RECHECK_READY_EVENT, type AuthenticatedStorageOwner, type AuthenticatedStorageOwnerRecheck } from '../app/data/authenticatedStorageOwner.ts';
import { projectStateDiagnostic, stateDiagnosticCollector } from '../scripts/qa-state-diagnostics.mjs';

const helperSource = readFileSync(new URL('../app/data/ownerSyncDiagnostics.ts', import.meta.url), 'utf8');
const collectorSource = readFileSync(new URL('./e2e/owner-switch-diagnostics.ts', import.meta.url), 'utf8');
const lifecyclePrefix = 'QA_OWNER_SYNC_LIFECYCLE';
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function load(source: string, globals: Record<string, unknown>, imports: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${compiled}\n})`, globals)(exports, (name: string) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected dependency ${name}`); return imports[name];
  });
  return exports;
}
function fixture(overrides: Record<string, unknown> = {}) {
  const window = new EventTarget(), messages: string[] = [];
  let authorityReads = 0;
  const forbidden = () => { authorityReads++; throw new Error('Diagnostics accessed authority'); };
  const context: Record<string, unknown> = { window, CustomEvent, Event, console: { log: (line: string) => messages.push(line) }, ...overrides };
  for (const key of ['localStorage', 'navigator', 'document', 'fetch']) Object.defineProperty(context, key, { get: forbidden });
  const helper = load(helperSource, context, { './storageTransaction.ts': transactions }) as typeof diagnostics;
  const collector = load(collectorSource, context, { '../../app/data/storageTransaction': transactions,
    '../../app/data/ownerSyncDiagnostics': helper, './navigation-diagnostics': { failureLabel: () => 'other' } });
  const install = collector.installOwnerSyncDiagnostics as (context: { addInitScript: (fn: (args: unknown) => void, args: unknown) => Promise<void> }) => Promise<void>;
  const run = collector.ownerSwitchDiagnostic as (page: unknown, phase: string, refs: unknown, tab: string, failed: boolean) => Promise<void>;
  const page = { evaluate: async (fn: (args: unknown) => unknown, args: unknown) => typeof args === 'string' ? fn(args) : {} };
  return { helper, window, messages, page, authorityReads: () => authorityReads,
    install: () => install({ addInitScript: async (fn, args) => { fn(args); } }),
    installFailure: () => install({ addInitScript: async () => { throw new Error('PRIVATE_INSTALL'); } }),
    async report(phase = 'owner-b-ready', failed = false) {
      await run(page, phase, { ownerA: 'PRIVATE_A', ownerB: 'PRIVATE_B', stateA: {}, stateB: {}, traffic: { entries: [] } }, 'first', failed);
      const lines = messages.splice(0).filter(line => line.startsWith(lifecyclePrefix + ' '));
      return lines.map(line => { assert.ok(line.length <= 4096); const projected = projectStateDiagnostic(line); assert.ok(projected); return JSON.parse(projected.line.slice(lifecyclePrefix.length + 1)); });
    },
  };
}
function projected(data: unknown) {
  const result = projectStateDiagnostic(`${lifecyclePrefix} ${JSON.stringify(data)}`); assert.ok(result);
  assert.ok(result.line.length <= 4096); return JSON.parse(result.line.slice(lifecyclePrefix.length + 1));
}

test('emitter constructs only primitive allowlisted observations without inspecting raw getters', () => {
  const f = fixture(), received: unknown[] = [];
  f.window.addEventListener(diagnostics.OWNER_SYNC_DIAGNOSTIC_EVENT, event => received.push((event as CustomEvent).detail));
  let getters = 0;
  const fields = Object.assign(Object.create({ ownerRelation: 'same-owner' }), {
    epochRelation: 'same-as-loop', failure: 'PRIVATE_ERROR', proof: { token: 'PRIVATE_TOKEN' }, retirementIndex: 1,
    userId: 'PRIVATE_OWNER', epoch: 'PRIVATE_EPOCH', request: {}, lease: {}, records: { raw: 'PRIVATE_RECORD' },
  });
  Object.defineProperty(fields, 'reason', { get() { getters++; throw new Error('PRIVATE_GETTER'); } });
  f.helper.emitOwnerSyncDiagnostic('panel', 'retired', fields);
  assert.deepEqual(plain(received), [{ component: 'panel', stage: 'retired', epochRelation: 'same-as-loop', retirementIndex: 1 }]);
  assert.equal(getters, 0); assert.equal(f.authorityReads(), 0); assert.ok(Object.isFrozen(received[0]));
  assert.equal(f.helper.projectOwnerSyncDiagnostic('PRIVATE_COMPONENT', 'retired', {}), null);
  assert.equal(f.helper.projectOwnerSyncDiagnostic('panel', 'PRIVATE_STAGE', {}), null);
  for (const retirementIndex of [-1, 0, 10001, Infinity, NaN, 1.5, '1', {}, null]) {
    assert.deepEqual(plain(f.helper.projectOwnerSyncDiagnostic('panel', 'retired', { retirementIndex })), { component: 'panel', stage: 'retired' });
  }
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assert.doesNotThrow(() => f.helper.emitOwnerSyncDiagnostic('panel', 'retired', revoked.proxy));
});

test('unknown exceptions are classified by known constructors without reading name, message or stack', () => {
  const f = fixture(); let reads = 0;
  const cases = [[new transactions.StorageSnapshotBusyError(), 'snapshot-busy'], [new transactions.StorageSessionChangedError(), 'session-changed'],
    [new transactions.StorageCorruptionError(), 'corrupt'], [new transactions.StorageLegacyMigrationRequiredError(), 'corrupt'],
    [new transactions.StorageLocksUnavailableError(), 'locks-unavailable'], [new Error('PRIVATE_EXCEPTION'), 'other'], [{}, 'other']] as const;
  for (const [error, expected] of cases) {
    for (const key of ['name', 'message', 'stack']) Object.defineProperty(error, key, { get() { reads++; throw new Error('Getter executed'); }, configurable: true });
    assert.equal(f.helper.classifyOwnerSyncDiagnosticFailure(error), expected);
  }
  assert.equal(f.helper.classifyOwnerSyncDiagnosticFailure({ name: 'StorageSnapshotBusyError', message: 'PRIVATE' }), 'other');
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assert.equal(f.helper.classifyOwnerSyncDiagnosticFailure(revoked.proxy), 'other'); assert.equal(reads, 0);
});

test('missing facilities, construction failures and throwing emitters preserve caller results', async () => {
  for (const overrides of [{ window: undefined }, { CustomEvent: undefined }, { window: { dispatchEvent() { throw new Error('PRIVATE_LISTENER'); } } },
    { CustomEvent: class { constructor() { throw new Error('PRIVATE_CONSTRUCTOR'); } } }]) {
    const f = fixture(overrides);
    const operation = () => { f.helper.emitOwnerSyncDiagnostic('panel', 'binding-activated'); return 'original-result'; };
    assert.equal(operation(), 'original-result'); assert.deepEqual(f.messages, []); assert.equal(f.authorityReads(), 0);
  }
  const f = fixture(); await f.installFailure(); assert.deepEqual(await f.report(), []);
});

test('collector or output failures never replace the existing scenario failure and expose no exception data', async () => {
  const f = fixture();
  Object.defineProperty(f.window, '__yeoniOwnerSyncDiagnosticBuffer', { value: { drain() { throw new Error('PRIVATE_COLLECTOR_ERROR'); } } });
  const report = await f.report('after-b-login', true);
  assert.equal(report[0].probe, 'unavailable'); assert.equal(report[0].failed, true); assert.equal(report[0].phase, 'after-b-login');
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
  const outputFailure = fixture({ console: { log(line: string) { if (line.startsWith(lifecyclePrefix)) throw new Error('PRIVATE_OUTPUT_ERROR'); } } });
  await outputFailure.install(); outputFailure.helper.emitOwnerSyncDiagnostic('panel', 'retired');
  await assert.doesNotReject(outputFailure.report());
  f.page.evaluate = async () => { throw new Error('PRIVATE_CLOSED_DOCUMENT'); };
  await assert.doesNotReject(f.report('after-reload', true));
});

test('passive collector keeps 48 entries, drains without replay, and caps index and dropped counts', async () => {
  const f = fixture(); const dispatch = f.window.dispatchEvent, listen = f.window.addEventListener;
  await f.install(); await f.install();
  assert.equal(f.window.dispatchEvent, dispatch); assert.equal(f.window.addEventListener, listen);
  for (let i = 0; i < 60; i++) f.helper.emitOwnerSyncDiagnostic('panel', 'retired', { retirementIndex: 1 });
  const first = await f.report(); assert.equal(first.length, 6);
  const events = first.flatMap(line => line.events); assert.equal(events.length, 48); assert.equal(events[0].index, 13); assert.equal(events.at(-1).index, 60);
  assert.equal(first.reduce((sum, line) => sum + line.dropped, 0), 12); assert.deepEqual(await f.report(), []);
  for (let i = 0; i < 21000; i++) f.helper.emitOwnerSyncDiagnostic('gate', 'ordinary-proof-published');
  const capped = await f.report(); assert.equal(capped.flatMap(line => line.events).at(-1).index, 10000);
  assert.equal(capped[0].dropped, 10000); assert.deepEqual(await f.report(), []);
  f.helper.emitOwnerSyncDiagnostic('panel', 'retired');
  const overflow = await f.report(); assert.deepEqual(overflow[0].events, []); assert.equal(overflow[0].dropped, 1);
  assert.equal(f.authorityReads(), 0);
});

test('collector projects fake payloads, bypasses detail getters and ignores authority events', async () => {
  const f = fixture(); await f.install(); let getterCalls = 0;
  const detail = { component: 'panel', stage: 'retired', ownerRelation: 'different-owner', epochRelation: 'different-from-loop',
    owner: 'PRIVATE_OWNER', epoch: 'PRIVATE_EPOCH', token: 'PRIVATE_TOKEN', request: {}, lease: {}, records: ['PRIVATE_RECORD'] };
  Object.defineProperty(detail, 'reason', { get() { getterCalls++; return 'PRIVATE_REASON'; } });
  class MisleadingEvent extends CustomEvent<unknown> { get detail(): unknown { getterCalls++; throw new Error('PRIVATE_EVENT'); } }
  f.window.dispatchEvent(new MisleadingEvent(diagnostics.OWNER_SYNC_DIAGNOSTIC_EVENT, { detail }));
  for (const event of [AUTHENTICATED_STORAGE_OWNER_READY_EVENT, AUTHENTICATED_STORAGE_OWNER_RECHECK_EVENT, AUTHENTICATED_STORAGE_OWNER_RECHECK_READY_EVENT]) {
    f.window.dispatchEvent(new CustomEvent(event, { detail }));
  }
  f.window.dispatchEvent(new CustomEvent(diagnostics.OWNER_SYNC_DIAGNOSTIC_EVENT, { detail: { ...detail, stage: 'PRIVATE_STAGE' } }));
  // The spread above does not include the non-enumerable malicious accessor.
  const result = await f.report(); assert.equal(result[0].events.length, 1); assert.equal(getterCalls, 0);
  assert.deepEqual(result[0].events[0], { index: 1, component: 'panel', stage: 'retired', ownerRelation: 'different-owner', epochRelation: 'different-from-loop' });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|request|lease|records|token/); assert.equal(f.authorityReads(), 0);
});

test('diagnostic events cannot satisfy lease/recheck registries or cause auth/storage work', async () => {
  const f = fixture(); await f.install(); let authEvents = 0, storageReads = 0;
  for (const event of [AUTHENTICATED_STORAGE_OWNER_READY_EVENT, AUTHENTICATED_STORAGE_OWNER_RECHECK_EVENT, AUTHENTICATED_STORAGE_OWNER_RECHECK_READY_EVENT]) f.window.addEventListener(event, () => authEvents++);
  const storage = { getItem() { storageReads++; throw new Error('Unexpected authority read'); }, key() { storageReads++; return null; }, get length() { storageReads++; return 0; } };
  f.window.addEventListener(diagnostics.OWNER_SYNC_DIAGNOSTIC_EVENT, event => {
    const detail = (event as CustomEvent).detail;
    assert.throws(() => assertAuthenticatedStorageOwner(detail as AuthenticatedStorageOwner), transactions.StorageSessionChangedError);
    assert.throws(() => assertAuthenticatedStorageOwnerRecheck(detail as AuthenticatedStorageOwnerRecheck, storage), transactions.StorageSessionChangedError);
  });
  f.helper.emitOwnerSyncDiagnostic('panel', 'request-dispatched', { retirementIndex: 2 });
  assert.equal(authEvents, 0); assert.equal(storageReads, 0); assert.equal(f.authorityReads(), 0);
  assert.equal((await f.report())[0].events[0].stage, 'request-dispatched');
  assert.doesNotMatch(helperSource, /getUser|readStorage|localStorage|setTimeout|setInterval|console\./);
});

test('output boundary drops arbitrary identities, raw exceptions, unknown keys and nested objects', () => {
  const raw = 'PRIVATE_OWNER_EPOCH_TOKEN_RECORD\u001b[31m\nPRIVATE_NEXT_LINE';
  const value = projected({ phase: 'owner-b-ready', tab: 'first', failed: true, dropped: 1, raw,
    events: [{ index: 1, component: 'panel', stage: 'retired', ownerRelation: 'same-owner', epochRelation: 'same-as-loop', retirementIndex: 1,
      failure: { message: raw }, reason: raw, proof: [raw], request: { userId: raw }, lease: { epoch: raw }, ownerId: raw, token: raw, data: raw, stack: raw },
    null, [], raw, { index: 2, component: raw, stage: 'retired' }, { index: 3, component: 'panel', stage: raw }] });
  assert.equal(value.events.length, 1); assert.doesNotMatch(JSON.stringify(value), /PRIVATE|ownerId|request|lease|stack|data/);
  assert.deepEqual(value.events[0], { index: 1, component: 'panel', stage: 'retired', ownerRelation: 'same-owner', epochRelation: 'same-as-loop', retirementIndex: 1 });
  for (const payload of ['{', 'null', '[]', '1', '"PRIVATE"', JSON.stringify({ events: [raw.repeat(1000)] })]) assert.equal(projectStateDiagnostic(`${lifecyclePrefix} ${payload}`), null);
  for (const index of [-1, 0, 10001, '1', 0.5, {}, null]) assert.deepEqual(projected({ events: [{ index, component: 'panel', stage: 'retired' }] }).events, []);
  for (const dropped of [-1, 10001, '1', {}, null]) assert.equal(projected({ dropped }).dropped, null);
  assert.deepEqual(projected({ events: { raw } }).events, []);
  const prototype = projectStateDiagnostic(`${lifecyclePrefix} {"events":[{"index":1,"__proto__":{"component":"panel","stage":"retired"},"raw":"PRIVATE"}]}`);
  assert.ok(prototype); assert.doesNotMatch(prototype.line, /PRIVATE|__proto__/); assert.deepEqual(JSON.parse(prototype.line.slice(lifecyclePrefix.length + 1)).events, []);
});

test('runtime and runner agree on all closed enums and eight maximal events fit existing line limits', () => {
  for (const [key, values] of Object.entries(diagnostics.OWNER_SYNC_DIAGNOSTIC_SCHEMA)) {
    for (const value of values) {
      const event = { index: 1, component: 'panel', stage: 'retired', [key]: value };
      assert.equal(projected({ events: [event] }).events[0][key], value);
    }
  }
  const event = { index: 10000, component: 'panel', stage: 'observation-cancelled', retirementIndex: 10000,
    ownerRelation: 'different-owner', epochRelation: 'different-from-loop', failure: 'locks-unavailable', proof: 'correlated', outcome: 'wrong-current-binding', reason: 'epoch-or-owner' };
  const value = projected({ phase: 'isolation-verified', tab: 'holder', failed: true, dropped: 10000, events: Array.from({ length: 12 }, () => event) });
  assert.equal(value.events.length, 8);
  const collector = stateDiagnosticCollector();
  for (let i = 0; i < 11000; i++) {
    const result = collector.ingest(`${lifecyclePrefix} {"events":[],"raw":"PRIVATE"}`);
    assert.equal(Boolean(result), i < 512);
  }
  assert.equal(collector.snapshot().emitted[lifecyclePrefix], 512); assert.equal(collector.snapshot().dropped[lifecyclePrefix], 10000);
});

test('collector installs before original navigation and does not introduce recovery or altered assertions', () => {
  const source = readFileSync(new URL('./e2e/storage-protocol.spec.ts', import.meta.url), 'utf8');
  const scenario = source.slice(source.indexOf("test('queued owner A edit"), source.indexOf("test('legacy v1 recovery"));
  assert.equal((scenario.match(/installOwnerSyncDiagnostics\(context\)/g) ?? []).length, 1);
  assert.ok(scenario.indexOf('installOwnerSyncDiagnostics(context)') < scenario.indexOf('await login('));
  const install = collectorSource.slice(collectorSource.indexOf('export async function installOwnerSyncDiagnostics'), collectorSource.indexOf('async function ownerSyncLifecycleDiagnostic'));
  assert.match(install, /context\.addInitScript/); assert.match(install, /window\.addEventListener\(eventName/);
  assert.doesNotMatch(install, /localStorage|sessionStorage|fetch\(|getUser|\.route\(|dispatchEvent|\.click\(|\.goto\(|setTimeout|setInterval|\.prototype\s*=/);
});
