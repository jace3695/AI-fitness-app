import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearLocalCloudState, isCurrentCloudSession, mergeCloudState, mergeCloudStateFromBase,
  prepareLocalCloudState, readCloudSyncEpoch, readLocalCloudState, readSyncBase, saveSyncBase,
  readCloudSyncRequest, commitCloudSyncResponse, CloudSyncAcknowledgementStaleError, restoreCloudBackup,
  assertCloudSyncRequestCurrent, commitCloudSyncResolutionResponse, CloudSyncResponseConflictError, CloudSyncLegacyEncodingError, CloudSyncNamespaceError,
} from './cloudSync.ts';
import { captureStorageOwner, STORAGE_JOURNAL_KEY, STORAGE_LOCK_NAME, STORAGE_PROTOCOL_KEY, STORAGE_SESSION_KEY,
  StorageLegacyMigrationRequiredError, StorageSessionChangedError, updateStorageBatch } from './storageTransaction.ts';
import { installStorageLocks } from '../../tests/helpers/storageProtocol.ts';
import { CloudSyncConflictStaleError, classifyCloudSyncConflicts } from './cloudSyncConflicts.ts';
import { getLocalDateKey } from './dietPlans.ts';
import { readJsonForUpdate, readRecordStores, updateJson } from './recordStorage.ts';

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


