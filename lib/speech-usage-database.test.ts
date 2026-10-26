import test from 'node:test';
import assert from 'node:assert/strict';
import {rootCertificates} from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {getEventListeners} from 'node:events';
import {createSpeechDatabasePool,createSpeechUsageDatabaseClient,type SpeechDatabaseFactory,type SpeechDatabaseDriver} from './speech-usage-database.ts';
const ca=rootCertificates.find(value=>{const c=new X509Certificate(value);return c.ca&&Date.parse(c.validFrom)<=Date.now()&&Date.parse(c.validTo)>Date.now()})!;
const env=()=>({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'agent/fitness-record-priority',NEXT_PUBLIC_SUPABASE_URL:'https://piqqukiiacncfbztktga.supabase.co',YEONI_SPEECH_USAGE_POOLER_HOST:'aws-0-ap-northeast-2.pooler.supabase.com',YEONI_SPEECH_USAGE_DATABASE_URL:'postgresql://yeoni_speech_usage_login.piqqukiiacncfbztktga:synthetic-password-not-real@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres',YEONI_SPEECH_USAGE_CA_CERT:ca});
const params={p_owner_id:'00000000-0000-4000-8000-000000000001',p_resource_name:'yeoni-speech-jace',p_region:'koreacentral'};
const ready='is_yeoni_speech_usage_ready';
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve}};

test('missing/misbound credentials, administrator username, unverified TLS or URL options fail before driver creation',()=>{
 let made=0;const factory:SpeechDatabaseFactory=()=>{made++;throw Error('forbidden')};
 for(const patch of [{YEONI_SPEECH_USAGE_DATABASE_URL:undefined},{YEONI_SPEECH_USAGE_CA_CERT:undefined},{YEONI_SPEECH_USAGE_CA_CERT:'invalid'},{YEONI_SPEECH_USAGE_POOLER_HOST:'other.example'},{YEONI_SPEECH_USAGE_DATABASE_URL:env().YEONI_SPEECH_USAGE_DATABASE_URL.replace('yeoni_speech_usage_login.piqqukiiacncfbztktga','postgres.piqqukiiacncfbztktga')},{YEONI_SPEECH_USAGE_DATABASE_URL:env().YEONI_SPEECH_USAGE_DATABASE_URL+'?sslmode=disable'},{VERCEL_ENV:'production'}])assert.throws(()=>createSpeechUsageDatabaseClient({...env(),...patch},{factory,pool:createSpeechDatabasePool()}));assert.equal(made,0);
});

test('lazy shared pool uses exact login/host, verified TLS, max one connection, no prepared statements/pipelining; only fixed parameterized SQL',async()=>{
 let made=0,calls=0;const pool=createSpeechDatabasePool(),factory:SpeechDatabaseFactory=options=>{
  made++;assert.equal(options.max,1);assert.equal(options.max_pipeline,1);assert.equal(options.prepare,false);assert.equal(options.fetch_types,false);assert.equal(options.username,'yeoni_speech_usage_login.piqqukiiacncfbztktga');assert.equal(options.host,env().YEONI_SPEECH_USAGE_POOLER_HOST);assert.equal(options.port,6543);assert.equal(options.debug,false);
  const ssl=options.ssl as{rejectUnauthorized:boolean;servername:string;ca:string};assert.equal(ssl.rejectUnauthorized,true);assert.equal(ssl.servername,options.host);assert.equal(ssl.ca,ca);
  return{unsafe:async(text,values,o)=>{calls++;assert.equal(text,'select yeoni_speech_usage.ready($1::uuid,$2::text,$3::text) as result');assert.deepEqual(values,Object.values(params));assert.equal(o.prepare,false);return[{result:true}]},end:async()=>{}};
 };const first=createSpeechUsageDatabaseClient(env(),{pool,factory}),second=createSpeechUsageDatabaseClient(env(),{pool,factory});assert.equal(made,0);assert.equal((await first.rpc(ready,params).abortSignal(new AbortController().signal)).data,true);assert.equal((await second.rpc(ready,params).abortSignal(new AbortController().signal)).data,true);assert.equal(made,1);assert.equal(calls,2);
 for(const [name,p]of [['reconcile',params],[ready,{...params,sql:'select private'}]] as const)assert.ok((await first.rpc(name,p).abortSignal(new AbortController().signal)).error);assert.equal(calls,2);
});

