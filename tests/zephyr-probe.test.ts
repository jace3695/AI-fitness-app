import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import * as voice from '../lib/yeoni-voice-policy.ts';

const db = new PGlite();
const owner='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002';
const key='synthetic-probe-key';
type Data=Record<string, unknown>;
let env:Record<string,string>, userId:string|null, calls:number, mode:string;
let ids:string[];
let route:{GET:()=>Promise<Response>;POST:(req:Request)=>Promise<Response>};
let edge:(req:Request)=>Promise<Response>;
let constants:{ZEPHYR_PROBE_TEXT:string;ZEPHYR_PROBE_CHARACTERS:number};

function moduleAt(path:string, imports:Record<string,unknown>, globals:Record<string,unknown>={}) {
  const exports={};
  const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(`(function(exports,require){${code}\n})`,{Request,Response,TextDecoder,Uint8Array,AbortSignal,Error,...globals})(exports,(name:string)=>{
    assert.ok(name in imports,`Unexpected import ${name}`);return imports[name];
  }); return exports;
}
const rpc=async(name:string,args:Data)=>{
  try {
    const result=name==='zephyr_probe_status'
      ? await db.query<{result:Data}>('select public.zephyr_probe_status($1) result',[args.p_user_id])
      : await db.query<{result:Data}>('select public.reserve_zephyr_probe($1,$2,$3) result',[args.p_user_id,args.p_request_id,args.p_key_fingerprint]);
    return {data:result.rows[0].result,error:null};
  }catch{return {data:null,error:new Error('DB failure')};}
};
const request=(id=ids[0], extra:Data={})=>new Request('https://fixture.local/api/tts/probe',{method:'POST',body:JSON.stringify({requestId:id,...extra})});
const count=async()=>Number((await db.query<{count:number}>('select count(*) as count from public.zephyr_probe_slots where reserved_at is not null')).rows[0].count);

before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260915025439_zephyr_three_call_probe.sql',import.meta.url),'utf8'));
});
after(async()=>{await db.close();});
beforeEach(async()=>{
  env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'fix/app-wide-reliability',GOOGLE_TTS_API_KEY:key};
  userId=owner;calls=0;mode='normal';
  await db.exec(`reset role;truncate public.zephyr_probe_slots;
    insert into auth.users values('${owner}'),('${other}') on conflict do nothing;
    insert into public.zephyr_probe_slots(slot,user_id,expires_at)
      select s,'${owner}',clock_timestamp()+interval '2 hours' from generate_series(1,3) s;set role service_role;`);
  ids=(await db.query<{request_id:string}>('select request_id from public.zephyr_probe_slots order by slot')).rows.map(row=>row.request_id);
  const auth={getUser:async()=>({data:{user:userId?{id:userId}:null},error:null})};
  moduleAt('../supabase/functions/zephyr-probe/index.ts',{
    'jsr:@supabase/functions-js/edge-runtime.d.ts':{},
    'https://esm.sh/@supabase/supabase-js@2.110.8':{createClient:(_url:string,credential:string)=>credential==='service'?{rpc}:{auth}},
  },{Deno:{env:{get:(name:string)=>name==='SUPABASE_SERVICE_ROLE_KEY'?'service':'synthetic'},serve:(handler:typeof edge)=>{edge=handler;}}});
  const client={auth,functions:{invoke:async(name:string,options:{body:Data;timeout:number})=>{
    assert.equal(name,'zephyr-probe');assert.equal(options.timeout,8000);
    const response=await edge(new Request('https://fixture.local/edge',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify(options.body)}));
    const data=await response.json();
    if(mode==='lost-grant') return {data:null,error:new Error('Lost response')};
    if(mode==='stale-grant') data.sendBefore=new Date(Date.now()-1).toISOString();
    return {data,error:response.ok?null:new Error('Edge failed')};
  }}};
  constants=moduleAt('../lib/zephyr-probe.ts',{}, {process:{env}}) as typeof constants;
  const shared=moduleAt('../lib/zephyr-free-server.ts',{'node:crypto':crypto},{process:{env}});
  route=moduleAt('../app/api/tts/probe/route.ts',{
    'node:crypto':crypto,'next/server':{NextResponse:{json:Response.json}},
    '@/lib/supabase-server':{createServerSupabaseClient:async()=>client},
    '@/lib/yeoni-voice-policy':voice,'@/lib/zephyr-free-server':shared,'@/lib/zephyr-probe':constants,
  },{process:{env},fetch:async(url:string,options:RequestInit)=>{
    calls++;assert.ok(await count()>=calls);
    assert.equal(url,'https://texttospeech.googleapis.com/v1/text:synthesize');
    assert.equal((options.headers as Record<string,string>)['x-goog-api-key'],key);
    assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(options.signal);
    assert.deepEqual(JSON.parse(options.body as string),{input:{text:constants.ZEPHYR_PROBE_TEXT},voice:{languageCode:'ko-KR',name:voice.YEONI_VOICE_NAME},audioConfig:{audioEncoding:'MP3'}});
    if(mode==='network')throw new Error('Provider response lost');
    if(mode==='http')return Response.json({error:'sensitive provider details'},{status:403});
    return Response.json({audioContent:mode==='audio'?'':'c3ludGhldGlj'});
  }}) as typeof route;
});