test('conflict request freshness is checked under lock and detects same-content local A→B→A', async () => {
  const key='ai-fitness-record'; const local=device({[key]:{memo:'A'}}); try {
    await prepareLocalCloudState('a'); await saveSyncBase('a',{[key]:{memo:'base'}});
    const request=readCloudSyncRequest('a',readCloudSyncEpoch()); const unchanged=[...local.values];
    await assertCloudSyncRequestCurrent(request); assert.deepEqual([...local.values],unchanged,'A read-only guard must not issue a new generation');
    await updateStorageBatch(local.storage,()=>({[key]:JSON.stringify({memo:'B'})}));
    await updateStorageBatch(local.storage,()=>({[key]:JSON.stringify({memo:'A'})}));
    assert.deepEqual(readLocalCloudState(),request.local); const before=[...local.values];
    await assert.rejects(assertCloudSyncRequestCurrent(request),CloudSyncConflictStaleError);
    assert.deepEqual([...local.values],before); assert.equal(local.locks.active,0);
  } finally {local.restore();}
});
test('conflict request freshness observes queued local writes and cannot cross A→B→A owner epochs', async () => {
  const local=device(); try {
    await prepareLocalCloudState('a'); const request=readCloudSyncRequest('a',readCloudSyncEpoch());
    const write=updateStorageBatch(local.storage,()=>({'ai-fitness-new':'true'}));
    await assert.rejects(assertCloudSyncRequestCurrent(request),CloudSyncConflictStaleError); await write;
    await prepareLocalCloudState('b'); await prepareLocalCloudState('a');
    await assert.rejects(assertCloudSyncRequestCurrent(request),StorageSessionChangedError);
    await assert.rejects(commitCloudSyncResolutionResponse(request,{}),StorageSessionChangedError);
  } finally {local.restore();}
});
test('normal ack discovers concurrent same-field input without changing local or baseline evidence', async () => {
  const key='ai-fitness-record'; const base={[key]:{memo:'base'}}; const local=device(base); try {
    await prepareLocalCloudState('a'); await saveSyncBase('a',base); const request=readCloudSyncRequest('a',readCloudSyncEpoch());
    await updateStorageBatch(local.storage,()=>({[key]:JSON.stringify({memo:'typed during GET'})}));
    const before=[...local.values]; const remote={[key]:{memo:'different device'}};
    await assert.rejects(commitCloudSyncResponse(request,remote),CloudSyncResponseConflictError);
    assert.deepEqual([...local.values],before); assert.deepEqual(readSyncBase('a'),base);
    const fresh=readCloudSyncRequest('a',readCloudSyncEpoch()); assert.equal(classifyCloudSyncConflicts(fresh.base,remote,fresh.local).conflicts.length,1);
  } finally {local.restore();}
});
test('normal ack also rejects initial-baseline, array and parent deletion/edit races', async () => {
  const key='ai-fitness-record';
  for(const [base,remote,newer] of [[{memo:'base'},{memo:'remote'},{memo:'local'}],[['old'],['remote'],['local']],[{a:1},{a:2},undefined]]) {
    const local=device({[key]:base}); try {
      await prepareLocalCloudState('a'); const request=readCloudSyncRequest('a',readCloudSyncEpoch());
      await updateStorageBatch(local.storage,()=>({[key]:newer===undefined?null:JSON.stringify(newer)}));
      const before=[...local.values]; await assert.rejects(commitCloudSyncResponse(request,{[key]:remote}),CloudSyncResponseConflictError);
      assert.deepEqual([...local.values],before); assert.equal(readSyncBase('a'),null);
    } finally {local.restore();}
  }
});
test('explicit resolution atomically acknowledges chosen remote state while newer same-field input stays pending', async () => {
  const key='ai-fitness-record'; const base={[key]:{memo:'base',list:['old'],gone:1,independent:1}};
  const local=device({[key]:{memo:'local',list:['local'],gone:1,independent:1}}); try {
    await prepareLocalCloudState('a'); await saveSyncBase('a',base); const request=readCloudSyncRequest('a',readCloudSyncEpoch());
    await assertCloudSyncRequestCurrent(request); assert.equal(local.locks.active,0,'Network dispatch would occur outside the local lock');
    const resolved={[key]:{memo:'chosen remote',list:['remote'],gone:2,independent:2}};
    await updateStorageBatch(local.storage,()=>({[key]:JSON.stringify({memo:'typed after selection',list:['new','new'],independent:1})}));
    const result=await commitCloudSyncResolutionResponse(request,resolved);
    assert.deepEqual(result.local,{[key]:{memo:'typed after selection',list:['new','new'],independent:2}}); assert.equal(result.pending,true);
    assert.deepEqual(readSyncBase('a'),resolved); assert.deepEqual(readLocalCloudState(),result.local); assert.equal(local.locks.active,0);
    const fresh=readCloudSyncRequest('a',readCloudSyncEpoch()); assert.deepEqual(classifyCloudSyncConflicts(fresh.base,resolved,fresh.local).merged,result.local);
  } finally {local.restore();}
});
test('explicit resolution failures at records, baseline and acknowledgement roll back every source', async () => {
  const key='ai-fitness-record';
  for (const failureKey of [key,'fitness-cloud-sync-base:a','fitness-cloud-sync-ack:a']) {
    const base={[key]:{memo:'base'}}; const old={[key]:{memo:'local'}}; const local=device(old); try {
      await prepareLocalCloudState('a'); await saveSyncBase('a',base); const request=readCloudSyncRequest('a',readCloudSyncEpoch());
      const ack=local.storage.getItem('fitness-cloud-sync-ack:a'); const set=local.storage.setItem; let failed=false;
      local.storage.setItem=(key,value)=>{if(key===failureKey&&!failed){failed=true;throw new Error('synthetic quota');}set(key,value);};
      await assert.rejects(commitCloudSyncResolutionResponse(request,{[key]:{memo:'chosen remote'}}),/synthetic quota/);
      assert.deepEqual(readLocalCloudState(),old); assert.deepEqual(readSyncBase('a'),base); assert.equal(local.storage.getItem('fitness-cloud-sync-ack:a'),ack);
    } finally {local.restore();}
  }
});
test('competing ack and changed baseline cannot be overwritten by an older explicit decision', async () => {
  const local=device(); try {
    await prepareLocalCloudState('a'); const request=readCloudSyncRequest('a',readCloudSyncEpoch());
    await commitCloudSyncResponse(request,original); const before=[...local.values];
    await assert.rejects(commitCloudSyncResolutionResponse(request,{}),CloudSyncAcknowledgementStaleError); assert.deepEqual([...local.values],before);
    const fresh=readCloudSyncRequest('a',readCloudSyncEpoch()); local.storage.setItem('fitness-cloud-sync-base:a','{}');
    await assert.rejects(commitCloudSyncResolutionResponse(fresh,{}),CloudSyncAcknowledgementStaleError);
  } finally {local.restore();}
});
test('selected JSON-looking top-level strings round-trip exactly and malformed raw local bytes survive', async () => {
  const key='ai-fitness-record';
  for (const value of ['null','123','true','{"x":1}','[1,2]','"quoted"','plain text','{broken']) {
    const local=device({}); try {
      await prepareLocalCloudState('a'); const request=readCloudSyncRequest('a',readCloudSyncEpoch());
      const result=await commitCloudSyncResolutionResponse(request,{[key]:value});
      assert.deepEqual(readLocalCloudState(),{[key]:value}); assert.deepEqual(readSyncBase('a'),{[key]:value}); assert.equal(result.pending,false);
    } finally {local.restore();}
  }
  const local=device({}); try {
    await prepareLocalCloudState('a'); local.storage.setItem(key,'{broken'); const request=readCloudSyncRequest('a',readCloudSyncEpoch());
    await commitCloudSyncResponse(request,{...request.local,'ai-fitness-independent':true}); assert.equal(local.storage.getItem(key),'{broken');
  } finally {local.restore();}
});
test('reset arriving after explicit dispatch cannot resurrect pre-reset selected records', async () => {
  const key='ai-fitness-daily-notes'; const local=device({[key]:{memo:'local'}}); try {
    await prepareLocalCloudState('a'); const request=readCloudSyncRequest('a',readCloudSyncEpoch());
    const marker='2026-10-09T20:00:00Z|synthetic-reset';
    await updateStorageBatch(local.storage,()=>({[key]:null,'ai-fitness-record-reset-fitness':marker}));
    const resolved={[key]:{memo:'selected before reset'}}; const result=await commitCloudSyncResolutionResponse(request,resolved);
    assert.deepEqual(result.local,{'ai-fitness-record-reset-fitness':marker}); assert.equal(result.pending,true); assert.deepEqual(readSyncBase('a'),resolved);
  } finally {local.restore();}
});


