import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { clearLocalCloudState, prepareLocalCloudState, stableState } from './cloudSync.ts';
import { assertLanguageSyncDispatchCurrent, captureLanguageDraftRevision, commitLanguageRemoteReset, commitLanguageSyncResponse, compareLanguageReset, createLanguageSyncLifecycle,
  isLanguageRecordContextCurrent, isLanguageSyncRequestCurrent, planLanguageSync, readLanguageSyncRequest, updateLanguageRecords } from './languageCloudSync.ts';
import { LANGUAGE_BINDING_KEY, LANGUAGE_MARKER_KEY, LANGUAGE_OWNER_KEY, LANGUAGE_RESET_FENCE_KEY, LANGUAGE_STORAGE_KEYS, languageSyncAckKey, languageSyncBaseKey, parseLanguageMarker, projectLanguageBytes, readLanguageSyncBase } from './languageStorageBoundary.ts';
import { createLanguageSyncCoordinator } from './languageSyncCoordinator.ts';
import { invalidateStorageOwner, readStorageSnapshot, RECORDS_CHANGED_EVENT, STORAGE_PROTOCOL_KEY, STORAGE_READY_KEY, updateStorageBatch } from './storageTransaction.ts';
import { languageFixture, deferred, marker, settle } from '../../tests/helpers/languageFixture.ts';
import { preparedStorageSeed } from '../../tests/helpers/storageProtocol.ts';

