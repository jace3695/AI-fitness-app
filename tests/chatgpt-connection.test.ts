import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { authorizationMetadata, CHATGPT_CLIENT_ID, CHATGPT_PREVIEW_ORIGIN, CHATGPT_REDIRECT, connectorOrigin, CONNECT_SCOPES, parseConnectRequest, protectedResourceMetadata } from '../lib/chatgpt-connection.ts';
import { serveMcp } from '../lib/chatgpt-mcp.ts';

const db = new PGlite(); const owner = randomUUID(), other = randomUUID(), session = randomUUID(), otherSession = randomUUID();
const resource = `${CHATGPT_PREVIEW_ORIGIN}/mcp`;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
type Json = Record<string, any>;
const sql = async (query: string, values: any[] = []) => (await db.query<{result: any}>(query, values)).rows[0]?.result;
const identify = (id = owner, sid = session) => db.exec(`reset role; set app.test_user='${id}'; set app.test_session='${sid}'; set role authenticated;`);
const anonymous = () => db.exec("reset role; set app.test_user=''; set app.test_session=''; set role anon;");
const tool = (token: string, name: string, args: Json = {}, target = resource) => sql('select public.chatgpt_tool($1,$2,$3,$4) result',[token,target,name,args]);
const authorize = async (areas = ['budget'], scopes = [...CONNECT_SCOPES]) => {
  const verifier = randomBytes(32).toString('base64url'); const challenge = createHash('sha256').update(verifier).digest('base64url');
  const data = await sql('select public.chatgpt_authorize($1,$2,$3,$4,$5) result',[resource,CHATGPT_CLIENT_ID,scopes,areas,challenge]);
  return { ...data, verifier };
};
const exchange = (code: string, verifier: string, target = resource, client = CHATGPT_CLIENT_ID, redirect = CHATGPT_REDIRECT) => sql('select public.chatgpt_exchange($1,$2,$3,$4,$5,$6) result',['authorization_code',code,client,target,verifier,redirect]);
const refresh = (token: string) => sql('select public.chatgpt_exchange($1,$2,$3,$4) result',['refresh_token',token,CHATGPT_CLIENT_ID,resource]);
const connected = async (areas = ['budget'], scopes = [...CONNECT_SCOPES]) => {
  const grant = await authorize(areas,scopes); await anonymous();
  const tokens = await exchange(grant.code,grant.verifier); assert.ok(tokens.access_token, JSON.stringify(tokens));
  return { ...grant,...tokens };
};
const saveArgs = (snapshot: Json, body = '기록된 소비 합계를 확인하고 다음 지출을 계획해 보세요.') => ({request_id:randomUUID(),snapshot_id:snapshot.snapshot_id,title:'소비 기록 조언',body});

