import assert from 'node:assert/strict';
import test from 'node:test';
import { languageFixture } from '../../tests/helpers/languageFixture.ts';
import { assertLanguageRecordSource, commitLanguageSyncResponse, isLanguageRecordContextCurrent, readLanguageRecordSnapshot, readLanguageSyncRequest, rebaseLanguageDraftRevision, updateLanguageRecords } from './languageCloudSync.ts';
import { assertLanguageMutationUncommitted, createLanguageMutation, getLanguageMutationOutcome, reconcileLanguageMutation, requireLanguageMutationAcknowledged, runLanguageMutation } from './languageRecordMutations.ts';
import { invalidateStorageOwner, STORAGE_PROTOCOL_KEY, updateStorageBatch } from './storageTransaction.ts';

async function fixture() { const f = languageFixture(); const request = await f.request(); const context = (await commitLanguageSyncResponse(request.request, { savedWords: '[]' })).context; return { ...f, ...request, context }; }
test('snapshot bytes and revision are coherent; copied snapshot/context/revision cannot grant authority', async t => {
  const f = await fixture(); t.after(f.restore); const old = readLanguageRecordSnapshot(f.context, ['savedWords']);
  await updateLanguageRecords(f.context, () => ({ savedWords: '[1]' }));
  assert.equal(old.records.savedWords, '[]');
  await assert.rejects(updateLanguageRecords(f.context, () => ({ savedWords: '[2]' }), { expectedDraft: old.revision }));
  assert.throws(() => assertLanguageRecordSource({ ...old }, f.context));
  assert.throws(() => readLanguageRecordSnapshot({ ...f.context }));
  await assert.rejects(updateLanguageRecords(f.context, () => ({ savedWords: '[2]' }), { expectedDraft: { ...old.revision } }));
});
test('same-origin exact-source rebase after unrelated write or acknowledgement; source changes and owner ABA reject', async t => {
  const f = await fixture(); t.after(f.restore); const source = readLanguageRecordSnapshot(f.context, ['savedWords']);
  await updateLanguageRecords(f.context, () => ({ savedSentences: '[]' }));
  assert.ok(rebaseLanguageDraftRevision(source.revision, f.context));
  const rotated = (await commitLanguageSyncResponse(readLanguageSyncRequest(f.lease, f.lifecycle, f.storage), { savedWords: '[]', savedSentences: '[]' })).context;
  assert.equal(isLanguageRecordContextCurrent(f.context), false); assert.ok(rebaseLanguageDraftRevision(source.revision, rotated));
  await updateLanguageRecords(rotated, () => ({ savedWords: '[1]' })); assert.throws(() => rebaseLanguageDraftRevision(source.revision, rotated));
  invalidateStorageOwner(f.storage, 'b'); assert.throws(() => assertLanguageRecordSource(source, rotated));
});
test('immutable operation captures date/payload once, duplicate dispatch shares one transform, stale cached success rejects', async t => {
  const f = await fixture(); t.after(f.restore); const input = { nested: { n: 1 } }; const source = readLanguageRecordSnapshot(f.context);
  const intent = createLanguageMutation(f.context, source, input, { date: '2026-10-09', timestamp: '2026-10-09T23:59:59.000Z' }); input.nested.n = 2;
  let calls = 0; const plan = () => { calls++; return { changes: { savedWords: '[1]' }, result: 'done' }; };
  const [a, b] = await Promise.all([runLanguageMutation(intent, plan), runLanguageMutation(intent, plan)]); assert.equal(calls, 1); assert.equal(a, b); assert.equal(intent.payload.nested.n, 1);
  f.lifecycle.revoke(); await assert.rejects(runLanguageMutation(intent, plan)); assert.equal(calls, 1);
});
test('post-durable owner invalidation returns exact committed bytes with no UI acknowledgement', async t => {
  const f = await fixture(); t.after(f.restore); const intent = createLanguageMutation(f.context, readLanguageRecordSnapshot(f.context), {});
  const set = f.storage.setItem; let changed = false;
  f.storage.setItem = (key, value) => { set(key, value); if (key === STORAGE_PROTOCOL_KEY && value.includes('committed') && !changed) { changed = true; invalidateStorageOwner(f.storage, 'b'); } };
  const result = await runLanguageMutation(intent, () => ({ changes: { savedWords: '[1]' }, result: 7 }));
  assert.equal(result.acknowledged, false); assert.equal(result.committedRecords[STORAGE_PROTOCOL_KEY as never], undefined); assert.equal(result.committedRecords.savedWords, '[1]'); assert.equal(result.result, 7); assert.equal(result.source, null);
  assert.throws(() => requireLanguageMutationAcknowledged(result));
});
test('read-only reconciliation after ack rotation proves current exact afterimage and never redispatches', async t => {
  const f = await fixture(); t.after(f.restore); const intent = createLanguageMutation(f.context, readLanguageRecordSnapshot(f.context), { n: 1 }); let calls = 0;
  await runLanguageMutation(intent, () => { calls++; return { changes: { savedWords: '[1]' }, result: 9 }; });
  const rotated = (await commitLanguageSyncResponse(readLanguageSyncRequest(f.lease, f.lifecycle, f.storage), { savedWords: '[1]' })).context;
  const result = reconcileLanguageMutation<typeof intent.payload, number>(intent, rotated); assert.equal(result.result, 9); assert.equal(result.acknowledged, true); assert.equal(calls, 1);
  await updateLanguageRecords(rotated, () => ({ savedWords: '[2]' })); assert.throws(() => reconcileLanguageMutation(intent, rotated));
});
for (const target of ['savedWords', 'savedSentences', 'prepared', 'committed']) test(`multi-key action failure at ${target} preserves both original records and permits same intent retry`, async t => {
  const f = await fixture(); t.after(f.restore); const intent = createLanguageMutation(f.context, readLanguageRecordSnapshot(f.context), {}); const set = f.storage.setItem; let failed = false;
  f.storage.setItem = (key, value) => { if (!failed && (key === target || (key === STORAGE_PROTOCOL_KEY && value.includes(`"state":"${target}"`)))) { failed = true; throw new Error('synthetic quota'); } set(key, value); };
  const planner = () => ({ changes: { savedWords: '[1]', savedSentences: '[2]' }, result: true });
  await assert.rejects(runLanguageMutation(intent, planner)); assert.equal(f.storage.getItem('savedWords'), '[]'); assert.equal(f.storage.getItem('savedSentences'), null);
  const result = await runLanguageMutation(intent, planner); assert.equal(result.acknowledged, true); assert.equal(f.storage.getItem('savedSentences'), '[2]');
});
test('strict non-idempotent source rejects participating ABA, and async transforms never write', async t => {
  const f = await fixture(); t.after(f.restore); const source = readLanguageRecordSnapshot(f.context); const intent = createLanguageMutation(f.context, source, {});
  await updateStorageBatch(f.storage, () => ({ savedWords: '[1]' })); await updateStorageBatch(f.storage, () => ({ savedWords: '[]' }));
  await assert.rejects(runLanguageMutation(intent, () => ({ changes: { savedWords: '[2]' }, result: true }), { expectedDraft: source.revision }));
  await assert.rejects(runLanguageMutation(intent, (() => Promise.resolve({ changes: { savedWords: '[2]' }, result: true })) as never)); assert.equal(f.storage.getItem('savedWords'), '[]');
});

