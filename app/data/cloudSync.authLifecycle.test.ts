import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearLocalCloudState, isCurrentCloudSession, mergeCloudState, mergeCloudStateFromBase,
  prepareLocalCloudState, readCloudSyncEpoch, readLocalCloudState, readSyncBase, saveSyncBase,
} from './cloudSync.ts';

const original = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [
  `ai-fitness-fixture-${index}`, { value: index },
]));

function device(seed = original) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  let rejectRemoval: string | undefined;
  const storage = {
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, String(value)); },
    removeItem(key: string) {
      if (key === rejectRemoval) { rejectRemoval = undefined; throw new Error('fixture storage failure'); }
      values.delete(key);
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { localStorage: storage }) });
  return {
    storage, failRemoval: (key: string) => { rejectRemoval = key; },
    restore: () => {
      if (previous) Object.defineProperty(globalThis, 'window', previous);
      else Reflect.deleteProperty(globalThis, 'window');
    },
  };
}

test('logout removes records and every baseline together; login preserves all 17 remote keys', () => {
  const local = device();
  try {
    prepareLocalCloudState('a'); saveSyncBase('a', original); saveSyncBase('b', original);
    local.storage.setItem('unrelated-preference', 'keep');
    const epoch = readCloudSyncEpoch();
    clearLocalCloudState();
    assert.equal(isCurrentCloudSession('a', epoch), false);
    assert.deepEqual(readLocalCloudState(), {});
    assert.equal(readSyncBase('a'), null); assert.equal(readSyncBase('b'), null);
    assert.equal(local.storage.getItem('unrelated-preference'), 'keep');
    prepareLocalCloudState('a');
    assert.deepEqual(mergeCloudState(original, readLocalCloudState()), original);
  } finally { local.restore(); }
});

test('an already logged-out legacy cache cannot delete the remote state on upgrade', () => {
  const local = device({});
  try {
    saveSyncBase('a', original); // Previous version's logout left this behind.
    prepareLocalCloudState('a');
    const base = readSyncBase('a');
    const merged = base ? mergeCloudStateFromBase(base, original, readLocalCloudState()) : mergeCloudState(original, readLocalCloudState());
    assert.deepEqual(merged, original);
  } finally { local.restore(); }
});

test('an owned cache keeps intentional deletion of its last key across reload', () => {
  const local = device({ 'ai-fitness-fixture-0': { value: 0 } });
  try {
    prepareLocalCloudState('a'); const before = readLocalCloudState(); saveSyncBase('a', before);
    local.storage.removeItem('ai-fitness-fixture-0');
    prepareLocalCloudState('a');
    assert.deepEqual(mergeCloudStateFromBase(readSyncBase('a')!, before, readLocalCloudState()), {});
  } finally { local.restore(); }
});

test('switching accounts invalidates the previous scope and does not import its records', () => {
  const local = device();
  try {
    prepareLocalCloudState('a'); saveSyncBase('a', original); const epoch = readCloudSyncEpoch();
    prepareLocalCloudState('b');
    assert.equal(isCurrentCloudSession('a', epoch), false);
    assert.deepEqual(readLocalCloudState(), {}); assert.equal(readSyncBase('a'), null);
    assert.equal(isCurrentCloudSession('b', readCloudSyncEpoch()), true);
  } finally { local.restore(); }
});

test('logout recovers an interrupted write before cleanup so its journal cannot resurrect records', () => {
  const local = device();
  try {
    saveSyncBase('a', original);
    local.storage.setItem('yeoni-storage-transaction-v1', JSON.stringify({ 'ai-fitness-fixture-0': JSON.stringify({ value: 99 }) }));
    clearLocalCloudState();
    assert.deepEqual(readLocalCloudState(), {}); assert.equal(readSyncBase('a'), null);
    assert.equal(local.storage.getItem('yeoni-storage-transaction-v1'), null);
  } finally { local.restore(); }
});

test('failed cleanup restores records with their baseline but invalidates pending requests', () => {
  const local = device();
  try {
    prepareLocalCloudState('a'); saveSyncBase('a', original); const epoch = readCloudSyncEpoch();
    local.failRemoval('ai-fitness-fixture-8');
    assert.throws(() => clearLocalCloudState(), /fixture storage failure/);
    assert.deepEqual(readLocalCloudState(), original); assert.deepEqual(readSyncBase('a'), original);
    assert.equal(isCurrentCloudSession('a', epoch), false);
  } finally { local.restore(); }
});