test('only the selected Preview branch, authenticated owner and configured key can reach the provider',async()=>{
  env.VERCEL_ENV='production';assert.equal((await route.POST(request())).status,404);assert.equal((await route.GET()).status,404);
  env.VERCEL_ENV='preview';env.VERCEL_GIT_COMMIT_REF='main';assert.equal((await route.POST(request())).status,404);
  env.VERCEL_GIT_COMMIT_REF='fix/app-wide-reliability';userId=null;assert.equal((await route.POST(request())).status,401);
  userId=other;assert.equal((await route.POST(request())).status,409);assert.deepEqual((await(await route.GET()).json()).slots,[]);
  userId=owner;delete env.GOOGLE_TTS_API_KEY;assert.equal((await route.POST(request())).status,503);
  const status=await(await route.GET()).json();assert.equal(status.configured,false);assert.ok(status.slots.every((slot:{available:boolean})=>!slot.available));
  assert.equal(calls,0);assert.equal(await count(),0);
});

test('exactly three 61-character calls are available; concurrent repeats and arbitrary IDs cannot add calls',async()=>{
  assert.equal(constants.ZEPHYR_PROBE_CHARACTERS,61);
  const simultaneous=await Promise.all([route.POST(request()),route.POST(request())]);
  assert.deepEqual(simultaneous.map(r=>r.status).sort(),[200,409]);
  for(const id of ids.slice(1))assert.equal((await route.POST(request(id))).status,200);
  for(const id of [...ids,crypto.randomUUID()])assert.equal((await route.POST(request(id))).status,409);
  assert.equal(calls,3);assert.equal(await count(),3);
  const response=await route.GET();const result=await response.json();
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(JSON.stringify(result).includes(key),false);
  assert.equal('keyFingerprint' in result,false);assert.ok(result.slots.every((slot:{available:boolean})=>!slot.available));
});

for(const failure of ['lost-grant','stale-grant','network','http','audio'])test(`${failure}: no refund or automatic provider retry`,async()=>{
  mode=failure;const response=await route.POST(request());assert.ok(response.status>=500);
  assert.equal(await count(),1);const expected=['network','http','audio'].includes(failure)?1:0;assert.equal(calls,expected);
  const body=await response.json();assert.equal(JSON.stringify(body).includes('sensitive provider details'),false);
  mode='normal';assert.equal((await route.POST(request())).status,409);assert.equal(calls,expected);
});

test('expired/absent grants and altered text never generate; account deletion retains consumed slots',async()=>{
  assert.equal((await route.POST(request(ids[0],{text:'arbitrary text'}))).status,400);assert.equal(calls,0);
  await db.exec("reset role;update public.zephyr_probe_slots set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 minute';set role service_role;");
  assert.equal((await route.POST(request())).status,409);assert.equal(calls,0);
  await db.exec("reset role;update public.zephyr_probe_slots set expires_at=clock_timestamp()+interval '1 hour';set role service_role;");
  assert.equal((await route.POST(request())).status,200);
  await db.exec(`reset role;delete from auth.users where id='${owner}';set role service_role;`);
  userId=other;assert.equal((await route.POST(request())).status,409);assert.equal(await count(),1);
});

test('normal roles cannot read or consume grants; service role cannot add a fourth slot, reset expiry or delete receipts',async()=>{
  for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role};`);await assert.rejects(db.query('select * from public.zephyr_probe_slots'));
    assert.ok((await rpc('reserve_zephyr_probe',{p_user_id:owner,p_request_id:ids[0],p_key_fingerprint:'a'.repeat(64)})).error);
  }
  await db.exec('set role service_role;');
  await assert.rejects(db.query('insert into public.zephyr_probe_slots(slot,expires_at) values(1,clock_timestamp())'));
  await assert.rejects(db.query("update public.zephyr_probe_slots set expires_at=clock_timestamp()+interval '1 day'"));
  await assert.rejects(db.query('delete from public.zephyr_probe_slots'));
  await db.exec('reset role;');
  await assert.rejects(db.query("insert into public.zephyr_probe_slots(slot,expires_at) values(4,clock_timestamp()+interval '1 hour')"));
});
