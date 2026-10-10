import assert from 'node:assert/strict';
import test from 'node:test';
import { clearLocalCloudState, prepareLocalCloudState } from './cloudSync.ts';
import { commitLanguageSyncResponse, readLanguageSyncRequest } from './languageCloudSync.ts';
import { LANGUAGE_BINDING_KEY, LANGUAGE_MARKER_KEY, LANGUAGE_OWNER_KEY, LANGUAGE_RESET_FENCE_KEY, languageMetadataReadyForEpoch, languageSyncAckKey, languageSyncBaseKey,
  parseLanguageBinding, planLanguageOwnerTransition, projectLanguageBytes, readGuardedLanguageProjection, readLanguageSyncBase } from './languageStorageBoundary.ts';
import { captureStorageOwner, isStorageOwnerCurrent, readStorageSnapshot, STORAGE_JOURNAL_KEY, STORAGE_PROTOCOL_KEY, STORAGE_READY_KEY, STORAGE_SESSION_KEY, StorageCorruptionError, updateStorageBatch } from './storageTransaction.ts';
import { languageFixture, marker } from '../../tests/helpers/languageFixture.ts';
import { preparedStorageSeed } from '../../tests/helpers/storageProtocol.ts';

test('O01/O03 both shared preparation orders initialize language exactly once and missing binding defeats fast path', async t => {
  const f = languageFixture(); t.after(f.restore);
  const first = prepareLocalCloudState('a'); assert.equal(prepareLocalCloudState('a'), first); await first;
  const owner = captureStorageOwner(f.storage), original = f.storage.getItem(LANGUAGE_BINDING_KEY), calls = f.locks.calls.length;
  await f.owner(); assert.equal(f.storage.getItem(LANGUAGE_BINDING_KEY), original); assert.equal(f.locks.calls.length, calls);
  f.storage.removeItem(LANGUAGE_BINDING_KEY); await prepareLocalCloudState('a');
  assert.equal(languageMetadataReadyForEpoch(readStorageSnapshot(f.storage), owner), true);
  assert.equal(f.storage.getItem(STORAGE_SESSION_KEY), owner.epoch);
});
test('O02 queued A→B→A holds pending bytes and cannot restore the old epoch', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request();
  await commitLanguageSyncResponse(request, {}); await updateStorageBatch(f.storage, () => ({ savedWords: 'pending' }));
  const oldEpoch = captureStorageOwner(f.storage).epoch;
  const b = prepareLocalCloudState('b'), a = prepareLocalCloudState('a'); await Promise.allSettled([b, a]);
  await prepareLocalCloudState('a'); assert.notEqual(captureStorageOwner(f.storage).epoch, oldEpoch);
  assert.equal(f.storage.getItem('savedWords'), 'pending'); await assert.rejects(commitLanguageSyncResponse(request, {}));
  assert.equal(readGuardedLanguageProjection(f.storage).status, 'ready');
});
for (const [label, seed] of Object.entries({
  missing: { savedWords: '{ inner malformed bytes ' },
  contradictory: { ...preparedStorageSeed('a'), [LANGUAGE_OWNER_KEY]: 'b', savedWords: 'source' },
  corrupt: { [LANGUAGE_BINDING_KEY]: '{broken', savedWords: 'source' },
  otherBase: { [languageSyncBaseKey('b')]: '{}', savedWords: 'source' },
})) test(`O06/O07 ${label} evidence remains exact and blocked across owner ABA`, async t => {
  const f = languageFixture(seed); t.after(f.restore); await prepareLocalCloudState('a');
  const baseline = Object.fromEntries(Object.keys(seed).filter(key => !key.startsWith('fitness-cloud-sync-')).map(key => [key, f.storage.getItem(key)]));
  assert.equal(readGuardedLanguageProjection(f.storage).status, 'unavailable');
  await clearLocalCloudState(); await prepareLocalCloudState('b'); await prepareLocalCloudState('a');
  for (const [key, raw] of Object.entries(baseline)) assert.equal(f.storage.getItem(key), raw);
  assert.equal(readGuardedLanguageProjection(f.storage).status, 'unavailable');
  const generation = readStorageSnapshot(f.storage).generation; await prepareLocalCloudState('a'); assert.equal(readStorageSnapshot(f.storage).generation, generation);
});
test('O08 matched verified cache clears narrowly; unknown and pending owner data are held until that owner returns', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request();
  await commitLanguageSyncResponse(request, { savedWords: 'verified' }); f.storage.setItem(languageSyncBaseKey('unrelated-owner'), '{kept');
  await clearLocalCloudState(); assert.equal(f.storage.getItem('savedWords'), null); assert.equal(f.storage.getItem(languageSyncBaseKey('a')), null);
  assert.equal(f.storage.getItem(languageSyncBaseKey('unrelated-owner')), '{kept');
  // Fresh known A data with no acknowledgement is not an expendable cache.
  f.storage.removeItem(languageSyncBaseKey('unrelated-owner')); await prepareLocalCloudState('a'); await updateStorageBatch(f.storage, () => ({ savedWords: 'draft' }));
  await prepareLocalCloudState('b'); assert.equal(f.storage.getItem('savedWords'), 'draft'); assert.equal(readGuardedLanguageProjection(f.storage).status, 'unavailable');
  assert.equal(parseLanguageBinding(f.storage.getItem(LANGUAGE_BINDING_KEY))?.status, 'held');
  await prepareLocalCloudState('a'); assert.equal(readGuardedLanguageProjection(f.storage).status, 'ready');
});
test('O08 contradictory completed reset receipt cannot qualify an acknowledged cache for deletion', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request();
  await commitLanguageSyncResponse(request, {}); f.storage.setItem(LANGUAGE_RESET_FENCE_KEY, JSON.stringify({ version: 1, owner: 'a', requestId: '11111111-1111-4111-8111-111111111111', expectedMarker: null, state: 'completed', marker: marker() }));
  const before = f.storage.getItem(languageSyncBaseKey('a')); await clearLocalCloudState(); assert.equal(f.storage.getItem(languageSyncBaseKey('a')), before); assert.notEqual(f.storage.getItem(LANGUAGE_RESET_FENCE_KEY), null);
});
test('O09 owner cleanup failure restores records/base/ack/binding and leaves irreversible epoch fenced', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request(); await commitLanguageSyncResponse(request, { savedWords: 'cloud' });
  const originals = Object.fromEntries(['savedWords', languageSyncBaseKey('a'), languageSyncAckKey('a'), LANGUAGE_BINDING_KEY].map(key => [key, f.storage.getItem(key)]));
  const owner = captureStorageOwner(f.storage), remove = f.storage.removeItem; let failed = false;
  f.storage.removeItem = key => { if (key === languageSyncBaseKey('a') && !failed) { failed = true; throw new Error('synthetic quota'); } remove(key); };
  await assert.rejects(clearLocalCloudState(), /synthetic quota/);
  for (const [key, raw] of Object.entries(originals)) assert.equal(f.storage.getItem(key), raw);
  assert.notEqual(f.storage.getItem(STORAGE_SESSION_KEY), owner.epoch); assert.equal(isStorageOwnerCurrent(f.storage, owner), false);
});
test('O11 missing locks, v1 journal, corrupt protocol and malformed shared readiness fail globally', async t => {
  for (const seed of [{ [STORAGE_JOURNAL_KEY]: '{}' }, { [STORAGE_PROTOCOL_KEY]: '{bad' }, { [STORAGE_READY_KEY]: '12' }, { [STORAGE_READY_KEY]: '{bad' }]) {
    const f = languageFixture({ ...seed, savedWords: 'unchanged' });
    try { await assert.rejects(prepareLocalCloudState('a')); assert.equal(f.storage.getItem('savedWords'), 'unchanged'); assert.equal(f.storage.getItem(LANGUAGE_BINDING_KEY), null); } finally { f.restore(); }
  }
  const f = languageFixture({ savedWords: 'unchanged' }); t.after(f.restore); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  await assert.rejects(prepareLocalCloudState('a'), /Web Locks/); assert.equal(f.storage.getItem('savedWords'), 'unchanged');
});
test('O06 valid prior shared preparation is required for stamped legacy attribution', async t => {
  const f = languageFixture({ [LANGUAGE_OWNER_KEY]: 'a', 'fitness-cloud-sync-user': 'a', savedWords: 'legacy' }); t.after(f.restore);
  await prepareLocalCloudState('a'); assert.equal(readGuardedLanguageProjection(f.storage).status, 'unavailable'); assert.equal(f.storage.getItem('savedWords'), 'legacy');
});
test('S03 strict pure baseline parser retains absent versus invalid original bytes', () => {
  assert.equal(readLanguageSyncBase(null), null); assert.deepEqual(readLanguageSyncBase(' { "savedWords": "{broken" } '), { savedWords: '{broken' });
  for (const raw of ['null', '[]', '1', 'true', '"string"', '{bad', '{"savedWords":null}', '{"savedWords":{}}']) assert.throws(() => readLanguageSyncBase(raw));
});
test('owner transition classifies using previous ready epoch while desired session already changed', async t => {
  const f = languageFixture(); t.after(f.restore); await prepareLocalCloudState('a'); const current = readStorageSnapshot(f.storage);
  const next = { userId: 'b', epoch: JSON.stringify({ version: 2, id: crypto.randomUUID(), userId: 'b' }) };
  const snapshot = { ...current, getItem: (key: string) => key === STORAGE_SESSION_KEY ? next.epoch : current.getItem(key) };
  assert.equal(planLanguageOwnerTransition(snapshot, next).classification, 'held');
  assert.deepEqual(projectLanguageBytes(current), {});
  assert.throws(() => planLanguageOwnerTransition({ ...snapshot, getItem: key => key === STORAGE_READY_KEY ? '[]' : snapshot.getItem(key) }, next), StorageCorruptionError);
  assert.equal(f.storage.getItem(LANGUAGE_MARKER_KEY), null);
});

test('O03 corrupt reset fence becomes one durable blocked preparation without overwriting original control', async t => {
  const f = languageFixture({ [LANGUAGE_RESET_FENCE_KEY]: '{broken' }); t.after(f.restore);
  await prepareLocalCloudState('a'); const first = readStorageSnapshot(f.storage).generation, calls = f.locks.calls.length;
  assert.equal(readGuardedLanguageProjection(f.storage).status, 'unavailable'); await prepareLocalCloudState('a');
  assert.equal(f.storage.getItem(LANGUAGE_RESET_FENCE_KEY), '{broken'); assert.equal(f.locks.calls.length, calls); assert.equal(readStorageSnapshot(f.storage).generation, first);
});
