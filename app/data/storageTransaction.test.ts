import test from 'node:test';
import assert from 'node:assert/strict';
import { readStorageSnapshot, recoverStorageTransaction, STORAGE_GENERATION_KEY, STORAGE_JOURNAL_KEY, StorageSnapshotBusyError, writeStorageBatch } from './storageTransaction.ts';

function storage(values: Record<string,string>, reject?: (key:string,value:string) => boolean) {
  const data = new Map(Object.entries(values));
  return { data, get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key:string) => data.get(key) ?? null, removeItem: (key:string) => { data.delete(key); },
    setItem: (key:string,value:string) => { if (reject?.(key,value)) throw new Error('quota'); data.set(key,value); } };
}
const records = (local: ReturnType<typeof storage>) => Object.fromEntries([...local.data].filter(([key]) => key !== STORAGE_GENERATION_KEY));
test('a later local save failure preserves the entire previous snapshot', () => {
  const local=storage({a:'old-a',b:'old-b'},(key,value)=>key==='b'&&value==='new-b');
  assert.throws(()=>writeStorageBatch(local,{a:'new-a',b:'new-b',c:'new-c'}));
  assert.deepEqual(records(local),{a:'old-a',b:'old-b'});
  assert.ok(local.getItem(STORAGE_GENERATION_KEY), 'Rollback advances the persistent reader generation');
});
test('a full device that cannot reserve a journal does not change any record', () => {
  const local=storage({a:'old'},()=>true);
  assert.throws(()=>writeStorageBatch(local,{a:'new'}));
  assert.deepEqual(Object.fromEntries(local.data),{a:'old'});
});
test('an interrupted save is recovered before another operation', () => {
  const local=storage({a:'partial',c:'new','yeoni-storage-transaction-v1':JSON.stringify({a:'old',b:'restore',c:null})});
  recoverStorageTransaction(local);
  assert.deepEqual(records(local),{a:'old',b:'restore'});
  const recoveredGeneration = local.getItem(STORAGE_GENERATION_KEY);
  assert.ok(recoveredGeneration);
  writeStorageBatch(local,{a:'saved',b:null});
  assert.deepEqual(records(local),{a:'saved'});
  assert.notEqual(local.getItem(STORAGE_GENERATION_KEY), recoveredGeneration);
});

test('ordinary snapshot returns the whole before image without touching a peer journal or partial values', () => {
  const local = storage({ a: 'partial', added: 'partial-new', untouched: 'keep', [STORAGE_JOURNAL_KEY]: JSON.stringify({ a: 'old', deleted: 'restore', added: null }) });
  const before = [...local.data];
  const view = readStorageSnapshot(local);
  assert.equal(view.pending, true);
  assert.deepEqual(Object.fromEntries(Array.from({ length: view.length }, (_, index) => { const key = view.key(index)!; return [key, view.getItem(key)]; })), { a: 'old', untouched: 'keep', deleted: 'restore' });
  assert.deepEqual([...local.data], before, 'A reader must never recover or rewrite a journal');
});

test('snapshot detects a complete commit between samples even though both sampled journals are null', () => {
  const local = storage({ a: 'old-a', b: 'old-b' });
  const get = local.getItem; let interleaved = false;
  local.getItem = key => {
    const value = get(key);
    if (key === 'a' && !interleaved) { interleaved = true; writeStorageBatch(local, { a: 'new-a', b: 'new-b' }); }
    return value;
  };
  const view = readStorageSnapshot(local);
  assert.equal(view.pending, false); assert.equal(view.getItem('a'), 'new-a'); assert.equal(view.getItem('b'), 'new-b');
});

test('snapshot detects a complete failed write and rollback between null journal samples', () => {
  const local = storage({ a: 'old-a', b: 'old-b' }, (key, value) => key === 'b' && value === 'new-b');
  const get = local.getItem; let interleaved = false;
  local.getItem = key => {
    const value = get(key);
    if (key === 'a' && !interleaved) { interleaved = true; assert.throws(() => writeStorageBatch(local, { a: 'new-a', b: 'new-b' })); }
    return value;
  };
  const view = readStorageSnapshot(local);
  assert.equal(view.getItem('a'), 'old-a'); assert.equal(view.getItem('b'), 'old-b'); assert.ok(view.generation);
});

test('continuous participating writes fail visibly instead of returning an empty or torn snapshot', () => {
  const local = storage({ a: 'original' }); const get = local.getItem; let counter = 0;
  local.getItem = key => { const value = get(key); if (key === 'a') local.data.set(STORAGE_GENERATION_KEY, String(++counter)); return value; };
  assert.throws(() => readStorageSnapshot(local), StorageSnapshotBusyError);
  assert.equal(local.data.get('a'), 'original');
});

test('corrupt journals and failed generation writes remain intact for explicit recovery', () => {
  const corrupt = storage({ a: 'keep', [STORAGE_JOURNAL_KEY]: '{bad-json' }); const before = [...corrupt.data];
  assert.throws(() => readStorageSnapshot(corrupt)); assert.deepEqual([...corrupt.data], before);
  const blocked = storage({ a: 'old' }, key => key === STORAGE_GENERATION_KEY);
  assert.throws(() => writeStorageBatch(blocked, { a: 'new' }));
  assert.equal(blocked.getItem('a'), 'old'); assert.ok(blocked.getItem(STORAGE_JOURNAL_KEY));
  assert.equal(readStorageSnapshot(blocked).getItem('a'), 'old');
});
