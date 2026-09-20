import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import * as voice from '../lib/yeoni-voice-policy.ts';

const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const key = 'synthetic-key-only', fingerprint = crypto.createHash('sha256').update(key).digest('hex');
const migration = '../supabase/migrations/20260915011629_zephyr_free_character_guard.sql';
type Result = Record<string, unknown>;
let month: string;
let authenticated = true, budgetCalls = 0, googleCalls = 0;
let failure: 'none' | 'lost-grant' | 'google-network' | 'google-http' | 'bad-audio' | 'expired-grant' | 'wrong-grant' = 'none';
let env: Record<string, string>;
let edgeHandler: (request: Request) => Promise<Response>;
let route: { POST: (request: Request) => Promise<Response>; GET: () => Promise<Response> };

function moduleAt(path: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(exports,require){${code}\n})`, {
    Request, Response, TextDecoder, Uint8Array, AbortSignal, Error, console, ...globals,
  })(exports, (name: string) => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; });
  return exports;
}
const callRpc = async (name: string, args: Result) => {
  try {
    const result = name === 'zephyr_free_status'
      ? await db.query<{result: Result}>('select public.zephyr_free_status($1) result', [args.p_key_fingerprint])
      : await db.query<{result: Result}>('select public.reserve_zephyr_characters($1,$2,$3,$4) result', [args.p_user_id,args.p_request_id,args.p_text,args.p_key_fingerprint]);
    return { data: result.rows[0].result, error: null };
  } catch { return { data: null, error: { message: 'Synthetic DB failure' } }; }
};
const reserve = async (id = randomUUID(), text = '가😀 나', user = owner, hash = fingerprint) => (await callRpc('reserve_zephyr_characters', { p_user_id: user, p_request_id: id, p_text: text, p_key_fingerprint: hash })).data!;
const balance = async () => (await db.query<{reserved_chars:number}>('select reserved_chars from public.zephyr_free_months where month=$1',[month])).rows[0].reserved_chars;
const request = (id = randomUUID(), text = '가😀 나') => new Request('https://fixture.local/api/tts', { method:'POST', body:JSON.stringify({text,requestId:id}) });
const age = async () => { await db.exec("reset role; update public.zephyr_character_requests set reserved_at=clock_timestamp()-interval '10 seconds'; set role service_role;"); };

before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}');
    grant usage on schema auth,public to service_role,authenticated,anon;`);
  await db.exec(readFileSync(new URL(migration, import.meta.url), 'utf8'));
  month = (await db.query<{month:string}>("select to_char(date_trunc('month',clock_timestamp() at time zone 'America/Los_Angeles'),'YYYY-MM-DD') as month")).rows[0].month;
});
after(async () => { await db.close(); });
beforeEach(async () => {
  authenticated = true; failure = 'none'; budgetCalls = 0; googleCalls = 0;
  env = { GOOGLE_TTS_FREE_ENABLED:'true', GOOGLE_TTS_API_KEY:key, PAID_AI_ENABLED:'true' };
  await db.exec(`reset role; truncate public.zephyr_character_requests,public.zephyr_free_months;
    insert into auth.users values('${owner}'),('${other}') on conflict do nothing;`);
  await db.query(`insert into public.zephyr_free_months(month,enabled,key_fingerprint,billing_project_id,billing_account_id,verified_at,valid_until,external_used_chars,external_reserved_chars)
    values($1,true,$2,'synthetic-project','synthetic-account',clock_timestamp(),($1::date+interval '1 month')::timestamp at time zone 'America/Los_Angeles',61,100000)`,[month,fingerprint]);
  await db.exec('set role service_role;');
  const auth = { getUser:async () => ({data:{user:authenticated ? {id:owner} : null},error:null}) };
  moduleAt('../supabase/functions/zephyr-budget/index.ts', {
    'jsr:@supabase/functions-js/edge-runtime.d.ts': {},
    'https://esm.sh/@supabase/supabase-js@2.110.8': { createClient: (_url:string, credential:string) => credential === 'service' ? { rpc:callRpc } : {auth} },
  }, { Deno:{ env:{get:(name:string) => name==='SUPABASE_SERVICE_ROLE_KEY'?'service':'synthetic'}, serve:(handler:typeof edgeHandler)=>{edgeHandler=handler;} } });
  const client = { auth, functions:{invoke:async (name:string, options:{body:Result; timeout:number}) => {
    budgetCalls++; assert.equal(name,'zephyr-budget'); assert.equal(options.timeout,8000);
    const response = await edgeHandler(new Request('https://fixture.local/edge',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify(options.body)}));
    const data=await response.json();
    if(failure==='lost-grant') return {data:null,error:new Error('Lost response after commit')};
    if(failure==='expired-grant') data.sendBefore=new Date(Date.now()-1).toISOString();
    if(failure==='wrong-grant') data.characters=1;
    return {data,error:response.ok?null:new Error('Edge failed')};
  } } };
  const server = moduleAt('../lib/zephyr-free-server.ts', {'node:crypto':crypto}, {process:{env}});
  route = moduleAt('../app/api/tts/route.ts', {
    'next/server':{NextResponse:{json:Response.json}}, '@/lib/yeoni-voice-policy':voice,
    '@/lib/supabase-server':{createServerSupabaseClient:async()=>client}, '@/lib/zephyr-free-server':server,
  }, {fetch:async (url:string, options:RequestInit) => {
    googleCalls++; assert.equal(await balance(),4);
    assert.equal(url,'https://texttospeech.googleapis.com/v1/text:synthesize');
    assert.equal(options.redirect,'error'); assert.equal(options.cache,'no-store'); assert.ok(options.signal);
    assert.equal((options.headers as Record<string,string>)['x-goog-api-key'],key);
    const payload=JSON.parse(options.body as string);
    assert.deepEqual(payload,{input:{text:'가😀 나'},voice:{languageCode:'ko-KR',name:voice.YEONI_VOICE_NAME},audioConfig:{audioEncoding:'MP3'}});
    if(failure==='google-network') throw new Error('Synthetic lost provider response');
    if(failure==='google-http') return Response.json({error:'synthetic'},{status:500});
    return Response.json({audioContent:failure==='bad-audio'?'':'c3ludGhldGlj'});
  }}) as typeof route;
});