test('unsubmitted legacy representation conversion cannot be acknowledged as though it was the verified payload', async () => {
  const key='ai-fitness-workout-completed-days'; const records={'2030-01-01':{workoutMemo:'synthetic existing memo'}};
  const original={[key]:records}; const local=device(original); try {
    await prepareLocalCloudState('a'); await saveSyncBase('a',original); const request=readCloudSyncRequest('a',readCloudSyncEpoch());
    const legacy={[key]:JSON.stringify(records)}; const before=[...local.values];
    await assert.rejects(commitCloudSyncResponse(request,legacy),CloudSyncLegacyEncodingError);
    await assert.rejects(commitCloudSyncResolutionResponse(request,legacy),CloudSyncLegacyEncodingError);
    assert.deepEqual([...local.values],before); assert.deepEqual(readLocalCloudState(),original); assert.deepEqual(readSyncBase('a'),original);
    assert.deepEqual(readJsonForUpdate(local.storage,key,{}),records);
  } finally {local.restore();}
});


test('canonicalized legacy server record maps roundtrip through actual record readers and stable next-sync baseline', async () => {
  const key='ai-fitness-workout-completed-days'; const day='2030-01-01';
  const base={[key]:JSON.stringify({[day]:{workoutMemo:'base',extra:{kept:[1,1,null]}}})};
  const remote={[key]:JSON.stringify({[day]:{workoutMemo:'server',extra:{kept:[1,1,null]}}}),'ai-fitness-water-intake':JSON.stringify({[day]:1200})};
  const local=device({[key]:JSON.parse(base[key])}); try {
    await prepareLocalCloudState('a'); await saveSyncBase('a',base); const request=readCloudSyncRequest('a',readCloudSyncEpoch());
    const classified=classifyCloudSyncConflicts(request.base,remote,request.local); assert.equal(classified.conflicts.length,0); const canonical=classified.merged!;
    const result=await commitCloudSyncResponse(request,canonical); assert.equal(result.pending,false);
    const stores=readRecordStores(); assert.equal((stores.workouts[day] as {workoutMemo:string}).workoutMemo,'server'); assert.deepEqual((stores.workouts[day] as unknown as Record<string, unknown>).extra,{kept:[1,1,null]}); assert.equal(stores.water[day],1200);
    assert.deepEqual(readSyncBase('a'),canonical); const fresh=readCloudSyncRequest('a',readCloudSyncEpoch());
    assert.deepEqual(classifyCloudSyncConflicts(fresh.base,canonical,fresh.local),{merged:canonical,conflicts:[],resetKeys:[]});
    const before=[...local.values]; await commitCloudSyncResponse(fresh,canonical); assert.deepEqual([...local.values],before,'Stable canonical ack must not cause a write loop');
  } finally {local.restore();}
});
test('legacy canonicalization quota failure preserves old raw baseline and readable local records atomically', async () => {
  const key='ai-fitness-workout-completed-days';const map={'2030-01-01':{workoutMemo:'local'}};const base={[key]:JSON.stringify(map)};const local=device({[key]:map});try {
    await prepareLocalCloudState('a');await saveSyncBase('a',base);const request=readCloudSyncRequest('a',readCloudSyncEpoch());const set=local.storage.setItem;let failed=false;
    local.storage.setItem=(key,value)=>{if(key==='fitness-cloud-sync-base:a'&&!failed){failed=true;throw new Error('compatibility quota');}set(key,value);};
    const canonical=classifyCloudSyncConflicts(request.base,{[key]:JSON.stringify({'2030-01-01':{workoutMemo:'server'}})},request.local).merged!;
    await assert.rejects(commitCloudSyncResponse(request,canonical),/compatibility quota/);assert.deepEqual(readSyncBase('a'),base);assert.deepEqual(readLocalCloudState(),{[key]:map});assert.equal((readRecordStores().workouts['2030-01-01'] as {workoutMemo:string}).workoutMemo,'local');
  }finally{local.restore();}
});