test('O10 no-ack bootstrap exact local, exact legacy base pending delta, empty import, divergent and absent history', async () => {
  const cases = [
    { local: 'same', base: null, remote: { savedWords: 'same' }, kind: 'observe' },
    { local: 'new-local', base: '{"savedWords":"old"}', remote: { savedWords: 'old' }, kind: 'bootstrap-base' },
    { local: null, base: null, remote: { savedWords: 'remote' }, kind: 'observe' },
    { local: 'different', base: null, remote: { savedWords: 'remote' }, kind: 'blocked' },
    { local: 'legacy', base: null, remote: null, kind: 'blocked' },
    { local: null, base: '{"savedWords":"old"}', remote: null, kind: 'blocked' },
  ] as const;
  for (const row of cases) {
    const f = languageFixture({ ...preparedStorageSeed('a'), [LANGUAGE_OWNER_KEY]: 'a', ...(row.local === null ? {} : { savedWords: row.local }), ...(row.base === null ? {} : { [languageSyncBaseKey('a')]: row.base }) });
    try {
      const { request } = await f.request();
      if (row.kind === 'blocked') { assert.throws(() => planLanguageSync(request, row.remote)); assert.equal(f.storage.getItem(languageSyncAckKey('a')), null); continue; }
      const plan = planLanguageSync(request, row.remote); assert.equal(plan.kind, row.kind);
      const result = await commitLanguageSyncResponse(request, row.remote!, { preserveLocal: plan.kind === 'bootstrap-base' });
      assert.equal(f.storage.getItem('savedWords'), row.kind === 'bootstrap-base' ? row.local : row.remote!.savedWords);
      assert.equal(result.pending, row.kind === 'bootstrap-base'); assert.deepEqual(readLanguageSyncBase(f.storage.getItem(languageSyncBaseKey('a'))), row.remote);
    } finally { f.restore(); }
  }
});
test('S01 snapshot contains exact records/base/ack; prepared before-image cannot dispatch or grant write authority', async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, lifecycle, request } = await f.request();
  await commitLanguageSyncResponse(request, { savedWords: 'before' }); const base = f.storage.getItem(languageSyncBaseKey('a'));
  f.storage.setItem('savedWords', 'partial'); f.storage.setItem(STORAGE_PROTOCOL_KEY, JSON.stringify({ version: 2, state: 'prepared', generation: 'g', transactionId: 't', before: { savedWords: 'before', [languageSyncBaseKey('a')]: base } }));
  assert.equal(projectLanguageBytes(readStorageSnapshot(f.storage)).savedWords, 'before');
  assert.throws(() => readLanguageSyncRequest(lease, lifecycle, f.storage));
});
test('S02/S05 participating ABA and queued writes stale the guarded dispatch without generation bump from guard itself', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request();
  const before = readStorageSnapshot(f.storage).generation; await assertLanguageSyncDispatchCurrent(request); assert.equal(readStorageSnapshot(f.storage).generation, before);
  await updateStorageBatch(f.storage, () => ({ savedWords: 'B' })); await updateStorageBatch(f.storage, () => ({ savedWords: null }));
  assert.deepEqual(projectLanguageBytes(readStorageSnapshot(f.storage)), request.local); await assert.rejects(assertLanguageSyncDispatchCurrent(request));
});
test('S03/A05 whitespace-only baseline replacement rejects old acknowledgement without repair', async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, lifecycle, request } = await f.request(); await commitLanguageSyncResponse(request, {});
  const next = readLanguageSyncRequest(lease, lifecycle, f.storage); f.storage.setItem(languageSyncBaseKey('a'), ' { } ');
  await assert.rejects(commitLanguageSyncResponse(next, { savedWords: 'late' })); assert.equal(f.storage.getItem(languageSyncBaseKey('a')), ' { } '); assert.equal(f.storage.getItem('savedWords'), null);
});
test('S04 exact local/remote missing-null-malformed marker states block rather than normalize', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request();
  assert.equal(parseLanguageMarker(null).kind, 'missing'); assert.equal(parseLanguageMarker('null').kind, 'invalid'); assert.equal(parseLanguageMarker(marker()).kind, 'valid');
  assert.equal(compareLanguageReset(request, {}), 'same');
  for (const value of [null, '', 'null', {}, [], 3, '2026-02-31T00:00:00Z|11111111-1111-4111-8111-111111111111']) assert.throws(() => planLanguageSync(request, { [LANGUAGE_MARKER_KEY]: value }));
  const get = f.storage.getItem; f.storage.getItem = () => { throw new Error('unavailable'); }; assert.throws(() => readStorageSnapshot(f.storage)); f.storage.getItem = get;
});
test('S07 unknown remote values survive local changes; opaque inner bad JSON never normalizes or includes metadata', async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, lifecycle, request } = await f.request();
  const unknown = { unknown_server: { extra: [null, { a: 1 }] } }; await commitLanguageSyncResponse(request, { ...unknown, savedWords: '{broken' });
  await updateStorageBatch(f.storage, () => ({ savedWords: '  { "opaque": true } ' }));
  const plan = planLanguageSync(readLanguageSyncRequest(lease, lifecycle, f.storage), { ...unknown, savedWords: '{broken' });
  assert.deepEqual(plan.wire.unknown_server, unknown.unknown_server); assert.equal(plan.wire.savedWords, '  { "opaque": true } ');
  assert.ok(Object.keys(plan.wire).every(key => !key.startsWith('language-cloud-sync') && key !== LANGUAGE_BINDING_KEY && key !== LANGUAGE_RESET_FENCE_KEY));
});
test('S08 only genuinely empty first creation can insert, vanished acknowledged row stays blocked', async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, lifecycle, request } = await f.request(); assert.equal(planLanguageSync(request, null).kind, 'insert');
  await commitLanguageSyncResponse(request, {}); assert.throws(() => planLanguageSync(readLanguageSyncRequest(lease, lifecycle, f.storage), null));
});
for (const [name, mutation] of [['replacement', 'newer raw bytes'], ['deletion', null]] as const) test(`A01/A02 ${name} during remote await survives exact key reconciliation`, async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, lifecycle, request } = await f.request(); await commitLanguageSyncResponse(request, { savedWords: 'old' });
  const sent = readLanguageSyncRequest(lease, lifecycle, f.storage); await updateStorageBatch(f.storage, () => ({ savedWords: mutation }));
  const result = await commitLanguageSyncResponse(sent, { savedWords: 'remote response' }); assert.equal(f.storage.getItem('savedWords'), mutation); assert.equal(result.pending, true);
  assert.deepEqual(readLanguageSyncBase(f.storage.getItem(languageSyncBaseKey('a'))), { savedWords: 'remote response' });
});
test('A03 unrelated newer exact byte strings and absence survive remote response', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request();
  await updateStorageBatch(f.storage, () => ({ japaneseAppSettings: ' { "z":1, "a":2 } ' }));
  const result = await commitLanguageSyncResponse(request, { savedWords: 'remote' }); assert.equal(result.local.japaneseAppSettings, ' { "z":1, "a":2 } '); assert.equal(result.local.savedWords, 'remote'); assert.equal(result.pending, true);
});
test('A04 same-content acknowledgement rotates identity and retires all competing responses', async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, lifecycle, request } = await f.request(); await commitLanguageSyncResponse(request, {});
  const a = readLanguageSyncRequest(lease, lifecycle, f.storage), b = readLanguageSyncRequest(lease, lifecycle, f.storage), old = a.acknowledgementRaw;
  await commitLanguageSyncResponse(a, {}); assert.notEqual(f.storage.getItem(languageSyncAckKey('a')), old); await assert.rejects(commitLanguageSyncResponse(b, { savedWords: 'late' })); assert.equal(f.storage.getItem('savedWords'), null);
});
for (const target of ['savedWords', languageSyncBaseKey('a'), languageSyncAckKey('a'), LANGUAGE_BINDING_KEY, STORAGE_PROTOCOL_KEY]) test(`A06 atomic response failure at ${target} rolls back exact evidence`, async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request(); const before = new Map(f.values), set = f.storage.setItem; let failed = false;
  f.storage.setItem = (key, value) => { if (key === target && !failed && (key !== STORAGE_PROTOCOL_KEY || value.includes('committed'))) { failed = true; throw new Error('synthetic quota'); } set(key, value); };
  await assert.rejects(commitLanguageSyncResponse(request, { savedWords: 'incoming' }));
  for (const key of ['savedWords', languageSyncBaseKey('a'), languageSyncAckKey('a'), LANGUAGE_BINDING_KEY]) assert.equal(f.storage.getItem(key), before.get(key) ?? null);
});
test('A06 failed rollback keeps durable before-image and no successful response', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request(); const set = f.storage.setItem;
  f.storage.setItem = (key, value) => { if (key === languageSyncAckKey('a') || (key === STORAGE_PROTOCOL_KEY && value.includes('committed'))) throw new Error('persistent quota'); set(key, value); };
  await assert.rejects(commitLanguageSyncResponse(request, { savedWords: 'incoming' })); assert.equal(readStorageSnapshot(f.storage).pending, true); assert.equal(projectLanguageBytes(readStorageSnapshot(f.storage)).savedWords, undefined);
});
test('A07 owner invalidation immediately after durable commit suppresses result while retaining the durable commit', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request(); const set = f.storage.setItem; let changed = false;
  f.storage.setItem = (key, value) => { set(key, value); if (key === STORAGE_PROTOCOL_KEY && value.includes('committed') && !changed) { changed = true; invalidateStorageOwner(f.storage, 'b'); } };
  await assert.rejects(commitLanguageSyncResponse(request, { savedWords: 'durable' })); assert.equal(changed, true);
  assert.equal(readStorageSnapshot(f.storage).getItem(languageSyncBaseKey('a')), '{"savedWords":"durable"}');
});
test('A08 local reset marker after dispatch rejects whole response without baseline movement', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request(); await updateStorageBatch(f.storage, () => ({ [LANGUAGE_MARKER_KEY]: marker() }));
  await assert.rejects(commitLanguageSyncResponse(request, {})); assert.equal(f.storage.getItem(languageSyncBaseKey('a')), null); assert.equal(f.storage.getItem(LANGUAGE_MARKER_KEY), marker());
});
test('post-commit participating edit is pending in the final result, never falsely server-saved', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request();
  let scheduled = false; const requestLock = f.locks.locks.request.bind(f.locks.locks);
  f.locks.locks.request = (name, options, callback) => requestLock(name, options, callback).then(async result => {
    if (!scheduled && f.storage.getItem(languageSyncAckKey('a'))) { scheduled = true; await updateStorageBatch(f.storage, () => ({ savedWords: 'after commit' })); }
    return result;
  });
  const result = await commitLanguageSyncResponse(request, {}); assert.equal(result.pending, true); assert.equal(result.local.savedWords, 'after commit');
});
test('R04 newer remote reset discards old records, preserves newer settings and gates ambiguous ordering', async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, lifecycle, request } = await f.request(); const accepted = await commitLanguageSyncResponse(request, {});
  await updateLanguageRecords(accepted.context, () => ({ savedWords: 'old generation', japaneseAppSettings: 'setting original' })); const sent = readLanguageSyncRequest(lease, lifecycle, f.storage);
  await updateLanguageRecords(accepted.context, () => ({ japaneseAppSettings: 'newer setting' }));
  const remote = { [LANGUAGE_MARKER_KEY]: marker(), japaneseAppSettings: 'remote setting' }; const result = await commitLanguageRemoteReset(sent, remote);
  assert.equal(f.storage.getItem('savedWords'), null); assert.equal(f.storage.getItem('japaneseAppSettings'), 'newer setting'); assert.equal(result.reset, true); assert.equal(isLanguageRecordContextCurrent(accepted.context), false);
  const next = readLanguageSyncRequest(lease, lifecycle, f.storage);
  for (const state of [{}, { [LANGUAGE_MARKER_KEY]: marker('2026-10-09T12:00:00.123999Z', '22222222-2222-4222-8222-222222222222') }, { [LANGUAGE_MARKER_KEY]: marker('2026-10-08T00:00:00Z') }]) assert.throws(() => compareLanguageReset(next, state));
});
test('future writer API rejects counterfeit contexts, metadata/reset writes, async transforms and stale React draft revision', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request(); const { context } = await commitLanguageSyncResponse(request, {});
  const revision = captureLanguageDraftRevision(context, ['savedWords']); await updateLanguageRecords(context, () => ({ savedWords: 'first' }));
  await assert.rejects(updateLanguageRecords(context, () => ({ savedWords: 'stale' }), { expectedDraft: revision }));
  for (const key of [LANGUAGE_MARKER_KEY, LANGUAGE_BINDING_KEY, languageSyncBaseKey('a')]) await assert.rejects(updateLanguageRecords(context, () => ({ [key]: 'bad' })));
  await assert.rejects(updateLanguageRecords({ ...context }, () => ({ savedWords: 'bad' })));
  await assert.rejects(updateLanguageRecords(context, (() => Promise.resolve({ savedWords: 'bad' })) as never)); assert.equal(f.storage.getItem('savedWords'), 'first');
});
test('N01 negative demonstration: raw ABA does not advance generation and remains outside dispatch guarantees', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request(), before = readStorageSnapshot(f.storage).generation;
  f.storage.setItem('savedWords', 'raw B'); f.storage.removeItem('savedWords'); assert.equal(readStorageSnapshot(f.storage).generation, before); await assertLanguageSyncDispatchCurrent(request);
});
test('N02 negative demonstration: reused timestamp permits competing remote content to be overwritten by current transport CAS', () => {
  let row = { updatedAt: 'same timestamp', state: { savedWords: 'A' } }; const expected = row.updatedAt;
  row = { updatedAt: expected, state: { savedWords: 'competing B' } };
  if (row.updatedAt === expected) row = { updatedAt: 'client next', state: { savedWords: 'C' } };
  assert.equal(row.state.savedWords, 'C', 'Post-write content readback cannot undo the overwritten B');
});
test('N03 serialized lease/request and A2 freshness cannot confer live language authority', async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, lifecycle, request } = await f.request();
  assert.throws(() => readLanguageSyncRequest({ ...lease, freshness: 'fresh' } as never, lifecycle, f.storage));
  assert.equal(isLanguageSyncRequestCurrent(JSON.parse(JSON.stringify(request))), false);
});
test('N04 no inactive A2/G5 namespace or language G3 RPC is activated by production adapter/coordinator', () => {
  const sources = ['languageStorageBoundary.ts', 'languageCloudSync.ts', 'languageSyncCoordinator.ts'].map(name => readFileSync(new URL(name, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /from\s+['"][^'"]*(?:language-legacy-evidence|conversation-review)/); assert.doesNotMatch(sources, /\.rpc\(/);
  assert.equal(LANGUAGE_STORAGE_KEYS.length, 16); assert.ok(!LANGUAGE_STORAGE_KEYS.some(key => /conversation/i.test(key)));
});

test('S06/A09 shipping coordinator keeps auth/GET/PATCH/readback outside lock and own ack event cannot loop', async t => {
  const f = languageFixture(); t.after(f.restore); const lease = await f.owner(); let remote: Record<string, unknown> = { savedWords: 'one', unknown: { preserved: true } }, reads = 0, writes = 0;
  const states: string[] = [], coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState: state => states.push(state.status), transport: {
    async verifyOwner() { assert.equal(f.locks.active, 0); return true; }, async read() { assert.equal(f.locks.active, 0); reads++; return { state: remote, updatedAt: 't' }; },
    async insert() { throw new Error('unexpected insert'); }, async update(_owner, state) { assert.equal(f.locks.active, 0); writes++; remote = state; return true; },
  } }); t.after(coordinator.dispose); f.window.addEventListener(RECORDS_CHANGED_EVENT, () => coordinator.notifyStorage('records'));
  await coordinator.start(); await settle(); assert.equal(coordinator.getState().status, 'ready');
  await updateStorageBatch(f.storage, () => ({ savedWords: 'two' })); await coordinator.refresh(); await settle(); assert.equal(writes, 1); assert.equal(reads, 3); assert.deepEqual(remote.unknown, { preserved: true });
  coordinator.notifyStorage(STORAGE_PROTOCOL_KEY); assert.equal(coordinator.getState().status, 'ready'); assert.equal(states.at(-1), 'ready');
});
test('R03 dispatch then lifecycle pause reports uncertainty; delayed response cannot ack or publish', async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, request } = await f.request(); await commitLanguageSyncResponse(request, {}); await updateStorageBatch(f.storage, () => ({ savedWords: 'local' }));
  const pending = deferred<boolean>(); let writes = 0;
  const coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState() {}, transport: { async verifyOwner() { return true; }, async read() { return { state: {}, updatedAt: 'old' }; }, async insert() { return true; }, async update() { writes++; return pending.promise; } } }); t.after(coordinator.dispose);
  const operation = coordinator.start(); await settle(); assert.equal(writes, 1); coordinator.pause(); assert.equal(coordinator.getState().status, 'uncertain');
  pending.resolve(true); await operation; assert.equal(f.storage.getItem(languageSyncBaseKey('a')), '{}'); assert.equal(coordinator.getState().status, 'uncertain'); assert.equal(f.storage.getItem('savedWords'), 'local');
});
test('R11/R12 deferred old auth cannot overwrite resumed operation; cold error never initializes', async t => {
  const f = languageFixture(); t.after(f.restore); const lease = await f.owner(), first = deferred<boolean>(); let verifies = 0;
  const coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState() {}, transport: { verifyOwner() { verifies++; return verifies === 1 ? first.promise : Promise.resolve(true); }, async read() { return { state: {}, updatedAt: 't' }; }, async insert() { return true; }, async update() { return true; } } }); t.after(coordinator.dispose);
  const old = coordinator.start(); coordinator.pause(); await coordinator.resume(); assert.equal(coordinator.getState().status, 'ready'); first.resolve(false); await old; assert.equal(coordinator.getState().status, 'ready');
  const failure = createLanguageSyncCoordinator({ lease, storage: f.storage, onState() {}, transport: { async verifyOwner() { throw new Error('offline'); }, async read() { return null; }, async insert() { return true; }, async update() { return true; } } }); t.after(failure.dispose);
  await failure.start(); assert.equal(failure.getState().initialized, false); assert.equal(failure.getState().status, 'error');
});