test('abort ignores late SQL result and retires only its own pool; no query.cancel race or connection reuse before work AND close settle',async()=>{
 const work=deferred<readonly {result:unknown}[]>(),closed=deferred<void>(),pool=createSpeechDatabasePool();let made=0,ends=0,calls=0;
 const factory:SpeechDatabaseFactory=()=>{made++;return{unsafe:()=>{calls++;return made===1?work.promise:Promise.resolve([{result:true}])},end:()=>{ends++;return closed.promise}}};
 const client=createSpeechUsageDatabaseClient(env(),{pool,factory}),controller=new AbortController(),before=getEventListeners(controller.signal,'abort').length;
 const pending=Promise.resolve(client.rpc(ready,params).abortSignal(controller.signal));await new Promise(r=>setImmediate(r));assert.equal(calls,1);controller.abort();assert.ok((await pending).error);assert.equal(ends,1);assert.equal(getEventListeners(controller.signal,'abort').length,before);
 assert.ok((await client.rpc(ready,params).abortSignal(new AbortController().signal)).error);assert.equal(made,1);closed.resolve();await new Promise(r=>setImmediate(r));assert.equal(pool.retiring,true);
 work.resolve([{result:true}]);await new Promise(r=>setImmediate(r));assert.equal(pool.retiring,false);assert.equal((await client.rpc(ready,params).abortSignal(new AbortController().signal)).data,true);assert.equal(made,2);
});

test('five-second total bounds hanging SQL, sanitizes diagnostics and never retries the query',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0,ends=0;const pool=createSpeechDatabasePool(),work=deferred<readonly {result:unknown}[]>();const driver:SpeechDatabaseDriver={unsafe:()=>{calls++;return work.promise},end:async()=>{ends++;}};
 const client=createSpeechUsageDatabaseClient(env(),{pool,factory:()=>driver}),signal=new AbortController().signal;const pending=Promise.resolve(client.rpc(ready,params).abortSignal(signal));await new Promise(r=>setImmediate(r));t.mock.timers.tick(5000);assert.ok((await pending).error);assert.equal(calls,1);assert.equal(ends,1);assert.equal(pool.retiring,true);work.resolve([{result:true}]);await new Promise(r=>setImmediate(r));assert.equal(pool.retiring,false);
 const bad=createSpeechUsageDatabaseClient(env(),{pool:createSpeechDatabasePool(),factory:()=>({unsafe:async()=>{throw Error(env().YEONI_SPEECH_USAGE_DATABASE_URL)},end:async()=>{}})});const result=await bad.rpc(ready,params).abortSignal(signal);assert.ok(result.error);assert.ok(!JSON.stringify(result).includes('synthetic-password'));
});

test('pre-aborted or overlapping work does not queue a second SQL statement; malformed results retire the connection',async()=>{
 let calls=0;const pool=createSpeechDatabasePool(),work=deferred<readonly {result:unknown}[]>(),factory:SpeechDatabaseFactory=()=>({unsafe:()=>{calls++;return work.promise},end:async()=>{}});
 const client=createSpeechUsageDatabaseClient(env(),{pool,factory}),controller=new AbortController();controller.abort();assert.ok((await client.rpc(ready,params).abortSignal(controller.signal)).error);assert.equal(calls,0);
 const first=Promise.resolve(client.rpc(ready,params).abortSignal(new AbortController().signal));await new Promise(r=>setImmediate(r));assert.ok((await client.rpc(ready,params).abortSignal(new AbortController().signal)).error);assert.equal(calls,1);work.resolve([{result:'not-a-readiness-boolean'}]);assert.ok((await first).error);
});