test('storage unreadable only after durable marker still returns a committed, unacknowledged receipt', async t => {
  const f = await fixture(); t.after(f.restore); const intent = createLanguageMutation(f.context, readLanguageRecordSnapshot(f.context), {});
  const set = f.storage.setItem, get = f.storage.getItem; let unreadable = false;
  f.storage.setItem = (key, value) => { set(key, value); if (key === STORAGE_PROTOCOL_KEY && value.includes('committed')) unreadable = true; };
  f.storage.getItem = key => { if (unreadable) throw new Error('postcommit read refused'); return get(key); };
  const result = await runLanguageMutation(intent, () => ({ changes: { savedWords: '[3]' }, result: 3 }));
  assert.equal(result.committedRecords.savedWords, '[3]'); assert.equal(result.acknowledged, false); assert.equal(f.values.get('savedWords'), '[3]');
});
test('postcommit notification failure is distinguished from rollback and reconciles without redispatch', async t => {
  const f = await fixture(); t.after(f.restore); const intent = createLanguageMutation(f.context, readLanguageRecordSnapshot(f.context), {});
  const queue = globalThis.queueMicrotask; globalThis.queueMicrotask = () => { throw new Error('synthetic notification refused'); };
  let result;
  try { result = await runLanguageMutation(intent, () => ({ changes: { savedWords: '[4]' }, result: 4 })); }
  finally { globalThis.queueMicrotask = queue; }
  assert.equal(result.acknowledged, false); assert.equal(result.committedRecords.savedWords, '[4]');
  assert.equal(reconcileLanguageMutation(intent, f.context).acknowledged, true);
});