test('disabled switch, absent/wrong key, missing month, unverified pool and unauthenticated calls never reach Google', async () => {
  delete env.GOOGLE_TTS_FREE_ENABLED;
  assert.equal((await route.POST(request())).status,503); assert.equal(budgetCalls,0);
  assert.equal((await (await route.GET()).json()).enabled,false); assert.equal(budgetCalls,0);
  env.GOOGLE_TTS_FREE_ENABLED='true'; delete env.GOOGLE_TTS_API_KEY;
  assert.equal((await route.POST(request())).status,503); assert.equal(budgetCalls,0);
  env.GOOGLE_TTS_API_KEY='another-key'; assert.equal((await route.POST(request())).status,503);
  env.GOOGLE_TTS_API_KEY=key;
  await db.exec('update public.zephyr_free_months set enabled=false;');
  assert.equal((await route.POST(request())).status,503);
  await db.exec('reset role; truncate public.zephyr_free_months cascade; set role service_role;');
  assert.equal((await route.POST(request())).status,503);
  authenticated=false;
  assert.equal((await route.POST(request())).status,401); assert.equal((await route.GET()).status,401);
  assert.equal(googleCalls,0);
});

test('successful Unicode request commits four characters first; replay never generates again; status is reservation count, not cost', async () => {
  const id=randomUUID(); const response=await route.POST(request(id)); assert.equal(response.status,200);
  const body=await response.json(); assert.equal(body.voice,voice.YEONI_VOICE_NAME); assert.equal(body.useDeviceVoice,false);
  assert.equal(body.reservedCharacters,4); assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await route.POST(request(id))).status,409); assert.equal(googleCalls,1); assert.equal(await balance(),4);
  const result=await (await route.GET()).json(); assert.equal(result.reservedCharacters,4); assert.equal(result.remainingCharacters,99996);
  assert.equal('actualCostKrw' in result,false); assert.equal('keyFingerprint' in result,false);
  const receipt=(await db.query<{text_sha256:string}>('select text_sha256 from public.zephyr_character_requests')).rows[0];
  assert.equal(receipt.text_sha256,crypto.createHash('sha256').update('가😀 나').digest('hex'));
});

for(const mode of ['lost-grant','google-network','google-http','bad-audio','expired-grant','wrong-grant'] as const) {
  test(`${mode} never refunds committed allowance or retries an ambiguous provider call`, async () => {
    failure=mode; const id=randomUUID();
    assert.ok((await route.POST(request(id))).status>=500); assert.equal(await balance(),4);
    const expected=['google-network','google-http','bad-audio'].includes(mode)?1:0;
    assert.equal(googleCalls,expected); failure='none';
    assert.equal((await route.POST(request(id))).status,409); assert.equal(googleCalls,expected); assert.equal(await balance(),4);
  });
}

