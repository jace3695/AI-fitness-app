import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearLocalCloudState, isCurrentCloudSession, mergeCloudState, mergeCloudStateFromBase,
  prepareLocalCloudState, readCloudSyncEpoch, readLocalCloudState, readSyncBase, saveSyncBase,
  readCloudSyncRequest, commitCloudSyncResponse, CloudSyncAcknowledgementStaleError, restoreCloudBackup,
} from './cloudSync.ts';
import { captureStorageOwner, STORAGE_JOURNAL_KEY, STORAGE_LOCK_NAME, STORAGE_PROTOCOL_KEY, STORAGE_SESSION_KEY,
  StorageLegacyMigrationRequiredError, StorageSessionChangedError, updateStorageBatch } from './storageTransaction.ts';
import { installStorageLocks } from '../../tests/helpers/storageProtocol.ts';
import { readJsonForUpdate, updateJson } from './recordStorage.ts';

const original = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`ai-fitness-fixture-${index}`, { value: index }]));
function device(seed: Record<string, unknown> = original) {
  const locks = installStorageLocks();
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  let rejectRemoval: string | undefined;
  const storage = {
    get length() { return values.size; }, key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; }, setItem(key: string, value: string) { values.set(key, String(value)); },
    removeItem(key: string) { if (key === rejectRemoval) { rejectRemoval = undefined; throw new Error('fixture storage failure'); } values.delete(key); },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { localStorage: storage }) });
  return { storage, values, locks, failRemoval: (key: string) => { rejectRemoval = key; }, restore: () => {
    locks.restore(); if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
  } };
}