before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('session_id',nullif(current_setting('app.test_session',true),'')) $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
  await db.exec(read('./e2e/schema.sql'));
  await db.exec(read('../supabase/migrations/20260914113147_budget_category_history.sql'));
  await db.exec(read('../supabase/migrations/20260915034857_assistant_task_command_history.sql'));
  await db.exec(read('../supabase/migrations/20260915052413_chatgpt_scoped_connection.sql'));
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade; insert into auth.users(id) values('${owner}'),('${other}');
    insert into auth.sessions(id,user_id) values('${session}','${owner}'),('${otherSession}','${other}');`);
  await identify();
  await db.query('insert into public.user_app_state(user_id) values($1)',[owner]);
  await db.query('insert into public.language_user_state(user_id) values($1)',[owner]);
  await db.query("insert into public.budget_transactions(user_id,date,amount,place,category,memo) values($1,(now() at time zone 'Asia/Seoul')::date,12000,'비공개 상호','식비','숨겨야 할 원문')",[owner]);
});

test('OAuth exchanges PKCE once, stores no raw secrets, and exposes only allowed aggregate numbers', async () => {
  const g = await connected(); const snapshot = await tool(g.access_token,'read_record_summary',{area:'budget',days:7});
  assert.equal(snapshot.summary.metrics['지출 합계 원'],12000); assert.ok(snapshot.snapshot_id);
  assert.doesNotMatch(JSON.stringify(snapshot), /비공개 상호|숨겨야 할 원문|user_id/);
  await assert.rejects(db.query('select * from yeoni_connector.tokens'));
  await db.exec('reset role');
  const tokens = await sql("select jsonb_agg(to_jsonb(t)) result from yeoni_connector.tokens t");
  assert.doesNotMatch(JSON.stringify(tokens), new RegExp(`${g.access_token}|${g.refresh_token}|${g.code}`));
});
test('wrong PKCE, redirect, client and audience cannot redeem or burn a valid authorization code', async () => {
  const g = await authorize(); await anonymous();
  for (const args of [[g.code,'x'.repeat(43)], [g.code,g.verifier,'https://evil.example/mcp'], [g.code,g.verifier,resource,'evil'], [g.code,g.verifier,resource,CHATGPT_CLIENT_ID,'https://evil.example/callback']]) {
    assert.equal((await exchange(...args as [string,string])).error,'invalid_grant');
  }
  assert.ok((await exchange(g.code,g.verifier)).access_token);
});
test('reused authorization code revokes the issued capability', async () => {
  const g = await connected(); assert.equal((await exchange(g.code,g.verifier)).error,'invalid_grant');
  assert.equal((await tool(g.access_token,'check')).error,'invalid_token');
});
test('refresh rotates once; reuse revokes every token in that connection', async () => {
  const g = await connected(); const next = await refresh(g.refresh_token); assert.ok(next.access_token);
  assert.notEqual(next.refresh_token,g.refresh_token); assert.ok((await tool(next.access_token,'check')).scopes);
  assert.equal((await refresh(g.refresh_token)).error,'invalid_grant');
  assert.equal((await tool(next.access_token,'check')).error,'invalid_token');
});
test('expired code, access token and grant are refused', async () => {
  const pending = await authorize(); await db.exec('reset role');
  await db.query("update yeoni_connector.grants set code_expires_at=now()-interval '1 second' where id=$1",[pending.connection_id]);
  await anonymous(); assert.equal((await exchange(pending.code,pending.verifier)).error,'invalid_grant');
  await identify(); const g = await connected(); await db.exec('reset role');
  await db.query("update yeoni_connector.tokens set expires_at=now()-interval '1 second' where grant_id=$1 and kind='access'",[g.connection_id]);
  await anonymous(); assert.equal((await tool(g.access_token,'check')).error,'invalid_token');
  await db.exec('reset role'); await db.query("update yeoni_connector.grants set expires_at=now()-interval '1 second' where id=$1",[g.connection_id]);
  await anonymous(); assert.equal((await refresh(g.refresh_token)).error,'invalid_grant');
});
test('owner connection revoke takes effect immediately and another owner cannot revoke it', async () => {
  const g = await connected(); await identify(other,otherSession);
  assert.deepEqual(await sql('select public.chatgpt_connections($1) result',[g.connection_id]),[]);
  await anonymous(); assert.ok((await tool(g.access_token,'check')).scopes);
  await identify(); await sql('select public.chatgpt_connections($1) result',[g.connection_id]);
  await anonymous(); assert.equal((await tool(g.access_token,'check')).error,'invalid_token');
});
test('session revocation, account banning, and anonymous login block ongoing access', async () => {
  const g = await connected(); await db.exec('reset role');
  await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[owner]);
  await anonymous(); assert.equal((await tool(g.access_token,'check')).error,'invalid_token');
  await db.exec('reset role'); await db.query('update auth.users set banned_until=null,is_anonymous=true where id=$1',[owner]);
  await identify(); await assert.rejects(authorize(),/로그인/);
  await db.exec('reset role'); await db.query('update auth.users set is_anonymous=false where id=$1',[owner]);
  await db.query('delete from auth.sessions where id=$1',[session]); await anonymous();
  assert.equal((await tool(g.access_token,'check')).error,'invalid_token');
});
test('requested scopes and consented areas are enforced for all tools and cannot be widened by arguments', async () => {
  const g = await connected(['fitness'],['yeoni:records:read']);
  assert.equal((await tool(g.access_token,'read_record_summary',{area:'budget'})).error,'insufficient_scope');
  assert.equal((await tool(g.access_token,'list_saved_advice')).error,'insufficient_scope');
  assert.equal((await tool(g.access_token,'save_advice',{})).error,'insufficient_scope');
  assert.equal((await tool(g.access_token,'delete_records')).error,'unsupported_tool');
  assert.equal((await tool(g.access_token,'check',{},'https://evil.example/mcp')).error,'invalid_token');
  await assert.rejects(tool(g.access_token,'read_record_summary',{area:'fitness',user_id:other}),/지원하지/);
});
test('advice saves atomically with its source snapshot and identical retries do not duplicate', async () => {
  const g = await connected(); const snap = await tool(g.access_token,'read_record_summary',{area:'budget'}); const args = saveArgs(snap);
  const first = await tool(g.access_token,'save_advice',args); assert.equal(first.body,args.body); assert.deepEqual(first.summary,snap.summary);
  assert.deepEqual(await tool(g.access_token,'save_advice',args),first);
  await assert.rejects(tool(g.access_token,'save_advice',{...args,body:'다른 조언'}),/이미 다른/);
  assert.equal((await tool(g.access_token,'list_saved_advice')).advice.length,1);
  await identify(); assert.equal(await sql('select count(*) result from public.chatgpt_advice'),1);
  assert.equal(Number(await sql('select sum(amount) result from public.budget_transactions')),12000);
});
test('other users cannot read advice, attach foreign snapshots, or insert arbitrary advice through REST', async () => {
  const g = await connected(); const snap = await tool(g.access_token,'read_record_summary',{area:'budget'}); await tool(g.access_token,'save_advice',saveArgs(snap));
  await identify(other,otherSession); assert.equal(await sql('select count(*) result from public.chatgpt_advice'),0);
  const second = await connected(); await assert.rejects(tool(second.access_token,'save_advice',saveArgs(snap)),/만료되었거나/);
  assert.equal((await tool(second.access_token,'list_saved_advice')).advice.length,0);
  await identify(); await assert.rejects(db.query('insert into public.chatgpt_advice(user_id,id) values($1,$2)',[owner,randomUUID()]));
});
test('changed records reject stale analysis; a fresh snapshot can be saved', async () => {
  const g = await connected(); const snap = await tool(g.access_token,'read_record_summary',{area:'budget'});
  await identify(); await db.query('update public.budget_transactions set amount=13000 where user_id=$1',[owner]); await anonymous();
  await assert.rejects(tool(g.access_token,'save_advice',saveArgs(snap)),/기록이 바뀌었습니다/);
  const latest = await tool(g.access_token,'read_record_summary',{area:'budget'});
  assert.equal((await tool(g.access_token,'save_advice',saveArgs(latest))).summary.metrics['지출 합계 원'],13000);
});
test('snapshot expiry and a failed save leave no successful receipt; the same request can be retried', async () => {
  const g = await connected(); const snap = await tool(g.access_token,'read_record_summary',{area:'budget'}); const args=saveArgs(snap);
  await db.exec("reset role; alter table public.chatgpt_advice add constraint inject_save_failure check (title<>'소비 기록 조언');"); await anonymous();
  await assert.rejects(tool(g.access_token,'save_advice',args));
  await db.exec('reset role; alter table public.chatgpt_advice drop constraint inject_save_failure;'); await anonymous();
  assert.ok((await tool(g.access_token,'save_advice',args)).id);
  await db.exec('reset role;'); await db.query("update yeoni_connector.snapshots set created_at=now()-interval '2 days' where id=$1",[snap.snapshot_id]); await anonymous();
  await assert.rejects(tool(g.access_token,'save_advice',saveArgs(snap)),/만료되었거나/);
});
test('record reset removes derived advice and invalidates tokens and pending snapshots', async () => {
  const g = await connected(); const snap = await tool(g.access_token,'read_record_summary',{area:'budget'}); await tool(g.access_token,'save_advice',saveArgs(snap));
  await identify(); await sql("select public.reset_my_app_records('budget',$1,'초기화') result",[randomUUID()]);
  assert.equal(await sql('select count(*) result from public.chatgpt_advice'),0);
  await anonymous(); assert.equal((await tool(g.access_token,'check')).error,'invalid_token');
  await db.exec('reset role'); assert.equal(await sql('select count(*) result from yeoni_connector.snapshots'),0);
});
test('account deletion cascades advice, connection credentials and snapshots', async () => {
  const g = await connected(); const snap = await tool(g.access_token,'read_record_summary',{area:'budget'}); await tool(g.access_token,'save_advice',saveArgs(snap));
  await db.exec('reset role'); await db.query('delete from auth.users where id=$1',[owner]);
  for(const table of ['public.chatgpt_advice','yeoni_connector.grants','yeoni_connector.tokens','yeoni_connector.snapshots']) assert.equal(await sql(`select count(*) result from ${table}`),0);
});
test('fitness, diet, language and task summaries tolerate missing records and count only known activity', async () => {
  const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  await db.query('update public.user_app_state set state=$1 where user_id=$2',[{
    'ai-fitness-workout-completed-days': {[day]:{workoutStatus:'partial',workoutMemo:'개인 메모',workoutBackStatus:'pain'}},
    'ai-fitness-diet-completed-days': {[day]:{dietMemo:'개인 식단'}},'ai-fitness-water-intake':{[day]:600}
  },owner]);
  await db.query('update public.language_user_state set state=$1 where user_id=$2',[{dailyLearningHistory:JSON.stringify({[day]:{completedCount:1}}),japaneseCurriculumProgressV1:JSON.stringify({activityDates:[day]}),wrongWords:JSON.stringify(['비공개 단어'])},owner]);
  const g=await connected(['fitness','diet','language','assistant']);
  const results=[]; for (const area of ['fitness','diet','language','assistant']) results.push(await tool(g.access_token,'read_record_summary',{area}));
  assert.equal(results[0].summary.metrics['운동 수행일'],1); assert.equal(results[0].summary.metrics['불편·통증 신호 기록일'],1);
  assert.equal(results[1].summary.metrics['기록일 평균 물 섭취 mL'],600); assert.equal(results[2].summary.metrics['학습 활동일'],1);
  assert.equal(results[2].summary.metrics['현재 복습 목록 항목'],1); assert.equal(results[3].summary.metrics['미완료 할 일'],0);
  assert.doesNotMatch(JSON.stringify(results),/개인 메모|개인 식단|비공개 단어/);
});
test('anonymous callers cannot authorize, enumerate grants or read private tables', async () => {
  await anonymous(); await assert.rejects(authorize()); await assert.rejects(sql('select public.chatgpt_connections() result'));
  for(const table of ['public.chatgpt_advice','yeoni_connector.grants','yeoni_connector.tokens','yeoni_connector.snapshots']) await assert.rejects(db.query(`select * from ${table}`));
  assert.equal((await tool('ya_'+'0'.repeat(64),'read_record_summary',{area:'budget'})).error,'invalid_token');
});
test('discovery uses a fixed issuer, PKCE and the verified ChatGPT callback; production stays disabled', () => {
  const params=new URLSearchParams({client_id:CHATGPT_CLIENT_ID,redirect_uri:CHATGPT_REDIRECT,resource,state:'opaque-state',response_type:'code',code_challenge_method:'S256',code_challenge:'x'.repeat(43),scope:CONNECT_SCOPES.join(' ')});
  assert.equal(parseConnectRequest(params,CHATGPT_PREVIEW_ORIGIN).clientId,CHATGPT_CLIENT_ID);
  for(const [key,value] of [['redirect_uri','https://evil.example'],['client_id','https://evil.example/client.json'],['resource','https://evil.example/mcp'],['scope','admin'],['code_challenge_method','plain']]) { const bad=new URLSearchParams(params);bad.set(key,value);assert.throws(()=>parseConnectRequest(bad,CHATGPT_PREVIEW_ORIGIN)); }
  params.append('state','different'); assert.throws(()=>parseConnectRequest(params,CHATGPT_PREVIEW_ORIGIN));
  assert.equal(connectorOrigin({VERCEL_ENV:'production'}),null);
  assert.equal(connectorOrigin({YEONI_E2E:'1',NEXT_PUBLIC_SUPABASE_URL:'https://hosted.example'}),null);
  assert.equal(authorizationMetadata(CHATGPT_PREVIEW_ORIGIN).issuer,protectedResourceMetadata(CHATGPT_PREVIEW_ORIGIN).authorization_servers[0]);
  assert.deepEqual(authorizationMetadata(CHATGPT_PREVIEW_ORIGIN).token_endpoint_auth_methods_supported,['none']);
});
test('actual SDK transport initializes, advertises three scoped tools and refuses invalid arguments before execution', async () => {
  const messages: Json[]=[];
  const send=async (method:string,params:Json={}) => {
    const body={jsonrpc:'2.0',id:1,method,params};
    const request=new Request('https://example.test/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},body:JSON.stringify(body)});
    const response=await serveMcp(request,body,async(name,args)=>{messages.push({name,args});return {error:'invalid_token'};},'Bearer error="invalid_token"');
    assert.equal(response.status,200); return response.json();
  };
  const init=await send('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'isolated-test',version:'1'}}); assert.equal(init.result.serverInfo.name,'ai-yeoni-record-advice');
  const listed=await send('tools/list'); assert.equal(listed.result.tools.length,3);
  assert.equal(listed.result.tools[1].securitySchemes[0].type,'oauth2'); assert.equal(listed.result.tools[1].annotations.readOnlyHint,false);
  const bad=await send('tools/call',{name:'read_record_summary',arguments:{area:'budget',user_id:other}}); assert.ok(bad.result?.isError || bad.error); assert.equal(messages.length,0);
  const denied=await send('tools/call',{name:'read_record_summary',arguments:{area:'budget'}}); assert.equal(denied.result.isError,true); assert.ok(denied.result._meta['mcp/www_authenticate']);
});