test('only runtime-proven no-commit permits a new explicit user save after lifecycle retirement', async t => {
  const f = await fixture(); t.after(f.restore); const source = readLanguageRecordSnapshot(f.context), intent = createLanguageMutation(f.context, source, {});
  assert.equal(getLanguageMutationOutcome(intent), 'created'); assert.doesNotThrow(() => assertLanguageMutationUncommitted(intent));
  f.lifecycle.revoke(); await assert.rejects(runLanguageMutation(intent, () => ({changes:{savedWords:'[5]'},result:5})));
  assert.equal(getLanguageMutationOutcome(intent), 'not-committed'); assert.doesNotThrow(() => assertLanguageMutationUncommitted(intent)); assert.equal(f.storage.getItem('savedWords'),'[]');
});
test('confirmed rollback proves no-commit, failed rollback remains unknown even after later recovery', async t => {
  const f = await fixture(); t.after(f.restore); const intent = createLanguageMutation(f.context, readLanguageRecordSnapshot(f.context), {});
  const set = f.storage.setItem; let fail = true;
  f.storage.setItem = (key,value) => { if (fail && key === 'savedWords') throw new Error('persistent write refused'); set(key,value); };
  await assert.rejects(runLanguageMutation(intent, () => ({changes:{savedWords:'[6]'},result:6})));
  assert.equal(getLanguageMutationOutcome(intent),'unknown'); assert.throws(() => assertLanguageMutationUncommitted(intent));
  fail = false; await updateStorageBatch(f.storage, () => ({})); assert.equal(f.storage.getItem('savedWords'),'[]');
  assert.equal(getLanguageMutationOutcome(intent),'unknown', 'Later bytes alone never manufacture retrospective no-commit proof');
  const second = createLanguageMutation(f.context, readLanguageRecordSnapshot(f.context), {}); let once = true;
  f.storage.setItem = (key,value) => { if (once && key === 'savedWords') { once = false; throw new Error('one write refused'); } set(key,value); };
  await assert.rejects(runLanguageMutation(second, () => ({changes:{savedWords:'[7]'},result:7})));
  assert.equal(getLanguageMutationOutcome(second),'not-committed'); assert.doesNotThrow(() => assertLanguageMutationUncommitted(second));
});
test('a host setter that writes the durable marker then throws must remain unknown, never no-commit', async t => {
  const f = await fixture(); t.after(f.restore); const intent = createLanguageMutation(f.context, readLanguageRecordSnapshot(f.context), {});
  const set = f.storage.setItem; let once = true;
  f.storage.setItem = (key,value) => { set(key,value); if (once && key === STORAGE_PROTOCOL_KEY && value.includes('committed')) { once = false; throw new Error('post-marker host failure'); } };
  await assert.rejects(runLanguageMutation(intent, () => ({changes:{savedWords:'[8]'},result:8})));
  assert.equal(f.storage.getItem('savedWords'),'[8]'); assert.equal(getLanguageMutationOutcome(intent),'unknown'); assert.throws(() => assertLanguageMutationUncommitted(intent));
});
test('durable success and copied envelopes cannot be relabeled uncommitted', async t => {
  const f = await fixture(); t.after(f.restore); const intent = createLanguageMutation(f.context, readLanguageRecordSnapshot(f.context), {});
  await runLanguageMutation(intent, () => ({changes:{savedWords:'[9]'},result:9}));
  assert.equal(getLanguageMutationOutcome(intent),'committed'); assert.throws(() => assertLanguageMutationUncommitted(intent));
  assert.equal(getLanguageMutationOutcome({...intent}),'unknown'); assert.throws(() => assertLanguageMutationUncommitted({...intent}));
});

test('no-op reconciliation proves exact absence as well as present values', async t => {
  const f = await fixture(); t.after(f.restore); const intent = createLanguageMutation(f.context, readLanguageRecordSnapshot(f.context), {});
  await runLanguageMutation(intent, () => ({ changes: {}, result: 'default preference already effective' }));
  assert.equal(reconcileLanguageMutation(intent,f.context).acknowledged,true);
  await updateLanguageRecords(f.context, () => ({ japaneseAppSettings: '{"sections":{"words":{"ttsRate":0.5}}}' }));
  assert.throws(() => reconcileLanguageMutation(intent,f.context));
});
