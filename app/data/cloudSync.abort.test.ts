import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import * as resets from './appRecordReset.ts';
import * as storage from './storageTransaction.ts';
import * as conflicts from './cloudSyncConflicts.ts';
import * as languageBoundary from './languageStorageBoundary.ts';

// Run the original query functions with the installed SDK and an in-memory
// fetch boundary. No credentials, real auth, browser or remote server is used.
function cloudWithFetch(send: typeof fetch): typeof import('./cloudSync.ts') {
  const supabase = createClient('http://127.0.0.1:1', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: send },
  });
  const code = ts.transpileModule(readFileSync(new URL('./cloudSync.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const requireFixture = (path: string) => {
    if (path === '../lib/supabase.ts') return { supabase };
    if (path === './appRecordReset.ts') return resets;
    if (path === './storageTransaction.ts') return storage;
    if (path === './cloudSyncConflicts.ts') return conflicts;
    if (path === './languageStorageBoundary.ts') return languageBoundary;
    throw new Error(`Unexpected dependency: ${path}`);
  };
  vm.runInNewContext(`(function(exports, require) { ${code}\n})`)(exports, requireFixture);
  return exports as typeof import('./cloudSync.ts');
}

test('GET/conditional RPC/insert RPC and confirmation GET pass the session abort signal to the actual SDK', async () => {
  const controller = new AbortController();
  const methods: string[] = [];
  const state = { 'ai-fitness-fixture': { memo: 'synthetic' } };
  const cloud = cloudWithFetch(async (_url, init) => {
    assert.equal(init?.signal, controller.signal);
    const method = init?.method ?? 'GET'; methods.push(method);
    return new Response(JSON.stringify(method === 'GET' ? [{ state, updated_at: '1' }] : true), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  await cloud.getRemoteState('fixture-user', controller.signal);
  assert.equal(await cloud.saveRemoteStateIfUnchanged('fixture-user', state, '1', controller.signal, state), true);
  await cloud.saveRemoteState('fixture-user', state, controller.signal);
  assert.deepEqual(methods, ['GET', 'POST', 'GET', 'POST', 'GET']);
  controller.abort();
  await assert.rejects(cloud.saveRemoteState('fixture-user', {}, controller.signal), { name: 'AbortError' });
  assert.equal(methods.length, 5, 'A cancelled operation reached fetch');
});

test('an RPC already committed before logout cannot start its confirmation GET after abort', async () => {
  const controller = new AbortController();
  const methods: string[] = [];
  const cloud = cloudWithFetch(async (_url, init) => {
    methods.push(init!.method!); assert.equal(init?.signal, controller.signal);
    // Model a delivered commit whose fetch ignores cancellation. The query
    // function must check the signal again before starting the readback.
    controller.abort();
    return new Response('true', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  await assert.rejects(cloud.saveRemoteStateIfUnchanged('fixture-user', { 'ai-fitness-fixture': 1 }, '1', controller.signal, {}), { name: 'AbortError' });
  assert.deepEqual(methods, ['POST']);
});


test('conditional RPC carries exact private evidence in the POST body and never a state URL filter', async () => {
  const state={'ai-fitness-fixture':{memo:'synthetic private next'}};
  const expected={'ai-fitness-fixture':{memo:'synthetic private before'}};
  const requests:Array<{url:string;method:string;body:unknown}>=[];
  const cloud=cloudWithFetch(async(url,init)=>{
    const target=String(url); requests.push({url:target,method:init?.method??'GET',body:init?.body?JSON.parse(String(init.body)):null});
    assert.equal(target.includes('synthetic private'),false); assert.equal(new URL(target).searchParams.has('p_state'),false); assert.equal(target.includes('state=eq'),false);
    return new Response(JSON.stringify(init?.method==='POST'?true:[{state,updated_at:'2026-10-09T12:00:01Z'}]),{status:200,headers:{'Content-Type':'application/json'}});
  });
  assert.equal(await cloud.saveRemoteStateIfUnchanged('synthetic-owner',state,'2026-10-09T12:00:00Z',undefined,expected),true);
  assert.deepEqual(requests[0],{url:'http://127.0.0.1:1/rest/v1/rpc/save_cloud_state_if_unchanged',method:'POST',body:{p_owner:'synthetic-owner',p_state:state,p_expected_updated_at:'2026-10-09T12:00:00Z',p_expected_state:expected}});
  assert.equal(requests[1].method,'GET');
  await cloud.saveRemoteState('synthetic-owner',state);
  assert.deepEqual(requests[2].body,{p_owner:'synthetic-owner',p_state:state,p_expected_updated_at:null,p_expected_state:null});
});
test('missing expected-state evidence cannot fall back to timestamp-only writes', async () => {
  let calls=0; const cloud=cloudWithFetch(async()=>{calls++;throw new Error('no fetch allowed');});
  await assert.rejects(cloud.saveRemoteStateIfUnchanged('synthetic-owner',{},'2026-10-09T12:00:00Z'),conflicts.CloudSyncConflictStaleError);
  assert.equal(calls,0);
});
test('CAS false and lost insert race preserve evidence without readback or overwrite retry', async () => {
  const calls:string[]=[]; const cloud=cloudWithFetch(async(url,init)=>{
    calls.push(String(url)); assert.equal(init?.method,'POST'); return new Response('false',{status:200,headers:{'Content-Type':'application/json'}});
  });
  assert.equal(await cloud.saveRemoteStateIfUnchanged('synthetic-owner',{},'2026-10-09T12:00:00Z',undefined,{}),false);
  assert.equal(calls.length,1); await assert.rejects(cloud.saveRemoteState('synthetic-owner',{}),/다른 기기의 새 기록/); assert.equal(calls.length,2);
  assert.ok(calls.every(url=>url.endsWith('/rpc/save_cloud_state_if_unchanged')));
});
test('missing RPC and provider error do not fallback or expose raw private error content', async () => {
  for(const status of [404,400]) {
    const calls:string[]=[]; const cloud=cloudWithFetch(async(url)=>{calls.push(String(url));return new Response(JSON.stringify({code:'PGRST202',message:'synthetic-owner memo PRIVATE-RECORD',details:'raw records'}),{status,headers:{'Content-Type':'application/json'}});});
    await assert.rejects(cloud.saveRemoteStateIfUnchanged('synthetic-owner',{},'2026-10-09T12:00:00Z',undefined,{}),error=>{
      assert.equal(String(error).includes('PRIVATE-RECORD'),false); assert.equal(String(error).includes('synthetic-owner'),false); return true;
    });
    assert.equal(calls.length,1); assert.ok(calls[0].endsWith('/rpc/save_cloud_state_if_unchanged'));
  }
});
test('malformed success responses and changed confirmation reads cannot produce an acknowledgement', async () => {
  for(const malformed of [null,{},[],1,'true']) {
    let calls=0; const cloud=cloudWithFetch(async()=>{calls++;return new Response(JSON.stringify(malformed),{status:200,headers:{'Content-Type':'application/json'}});});
    await assert.rejects(cloud.saveRemoteStateIfUnchanged('synthetic-owner',{},'2026-10-09T12:00:00Z',undefined,{})); assert.equal(calls,1);
  }
  const methods:string[]=[]; const cloud=cloudWithFetch(async(_url,init)=>{
    methods.push(init?.method??'GET'); return new Response(JSON.stringify(init?.method==='POST'?true:[{state:{'ai-fitness-fixture':'new peer edit'},updated_at:'new'}]),{status:200,headers:{'Content-Type':'application/json'}});
  });
  await assert.rejects(cloud.saveRemoteStateIfUnchanged('synthetic-owner',{},'2026-10-09T12:00:00Z',undefined,{}),/저장 후 서버 기록/); assert.deepEqual(methods,['POST','GET']);
});


test('legacy representation-only save compares the untouched raw wire state and verifies canonical readback', async () => {
  const key='ai-fitness-workout-completed-days';const raw=' {"2030-01-01":{"workoutMemo":"synthetic","unknown":[1,null,1]}} ';
  const expected={[key]:raw};const canonical=conflicts.classifyCloudSyncConflicts(expected,expected,{[key]:JSON.parse(raw)}).merged!;
  const calls:Array<{method:string;body:unknown}>=[];const cloud=cloudWithFetch(async(_url,init)=>{
    calls.push({method:init?.method??'GET',body:init?.body?JSON.parse(String(init.body)):null});return new Response(JSON.stringify(init?.method==='POST'?true:[{state:canonical,updated_at:'new'}]),{status:200,headers:{'Content-Type':'application/json'}});
  });
  assert.equal(await cloud.saveRemoteStateIfUnchanged('synthetic-owner',canonical,'2026-10-09T12:00:00Z',undefined,expected),true);
  assert.deepEqual(calls[0].body,{p_owner:'synthetic-owner',p_state:canonical,p_expected_updated_at:'2026-10-09T12:00:00Z',p_expected_state:expected});
  assert.equal(expected[key],raw);assert.deepEqual(calls.map(call=>call.method),['POST','GET']);
});
test('malformed legacy record maps fail before network without changing original input', async () => {
  const key='ai-fitness-workout-completed-days';let calls=0;const cloud=cloudWithFetch(async()=>{calls++;throw new Error('must not fetch');});
  for(const invalid of ['{broken','[]','null','12',JSON.stringify('{}')]) {
    const state={[key]:invalid};await assert.rejects(cloud.saveRemoteState('synthetic-owner',state),conflicts.CloudSyncLegacyEncodingError);assert.deepEqual(state,{[key]:invalid});
    await assert.rejects(cloud.saveRemoteStateIfUnchanged('synthetic-owner',{},'2026-10-09T12:00:00Z',undefined,state),conflicts.CloudSyncLegacyEncodingError);
  }
  assert.equal(calls,0);
});


test('out-of-contract root state fails with a fixed message before POST or acknowledgement', async () => {
  const calls:string[]=[];const invalid={unrelated:{memo:'NEVER-LOG-THIS'}};const cloud=cloudWithFetch(async(_url,init)=>{
    calls.push(init?.method??'GET');return new Response(JSON.stringify([{state:invalid,updated_at:'2026-10-09T12:00:00Z'}]),{status:200,headers:{'Content-Type':'application/json'}});
  });
  const fixed=(error:unknown)=>{assert.equal((error as Error).name,'CloudSyncNamespaceError');assert.equal(String(error).includes('NEVER-LOG-THIS'),false);return true;};
  await assert.rejects(cloud.saveRemoteState('synthetic-owner',invalid),fixed);
  await assert.rejects(cloud.saveRemoteStateIfUnchanged('synthetic-owner',invalid,'2026-10-09T12:00:00Z',undefined,{}),fixed);
  await assert.rejects(cloud.saveRemoteStateIfUnchanged('synthetic-owner',{},'2026-10-09T12:00:00Z',undefined,invalid),fixed);
  assert.deepEqual(calls,[]);await assert.rejects(cloud.getRemoteState('synthetic-owner'),fixed);assert.deepEqual(calls,['GET']);
});
