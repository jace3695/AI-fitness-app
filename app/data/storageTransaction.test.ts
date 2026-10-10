import test from 'node:test';
import assert from 'node:assert/strict';
import { captureStorageOwner, completeStorageOwnerTransition, invalidateStorageOwner, isStorageOwnerCurrent, readStorageSnapshot,
  recoverStorageTransaction, STORAGE_GENERATION_KEY, STORAGE_JOURNAL_KEY, STORAGE_LOCK_NAME, STORAGE_OWNER_KEY, STORAGE_PROTOCOL_KEY, STORAGE_READY_KEY, STORAGE_SESSION_KEY,
  StorageCorruptionError, StorageLegacyMigrationRequiredError, StorageLocksUnavailableError, StorageSessionChangedError, StorageSnapshotBusyError,
  updateStorageBatch, writeStorageBatch } from './storageTransaction.ts';
import { installStorageLocks, preparedStorageSeed } from '../../tests/helpers/storageProtocol.ts';

function storage(values: Record<string,string> = {}, reject?: (key:string,value:string) => boolean) {
  const data = new Map(Object.entries({ ...preparedStorageSeed(), ...values }));
  return { data, get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key:string) => data.get(key) ?? null, removeItem: (key:string) => { data.delete(key); },
    setItem: (key:string,value:string) => { if (reject?.(key,value)) throw new Error('quota'); data.set(key,value); } };
}
const records = (local: ReturnType<typeof storage>) => Object.fromEntries([...local.data].filter(([key]) => !key.startsWith('yeoni-storage-') && !key.startsWith('fitness-cloud-sync-')));
const protocol = (local: ReturnType<typeof storage>) => JSON.parse(local.getItem(STORAGE_PROTOCOL_KEY) || 'null');
const prepared = (before: Record<string,string|null>) => JSON.stringify({ version: 2, state: 'prepared', generation: 'before', transactionId: 'fixture-transaction', before });