for (const key of LANGUAGE_STORAGE_KEYS.filter(key => key !== LANGUAGE_MARKER_KEY)) for (const direction of ['set', 'remove'] as const) test(`A06 exact rollback for ${direction} ${key}`, async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, lifecycle, request } = await f.request();
  await commitLanguageSyncResponse(request, { [key]: 'before' }); const current = readLanguageSyncRequest(lease, lifecycle, f.storage), before = new Map(f.values);
  const method = direction === 'set' ? f.storage.setItem : f.storage.removeItem; let failed = false;
  if (direction === 'set') f.storage.setItem = (target, value) => { if (target === key && !failed) { failed = true; throw new Error('key quota'); } (method as (key: string, value: string) => void)(target, value); };
  else f.storage.removeItem = target => { if (target === key && !failed) { failed = true; throw new Error('key quota'); } (method as (key: string) => void)(target); };
  await assert.rejects(commitLanguageSyncResponse(current, direction === 'set' ? { [key]: 'after' } : {}), /key quota/);
  for (const target of [...LANGUAGE_STORAGE_KEYS, languageSyncBaseKey('a'), languageSyncAckKey('a'), LANGUAGE_BINDING_KEY]) assert.equal(f.storage.getItem(target), before.get(target) ?? null);
});
test('S05/R03 lifecycle invalidation after short dispatch guard suppresses the exact HTTP send', async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, request } = await f.request(); await commitLanguageSyncResponse(request, {}); await updateStorageBatch(f.storage, () => ({ savedWords: 'pending' }));
  let sends = 0, invalidated = false;
  const coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState() {}, transport: { async verifyOwner() { return true; }, async read() { return { state: {}, updatedAt: 'old' }; }, async insert() { sends++; return true; }, async update() { sends++; return true; } } }); t.after(coordinator.dispose);
  const lock = f.locks.locks.request.bind(f.locks.locks);
  f.locks.locks.request = (name, options, callback) => lock(name, options, callback).then(result => { if (!invalidated) { invalidated = true; coordinator.pause(); } return result; });
  await coordinator.start(); assert.equal(invalidated, true); assert.equal(sends, 0); assert.equal(f.storage.getItem(languageSyncBaseKey('a')), '{}');
});
test('A09 independent remote refresh during GET survives own acknowledgement retirement', async t => {
  const f = languageFixture(); t.after(f.restore); const lease = await f.owner(), pending = deferred<{ state: Record<string, unknown>; updatedAt: string }>(); let reads = 0;
  const coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState() {}, transport: { async verifyOwner() { return true; }, read() { reads++; return reads === 1 ? pending.promise : Promise.resolve({ state: {}, updatedAt: 't' }); }, async insert() { return true; }, async update() { return true; } } }); t.after(coordinator.dispose);
  f.window.addEventListener(RECORDS_CHANGED_EVENT, () => coordinator.notifyStorage('records'));
  const first = coordinator.start(); await settle(); const requested = coordinator.refresh(); pending.resolve({ state: {}, updatedAt: 't' }); await first; await requested;
  await new Promise(resolve => setTimeout(resolve, 320)); assert.equal(reads, 2); await new Promise(resolve => setTimeout(resolve, 280)); assert.equal(reads, 2);
});
test('final coordinator publication reflects an edit queued by its own committed event', async t => {
  const f = languageFixture(); t.after(f.restore); const lease = await f.owner(); let queued = false;
  const coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState() {}, transport: { async verifyOwner() { return true; }, async read() { return { state: {}, updatedAt: 't' }; }, async insert() { return true; }, async update() { return true; } } }); t.after(coordinator.dispose);
  f.window.addEventListener(RECORDS_CHANGED_EVENT, () => { if (!queued && f.storage.getItem(languageSyncAckKey('a'))) { queued = true; void updateStorageBatch(f.storage, () => ({ savedWords: 'new after commit' })); } });
  await coordinator.start(); assert.equal(f.storage.getItem('savedWords'), 'new after commit'); assert.equal(coordinator.getState().status, 'pending');
});