test('logout atomically removes records and all baselines; login preserves 17 remote keys', async () => {
  const local=device();try {
    await prepareLocalCloudState('a');await saveSyncBase('a',original);local.storage.setItem('fitness-cloud-sync-base:b',JSON.stringify(original));local.storage.setItem('unrelated-preference','keep');
    const epoch=readCloudSyncEpoch();const cleanup=clearLocalCloudState();assert.equal(isCurrentCloudSession('a',epoch),false,'Fence is synchronous');await cleanup;
    assert.deepEqual(readLocalCloudState(),{});assert.equal(readSyncBase('a'),null);assert.equal(readSyncBase('b'),null);assert.equal(local.storage.getItem('unrelated-preference'),'keep');
    await prepareLocalCloudState('a');assert.deepEqual(mergeCloudState(original,readLocalCloudState()),original);
  }finally{local.restore();}
});
test('unowned empty legacy cache baseline cannot delete remote state on upgrade',async()=>{
  const local=device({});try{
    local.storage.setItem('fitness-cloud-sync-base:a',JSON.stringify(original));await prepareLocalCloudState('a');const base=readSyncBase('a');
    assert.deepEqual(base?mergeCloudStateFromBase(base,original,readLocalCloudState()):mergeCloudState(original,readLocalCloudState()),original);
  }finally{local.restore();}
});
test('same-owner preparation is deduplicated and refresh preserves intentional last-key deletion',async()=>{
  const local=device({'ai-fitness-fixture-0':{value:0}});try{
    const first=prepareLocalCloudState('a');assert.equal(prepareLocalCloudState('a'),first);await first;
    const before=readLocalCloudState();await saveSyncBase('a',before);const epoch=readCloudSyncEpoch();
    await updateStorageBatch(local.storage,()=>({'ai-fitness-fixture-0':null}));await prepareLocalCloudState('a');assert.equal(readCloudSyncEpoch(),epoch);
    assert.deepEqual(mergeCloudStateFromBase(readSyncBase('a')!,before,readLocalCloudState()),{});
    const cleanup=clearLocalCloudState();assert.equal(clearLocalCloudState(),cleanup);await cleanup;const signedOutEpoch=readCloudSyncEpoch();await clearLocalCloudState();assert.equal(readCloudSyncEpoch(),signedOutEpoch);
  }finally{local.restore();}
});
test('switch accounts and A→B→A invalidate old work with unique session identities',async()=>{
  const local=device();try{
    await prepareLocalCloudState('a');await saveSyncBase('a',original);const epoch=readCloudSyncEpoch();
    const change=prepareLocalCloudState('b');assert.equal(isCurrentCloudSession('a',epoch),false);assert.throws(()=>captureStorageOwner(),StorageSessionChangedError);await change;
    assert.deepEqual(readLocalCloudState(),{});assert.equal(readSyncBase('a'),null);assert.equal(isCurrentCloudSession('b',readCloudSyncEpoch()),true);
    await prepareLocalCloudState('a');assert.notEqual(readCloudSyncEpoch(),epoch);assert.equal(isCurrentCloudSession('a',epoch),false);
  }finally{local.restore();}
});
test('logout preserves ambiguous v1 recovery information and fences old work',async()=>{
  const local=device();try{
    await prepareLocalCloudState('a');await saveSyncBase('a',original);const epoch=readCloudSyncEpoch();
    const journal=JSON.stringify({'ai-fitness-fixture-0':JSON.stringify({value:99})});local.storage.setItem(STORAGE_JOURNAL_KEY,journal);
    await assert.rejects(clearLocalCloudState(),StorageLegacyMigrationRequiredError);assert.equal(local.storage.getItem(STORAGE_JOURNAL_KEY),journal);assert.equal(isCurrentCloudSession('a',epoch),false);assert.deepEqual(readSyncBase('a'),original);
  }finally{local.restore();}
});
test('failed cleanup rolls back records+baseline while keeping the session fenced',async()=>{
  const local=device();try{
    await prepareLocalCloudState('a');await saveSyncBase('a',original);const epoch=readCloudSyncEpoch();local.failRemoval('ai-fitness-fixture-8');
    await assert.rejects(clearLocalCloudState(),/fixture storage failure/);assert.deepEqual(readLocalCloudState(),original);assert.deepEqual(readSyncBase('a'),original);assert.equal(isCurrentCloudSession('a',epoch),false);assert.throws(()=>captureStorageOwner(),StorageSessionChangedError);
    await clearLocalCloudState();assert.deepEqual(readLocalCloudState(),{});
  }finally{local.restore();}
});
test('acknowledgment atomically preserves edits made during network await and advances only sent base',async()=>{
  const key='ai-fitness-record';const local=device({[key]:{value:1}});try{
    await prepareLocalCloudState('a');const request=readCloudSyncRequest('a',readCloudSyncEpoch());
    await updateJson(key,{},current=>({...current,newer:2}));const acknowledged={[key]:{value:1,remote:3}};
    const result=await commitCloudSyncResponse(request,acknowledged);
    assert.deepEqual(result.local,{[key]:{value:1,newer:2,remote:3}});assert.equal(result.pending,true);assert.deepEqual(readSyncBase('a'),acknowledged);assert.deepEqual(readLocalCloudState(),result.local);
  }finally{local.restore();}
});
test('out-of-order same-owner acknowledgment is rejected; repeated no-op ack produces no writes',async()=>{
  const local=device();try{
    await prepareLocalCloudState('a');const first=readCloudSyncRequest('a',readCloudSyncEpoch());const competing=readCloudSyncRequest('a',readCloudSyncEpoch());await commitCloudSyncResponse(first,original);
    await assert.rejects(commitCloudSyncResponse(competing,{}),CloudSyncAcknowledgementStaleError);assert.deepEqual(readLocalCloudState(),original);assert.deepEqual(readSyncBase('a'),original);
    const ready=readCloudSyncRequest('a',readCloudSyncEpoch());const before=[...local.values];await commitCloudSyncResponse(ready,original);assert.deepEqual([...local.values],before);
  }finally{local.restore();}
});
test('remote-only response arriving after owner change cannot write records or advance a baseline',async()=>{
  const local=device({});try{
    await prepareLocalCloudState('a');const request=readCloudSyncRequest('a',readCloudSyncEpoch());await prepareLocalCloudState('b');
    await assert.rejects(commitCloudSyncResponse(request,original),StorageSessionChangedError);assert.deepEqual(readLocalCloudState(),{});assert.equal(readSyncBase('a'),null);
  }finally{local.restore();}
});
test('ack baseline failure rolls records back with old baseline and cannot report success',async()=>{
  const key='ai-fitness-record';const local=device({[key]:{value:1}});try{
    await prepareLocalCloudState('a');await saveSyncBase('a',{[key]:{value:1}});const request=readCloudSyncRequest('a',readCloudSyncEpoch());const set=local.storage.setItem;let rejected=false;
    local.storage.setItem=(key,value)=>{if(key==='fitness-cloud-sync-base:a'&&!rejected){rejected=true;throw new Error('baseline quota');}set(key,value);};
    await assert.rejects(commitCloudSyncResponse(request,{[key]:{value:2}}),/baseline quota/);assert.deepEqual(readLocalCloudState(),{[key]:{value:1}});assert.deepEqual(readSyncBase('a'),{[key]:{value:1}});
  }finally{local.restore();}
});
test('backup restore merges fresh lock-time edits and strict JSON updates preserve malformed source',async()=>{
  const key='ai-fitness-record';const local=device({[key]:{before:1}});try{
    await prepareLocalCloudState('a');await Promise.all([updateJson(key,{},current=>({...current,newer:2})),restoreCloudBackup({[key]:{backup:3}})]);
    assert.deepEqual(readLocalCloudState(),{[key]:{before:1,newer:2,backup:3}});
    for(const raw of ['{broken','null','[]','12']){local.storage.setItem(key,raw);await assert.rejects(updateJson(key,{},current=>({...current,replaced:1})));assert.equal(local.storage.getItem(key),raw);}
    assert.throws(()=>readJsonForUpdate(local.storage,key,{}));
  }finally{local.restore();}
});
test('interrupted account transition cleanup bases its choice on recovered ownership',async()=>{
  const local=device();try{
    await prepareLocalCloudState('a');const epoch=readCloudSyncEpoch();local.storage.setItem('fitness-cloud-sync-user','b');local.storage.setItem('ai-fitness-fixture-0','partial');
    local.storage.setItem(STORAGE_PROTOCOL_KEY,JSON.stringify({version:2,state:'prepared',generation:'old',transactionId:'abandoned',before:{'fitness-cloud-sync-user':'a','ai-fitness-fixture-0':JSON.stringify({value:0})}}));
    // Force a new preparation while desired A is retained, as after an interrupted page.
    local.storage.removeItem('fitness-cloud-sync-ready');await prepareLocalCloudState('a');assert.equal(local.storage.getItem(STORAGE_SESSION_KEY),epoch);assert.deepEqual(readLocalCloudState(),original);
  }finally{local.restore();}
});
test('network waits never hold the local storage lock',async()=>{
  const local=device();try{
    await prepareLocalCloudState('a');const request=readCloudSyncRequest('a',readCloudSyncEpoch());assert.equal(local.locks.active,0);
    await updateStorageBatch(local.storage,()=>({'ai-fitness-other':'true'}));await commitCloudSyncResponse(request,original);assert.equal(local.locks.active,0);assert.ok(local.locks.calls.every(name=>name===STORAGE_LOCK_NAME));
  }finally{local.restore();}
});