test('shared monthly cap rejects an overshoot across users; daily and rapid repeats also fail before generation', async () => {
  await db.exec('update public.zephyr_free_months set app_limit_chars=7;');
  assert.equal((await reserve()).allowed,true);
  assert.equal((await reserve(randomUUID(),'가😀 나',other)).code,'MONTH_LIMIT'); assert.equal(await balance(),4);
  await db.exec('update public.zephyr_free_months set app_limit_chars=100000;');
  assert.equal((await reserve()).code,'TOO_FAST'); await age();
  for(let i=0;i<4;i++){assert.equal((await reserve(randomUUID(),'나'.repeat(1200))).allowed,true);await age();}
  assert.equal((await reserve(randomUUID(),'나'.repeat(197))).code,'DAY_LIMIT'); assert.equal(await balance(),4804);
  assert.equal((await reserve(randomUUID(),'가😀 나',other)).allowed,true);
});

test('expired verification, month boundary safety window and old month approval never renew automatically', async () => {
  await db.exec("update public.zephyr_free_months set valid_until=clock_timestamp()+interval '1 minute';");
  assert.equal((await reserve()).code,'CONFIRMATION_REQUIRED'); assert.equal(await balance(),0);
  await db.exec("reset role; update public.zephyr_free_months set enabled=false,month=month-interval '1 month'; set role service_role;");
  assert.equal((await reserve()).code,'CONFIRMATION_REQUIRED');
  assert.equal((await callRpc('zephyr_free_status',{p_key_fingerprint:fingerprint})).data?.allowed,false);
});

test('receipts survive account deletion and cannot be reused by another account or in another month', async () => {
  const id=randomUUID(); assert.equal((await reserve(id)).allowed,true);
  await db.exec(`reset role; delete from auth.users where id='${owner}'; set role service_role;`);
  assert.equal(await balance(),4);
  assert.equal((await reserve(id,'changed',other)).code,'DUPLICATE_REQUEST');
  await db.exec("reset role; insert into public.zephyr_free_months(month) select month-interval '1 month' from public.zephyr_free_months; update public.zephyr_character_requests set month=month-interval '1 month'; set role service_role;");
  assert.equal((await reserve(id,'changed',other)).code,'DUPLICATE_REQUEST');
});

test('untrusted roles cannot read, configure, reserve, refund or erase receipts; incomplete or oversized approval is rejected', async () => {
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role};`);
    await assert.rejects(db.query('select * from public.zephyr_free_months'));
    await assert.rejects(db.query('select * from public.zephyr_character_requests'));
    assert.ok((await callRpc('reserve_zephyr_characters',{p_user_id:owner,p_request_id:randomUUID(),p_text:'나',p_key_fingerprint:fingerprint})).error);
    await assert.rejects(db.query('update public.zephyr_free_months set reserved_chars=0'));
  }
  await db.exec('set role service_role;');
  await assert.rejects(db.query('update public.zephyr_free_months set key_fingerprint=null'));
  await assert.rejects(db.query('update public.zephyr_free_months set external_reserved_chars=null'));
  await assert.rejects(db.query('update public.zephyr_free_months set external_used_chars=900000'));
  await assert.rejects(db.query('update public.zephyr_free_months set app_limit_chars=100001'));
  await assert.rejects(db.query('delete from public.zephyr_character_requests'));
  const functions=(await db.query<{prosecdef:boolean}>("select prosecdef from pg_proc where proname in ('reserve_zephyr_characters','zephyr_free_status')")).rows;
  assert.equal(functions.length,2); assert.ok(functions.every(row=>!row.prosecdef));
});

test('body limits, missing request IDs, malicious character counts and user IDs cannot cross trust boundaries', async () => {
  assert.equal((await route.POST(request(randomUUID(),'나'.repeat(1201)))).status,400);
  assert.equal((await route.POST(new Request('https://fixture.local/api/tts',{method:'POST',body:JSON.stringify({text:'나'})}))).status,400);
  assert.equal((await route.POST(new Request('https://fixture.local/api/tts',{method:'POST',body:'x'.repeat(20001)}))).status,413);
  const edge=(body:unknown)=>edgeHandler(new Request('https://fixture.local/edge',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify(body)}));
  assert.equal((await edge({action:'cancel',requestId:randomUUID(),keyFingerprint:fingerprint})).status,400);
  const accepted=await edge({action:'reserve',requestId:randomUUID(),text:'가😀 나',keyFingerprint:fingerprint,userId:other,characters:1});
  assert.equal(accepted.status,200); assert.equal((await accepted.json()).characters,4);
  assert.equal((await db.query<{user_id:string}>('select user_id from public.zephyr_character_requests')).rows[0].user_id,owner);
  assert.equal(googleCalls,0);
});