for (const failedKey of ['b', STORAGE_PROTOCOL_KEY]) test(`failed save preserves all records and advances rollback generation (${failedKey})`, async () => {
  const locks = installStorageLocks(); let rejected = false;
  const local=storage({a:'old-a',b:'old-b'}, (key,value) => {
    if (rejected) return false;
    if ((key === failedKey && value === 'new-b') || (failedKey === STORAGE_PROTOCOL_KEY && value.includes('"state":"committed"'))) { rejected = true; return true; }
    return false;
  });
  try {
    await assert.rejects(async () => writeStorageBatch(local,{a:'new-a',b:'new-b',c:'new-c'}));
    assert.deepEqual(records(local),{a:'old-a',b:'old-b'});
    assert.equal(protocol(local).state, 'committed');
  } finally { locks.restore(); }
});
test('unable to reserve before-image performs no user-key writes', async () => {
  const locks=installStorageLocks(); const local=storage({a:'old'},()=>true); const before=[...local.data];
  try { await assert.rejects(async()=>writeStorageBatch(local,{a:'new'})); assert.deepEqual([...local.data],before); } finally { locks.restore(); }
});
test('a provably interrupted v2 batch recovers under the shared lock before a fresh transform', async () => {
  const locks=installStorageLocks(); const local=storage({a:'partial',c:'new',[STORAGE_PROTOCOL_KEY]:prepared({a:'old',b:'restore',c:null})});
  try {
    await updateStorageBatch(local,snapshot=>({a:`${snapshot.getItem('a')}-saved`,b:null}));
    assert.deepEqual(records(local),{a:'old-saved'}); assert.equal(protocol(local).state,'committed');
    assert.deepEqual(locks.calls,[STORAGE_LOCK_NAME]);
  } finally { locks.restore(); }
});
test('a new WebLock never authorizes destructive recovery of any legacy v1 journal', async () => {
  const locks=installStorageLocks(); const local=storage({a:'partial',[STORAGE_JOURNAL_KEY]:JSON.stringify({a:'old'})}); const before=[...local.data];
  try {
    await assert.rejects(async()=>recoverStorageTransaction(local),StorageLegacyMigrationRequiredError);
    await assert.rejects(async()=>writeStorageBatch(local,{a:'new'}),StorageLegacyMigrationRequiredError);
    assert.deepEqual([...local.data],before); assert.equal(readStorageSnapshot(local).getItem('a'),'old');
  } finally { locks.restore(); }
});
for (const version of [1,2]) test(`ordinary v${version} reader projects add/update/delete before-image without mutation`, () => {
  const beforeImage={a:'old',deleted:'restore',added:null};
  const local=storage({a:'partial',added:'new',untouched:'keep',[version===1?STORAGE_JOURNAL_KEY:STORAGE_PROTOCOL_KEY]:version===1?JSON.stringify(beforeImage):prepared(beforeImage)});
  const before=[...local.data]; const snapshot=readStorageSnapshot(local);
  assert.equal(snapshot.pending,true); assert.equal(snapshot.getItem('a'),'old'); assert.equal(snapshot.getItem('added'),null); assert.equal(snapshot.getItem('deleted'),'restore');
  assert.deepEqual([...local.data],before);
});
test('every write stage is a coherent old or fully committed snapshot', async () => {
  const locks=installStorageLocks(); const local=storage({a:'old-a',b:'old-b'}); const set=local.setItem;
  const seen: (string|null)[][]=[];
  local.setItem=(key,value)=>{set(key,value); const view=readStorageSnapshot(local); seen.push([view.getItem('a'),view.getItem('b')]);};
  try {
    await writeStorageBatch(local,{a:'new-a',b:'new-b'});
    assert.ok(seen.length>=4); for(const pair of seen) assert.ok(JSON.stringify(pair)==='["old-a","old-b"]'||JSON.stringify(pair)==='["new-a","new-b"]');
  } finally {locks.restore();}
});
test('whole commit and rollback ABA changes invalidate and retry the entire sampled snapshot', () => {
  for(const rollback of [false,true]) {
    const local=storage({a:'old-a',b:'old-b'}); const get=local.getItem;let done=false;
    local.getItem=key=>{const value=get(key);if(key==='a'&&!done){done=true;local.data.set('a',rollback?'old-a':'new-a');local.data.set('b',rollback?'old-b':'new-b');local.data.set(STORAGE_PROTOCOL_KEY,JSON.stringify({version:2,state:'committed',generation:crypto.randomUUID()}));}return value;};
    const view=readStorageSnapshot(local);assert.equal(view.getItem('a'),rollback?'old-a':'new-a');assert.equal(view.getItem('b'),rollback?'old-b':'new-b');assert.ok(view.generation);
  }
});
test('continuous generation changes fail closed rather than returning torn/empty state', () => {
  const local=storage({a:'original'});const get=local.getItem;let counter=0;
  local.getItem=key=>{const value=get(key);if(key==='a')local.data.set(STORAGE_GENERATION_KEY,String(++counter));return value;};
  assert.throws(()=>readStorageSnapshot(local),StorageSnapshotBusyError);
});
test('corrupt protocol and failed rollback commit keep recovery data intact', async () => {
  const locks=installStorageLocks();
  try {
    for(const key of [STORAGE_JOURNAL_KEY,STORAGE_PROTOCOL_KEY]) { const local=storage({a:'keep',[key]:'{bad'});const before=[...local.data];assert.throws(()=>readStorageSnapshot(local),StorageCorruptionError);assert.deepEqual([...local.data],before); }
    const local=storage({a:'old'},(key,value)=>key===STORAGE_PROTOCOL_KEY&&value.includes('"state":"committed"'));
    await assert.rejects(async()=>writeStorageBatch(local,{a:'new'})); assert.equal(local.getItem('a'),'old');assert.equal(protocol(local).state,'prepared');assert.equal(readStorageSnapshot(local).getItem('a'),'old');
  }finally{locks.restore();}
});
test('two queued transforms read fresh state and preserve both independent edits', async () => {
  const locks=installStorageLocks();const local=storage({record:'{}'});
  try{await Promise.all(['a','b'].map(key=>updateStorageBatch(local,snapshot=>({record:JSON.stringify({...JSON.parse(snapshot.getItem('record')!),[key]:true})}))));assert.deepEqual(JSON.parse(local.getItem('record')!),{a:true,b:true});}finally{locks.restore();}
});
test('queued owner A work cannot write B or a later A session', async () => {
  const locks=installStorageLocks();const local=storage({a:'old'});const owner=captureStorageOwner(local);
  let release!:()=>void;let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});const held=locks.locks.request(STORAGE_LOCK_NAME,{},()=>new Promise<void>(resolve=>{release=resolve;entered();}));await started;
  const queued=updateStorageBatch(local,()=>({a:'stale'}),{owner});
  const b=invalidateStorageOwner(local,'b');const back=invalidateStorageOwner(local,owner.userId);
  release();await held;
  try{await assert.rejects(queued,StorageSessionChangedError);await completeStorageOwnerTransition(local,back,()=>({[STORAGE_OWNER_KEY]:owner.userId}));assert.notEqual(back.epoch,b.epoch);assert.notEqual(back.epoch,owner.epoch);assert.equal(local.getItem('a'),'old');assert.equal(isStorageOwnerCurrent(local,owner),false);}finally{locks.restore();}
});
test('owner invalidation during write cannot be rolled back to ready old owner', async () => {
  const locks=installStorageLocks();const local=storage({a:'old'});const owner=captureStorageOwner(local);const set=local.setItem;let newer: ReturnType<typeof invalidateStorageOwner>|undefined;
  local.setItem=(key,value)=>{set(key,value);if(key==='a'&&value==='new')newer=invalidateStorageOwner(local,'b');};
  try{await assert.rejects(async()=>writeStorageBatch(local,{a:'new'}),StorageSessionChangedError);assert.equal(local.getItem('a'),'old');assert.equal(local.getItem(STORAGE_SESSION_KEY),newer!.epoch);assert.equal(isStorageOwnerCurrent(local,owner),false);}finally{locks.restore();}
});
test('provisional owner readiness is hidden; late completion never overwrites newer invalidation', async () => {
  const locks=installStorageLocks();const local=storage({a:'old'});const pending=invalidateStorageOwner(local,'b');const set=local.setItem;let newer:ReturnType<typeof invalidateStorageOwner>|undefined;
  local.setItem=(key,value)=>{set(key,value);if(key===STORAGE_READY_KEY){assert.equal(isStorageOwnerCurrent(local,pending),false);if(!newer)newer=invalidateStorageOwner(local,'c');}};
  try{await assert.rejects(completeStorageOwnerTransition(local,pending,()=>({[STORAGE_OWNER_KEY]:'b',a:null})),StorageSessionChangedError);assert.equal(local.getItem(STORAGE_SESSION_KEY),newer!.epoch);assert.equal(isStorageOwnerCurrent(local,pending),false);assert.equal(local.getItem('a'),'old');}finally{locks.restore();}
});
test('missing WebLocks, unprepared owners, and async/nested transforms never mutate records', async () => {
  const locks=installStorageLocks();const local=storage({a:'old'});
  try {
    await assert.rejects(async()=>updateStorageBatch(local,(()=>Promise.resolve({a:'new'})) as never),/synchronous/);
    await assert.rejects(async()=>updateStorageBatch(local,()=>{writeStorageBatch(local,{a:'nested'});return {a:'outer'};}),/nested/);
    local.data.delete(STORAGE_SESSION_KEY);assert.throws(()=>captureStorageOwner(local),StorageSessionChangedError);
    Object.assign(local,{});local.data.set(STORAGE_SESSION_KEY,Object.values(preparedStorageSeed())[1]);
    const unsupported=storage({a:'old'});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});const before=[...unsupported.data];
    await assert.rejects(async()=>writeStorageBatch(unsupported,{a:'new'}),StorageLocksUnavailableError);assert.deepEqual([...unsupported.data],before);
    assert.equal(local.getItem('a'),'old');
  }finally{locks.restore();}
});