test('out-of-contract remote roots cannot mutate local records, baseline, or acknowledgement', async () => {
  const local=device();try{
    await prepareLocalCloudState('a');await saveSyncBase('a',original);const request=readCloudSyncRequest('a',readCloudSyncEpoch());const before=[...local.values];
    for(const invalid of [{...original,unrelated:{memo:'synthetic'}},{unrelated:{}}]) {
      await assert.rejects(commitCloudSyncResponse(request,invalid),CloudSyncNamespaceError);await assert.rejects(commitCloudSyncResolutionResponse(request,invalid),CloudSyncNamespaceError);
      assert.deepEqual([...local.values],before);assert.deepEqual(readLocalCloudState(),original);assert.deepEqual(readSyncBase('a'),original);
    }
  }finally{local.restore();}
});


test('all documented fasting formats retain actual current-day reader behavior after canonical ack', async () => {
  const key='ai-fitness-fasting-start-time';const day=getLocalDateKey();
  for(const [wire,expected] of [['',''],['18:30','18:30'],['"18:30"','18:30'],[JSON.stringify({[day]:'19:40',unknown:{kept:true}}),'19:40']]) {
    const local=device({});try{
      await prepareLocalCloudState('a');const request=readCloudSyncRequest('a',readCloudSyncEpoch());const classified=classifyCloudSyncConflicts(null,{[key]:wire},{});assert.equal(classified.conflicts.length,0);
      const canonical=classified.merged!;const result=await commitCloudSyncResponse(request,canonical);assert.equal(result.pending,false);assert.equal(readRecordStores().fastingStart,expected);assert.deepEqual(readSyncBase('a'),canonical);
    }finally{local.restore();}
  }
});
