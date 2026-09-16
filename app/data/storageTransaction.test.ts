import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverStorageTransaction, writeStorageBatch } from './storageTransaction.ts';

function storage(values: Record<string,string>, reject?: (key:string,value:string) => boolean) {
  const data = new Map(Object.entries(values));
  return { data, getItem: (key:string) => data.get(key) ?? null, removeItem: (key:string) => { data.delete(key); },
    setItem: (key:string,value:string) => { if (reject?.(key,value)) throw new Error('quota'); data.set(key,value); } };
}
test('a later local save failure preserves the entire previous snapshot', () => {
  const local=storage({a:'old-a',b:'old-b'},(key,value)=>key==='b'&&value==='new-b');
  assert.throws(()=>writeStorageBatch(local,{a:'new-a',b:'new-b',c:'new-c'}));
  assert.deepEqual(Object.fromEntries(local.data),{a:'old-a',b:'old-b'});
});
test('a full device that cannot reserve a journal does not change any record', () => {
  const local=storage({a:'old'},()=>true);
  assert.throws(()=>writeStorageBatch(local,{a:'new'}));
  assert.deepEqual(Object.fromEntries(local.data),{a:'old'});
});
test('an interrupted save is recovered before another operation', () => {
  const local=storage({a:'partial',c:'new','yeoni-storage-transaction-v1':JSON.stringify({a:'old',b:'restore',c:null})});
  recoverStorageTransaction(local);
  assert.deepEqual(Object.fromEntries(local.data),{a:'old',b:'restore'});
  writeStorageBatch(local,{a:'saved',b:null});
  assert.deepEqual(Object.fromEntries(local.data),{a:'saved'});
});