test('failed rollback restoration retains the durable before-image and retry restores it',async()=>{
  const locks=installStorageLocks();let rollbackFailure=true;
  const local=storage({a:'old-a',b:'old-b'},(key,value)=>(key==='b'&&value==='new-b')||(rollbackFailure&&key==='a'&&value==='old-a'));
  try{
    await assert.rejects(async()=>writeStorageBatch(local,{a:'new-a',b:'new-b'}),AggregateError);assert.equal(protocol(local).state,'prepared');
    const view=readStorageSnapshot(local);assert.equal(view.getItem('a'),'old-a');assert.equal(view.getItem('b'),'old-b');
    rollbackFailure=false;await recoverStorageTransaction(local);assert.deepEqual(records(local),{a:'old-a',b:'old-b'});assert.equal(protocol(local).state,'committed');
  }finally{locks.restore();}
});

test('session changed after durable commit but before promise completion suppresses stale UI success',async()=>{
  const locks=installStorageLocks();const local=storage({a:'old'});const set=local.setItem;let queued=false;
  local.setItem=(key,value)=>{set(key,value);if(key===STORAGE_PROTOCOL_KEY&&value.includes('"state":"committed"')&&!queued){queued=true;queueMicrotask(()=>invalidateStorageOwner(local,'b'));}};
  try{await assert.rejects(async()=>writeStorageBatch(local,{a:'new'}),StorageSessionChangedError);assert.equal(local.getItem('a'),'new','Durable commit is not falsely rolled back after notification boundary');}finally{locks.restore();}
});