test('separate tab preparation contexts join the winning same-owner generation', async () => {
  const local=device();
  const other = await import(new URL('./cloudSync.ts?same-owner-tab', import.meta.url).href);
  try {
    const set=local.storage.setItem;let peer:Promise<void>|undefined;let interleaved=false;
    local.storage.setItem=(key,value)=>{
      if(key===STORAGE_SESSION_KEY&&!interleaved){interleaved=true;peer=other.prepareLocalCloudState('a');}
      set(key,value);
    };
    const first=prepareLocalCloudState('a');await Promise.all([first,peer]);
    assert.equal(isCurrentCloudSession('a',readCloudSyncEpoch()),true);
    assert.deepEqual(readLocalCloudState(),original);
    const epoch=readCloudSyncEpoch();await Promise.all([prepareLocalCloudState('a'),other.prepareLocalCloudState('a')]);assert.equal(readCloudSyncEpoch(),epoch);
  }finally{local.restore();}
});

test('unsupported WebLocks preparation preserves every persisted byte and fails closed', async () => {
  const local=device();try {
    const before=[...local.values];Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
    await assert.rejects(prepareLocalCloudState('a'),/Web Locks/);assert.deepEqual([...local.values],before);assert.throws(()=>captureStorageOwner(),StorageSessionChangedError);
  }finally{local.restore();}
});

test('failed fence persistence cannot revive queued old work when the owner retries preparation',async()=>{
  const local=device();try{
    await prepareLocalCloudState('a');const old=captureStorageOwner();const set=local.storage.setItem;let fail=true;
    local.storage.setItem=(key,value)=>{if(key===STORAGE_SESSION_KEY&&fail){fail=false;throw new Error('fence quota');}set(key,value);};
    await assert.rejects(prepareLocalCloudState('b'),/fence quota/);assert.equal(isCurrentCloudSession('a',old.epoch),false);
    await prepareLocalCloudState('a');assert.notEqual(readCloudSyncEpoch(),old.epoch);await assert.rejects(async()=>updateStorageBatch(local.storage,()=>({'ai-fitness-stale':'true'}),{owner:old}),StorageSessionChangedError);
  }finally{local.restore();}
});

test('same-owner reload recovers a crashed ordinary v2 batch without waiting for a user edit',async()=>{
  const local=device();try{
    await prepareLocalCloudState('a');const epoch=readCloudSyncEpoch();
    local.storage.setItem('ai-fitness-fixture-0','partial');local.storage.setItem(STORAGE_PROTOCOL_KEY,JSON.stringify({version:2,state:'prepared',generation:'old',transactionId:'interrupted-save',before:{'ai-fitness-fixture-0':JSON.stringify({value:0})}}));
    await prepareLocalCloudState('a');assert.equal(readCloudSyncEpoch(),epoch);assert.deepEqual(readLocalCloudState(),original);assert.equal(JSON.parse(local.storage.getItem(STORAGE_PROTOCOL_KEY)!).state,'committed');
    assert.doesNotThrow(()=>readCloudSyncRequest('a',epoch));
  }finally{local.restore();}
});
