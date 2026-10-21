import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '../lib/confirmed-conversation-archive.ts';
const owner='00000000-0000-4000-8000-000000000801',other='00000000-0000-4000-8000-000000000802',id='00000000-0000-4000-8000-000000000803';
const body={version:1,kind:'body-dialogue',date:'2026-10-21',question:'합성 질문',answer:'합성 로컬 답변'};
const japanese={version:1,kind:'japanese-practice',turn:{id:'synthetic-turn',text:'こんにちは。',situation:'일상',review:true,practiced:2}};
test('archive snapshots allow only explicit text fields and valid bounded content',()=>{
 for(const x of [body,japanese])assert.deepEqual(schema.parseArchiveSnapshot(x),x);
 for(const x of [{...body,date:'2026-02-30'},{...body,rawRecord:{}},{...body,answer:''},{...body,question:'x'.repeat(1001)},{...body,version:'1'},{...japanese,turn:{...japanese.turn,audio:'private'}},{...japanese,turn:{...japanese.turn,practiced:-1}},{...japanese,turn:{...japanese.turn,reply:{source:'static'}}}])assert.equal(schema.parseArchiveSnapshot(x),null);
});
function fixture(){
 const rows=new Map<string,any>();const state={owner,failed:false,writes:0};
 const db={auth:{getUser:async()=>({data:{user:state.owner?{id:state.owner}:null},error:null})},from(table:string){assert.equal(table,schema.ARCHIVE_TABLE);let payload:any,op='select',activeOnly=false,max=100,cursor='';const filters:Record<string,string>={};
 const run=()=>{
  if(state.failed)return{data:null,error:{code:'42P01',message:'PRIVATE DB DETAIL'}};
  const key=filters.user_id+':'+filters.id;
  if(op==='insert'){state.writes++;const k=payload.user_id+':'+payload.id;if(rows.has(k))return{data:null,error:{code:'23505'}};const row={...payload,created_at:'2026-10-21T00:00:00.000Z'};rows.set(k,row);return{data:row,error:null};}
  if(op==='update'){state.writes++;const row=rows.get(key);if(row&&row.kind===filters.kind&&row.snapshot!==null)rows.set(key,{...row,snapshot:null});return{error:null};}
  if(filters.id)return{data:rows.get(key)||null,error:null};
  let data=[...rows.values()].filter(x=>x.user_id===filters.user_id&&x.kind===filters.kind&&(!activeOnly||x.snapshot!==null)).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
  if(cursor){const m=/created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^)]+)\)/.exec(cursor)!;data=data.filter(x=>x.created_at<m[1]||x.created_at===m[1]&&x.id<m[2]);}
  return{data:data.slice(0,max),error:null};
 };
 const q:any={select(){return q},eq(k:string,v:string){filters[k]=v;return q},not(k:string,operator:string,value:unknown){assert.equal(k,'snapshot');assert.equal(operator,'is');assert.equal(value,null);activeOnly=true;return q},or(v:string){cursor=v;return q},order(){return q},limit(v:number){max=v;return q},insert(v:any){op='insert';payload=v;return q},update(v:any){assert.equal(Object.keys(v).join(),'snapshot');assert.equal(v.snapshot,null);op='update';return q},single:async()=>run(),maybeSingle:async()=>run(),then(resolve:any){resolve(run())}};return q;}};
 const exports:any={};const code=ts.transpileModule(readFileSync(new URL('../app/api/confirmed-conversation-archive/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext('(function(exports,require){'+code+'})',{Response,URL,console})(exports,(name:string)=>name==='@/lib/supabase-server'?{createServerSupabaseClient:async()=>db}:schema);
 const call=(method:string,payload?:unknown,expected=owner,query='?kind=body-dialogue')=>exports[method](new Request('https://fixture.local/archive'+query,{method,headers:{'X-Expected-Owner':expected},...(payload?{body:JSON.stringify(payload)}:{})}));
 return{state,rows,call};
}
test('archive API requires authenticated owner, exact fields and affirmative consent',async()=>{
 const f=fixture();f.state.owner='';assert.equal((await f.call('GET')).status,401);f.state.owner=other;assert.equal((await f.call('POST',{id,snapshot:body,acknowledged:true})).status,409);f.state.owner=owner;
 for(const payload of [{id,snapshot:body,acknowledged:false},{id,snapshot:body,acknowledged:true,user_id:other},{id:'bad',snapshot:body,acknowledged:true}])assert.equal((await f.call('POST',payload)).status,400);
 assert.equal(f.state.writes,0);
 assert.equal((await f.call('GET',undefined,owner,'?kind=unknown')).status,400);
 assert.equal((await f.call('GET',undefined,owner,'?kind=body-dialogue&before=bad&beforeId='+id)).status,400);
});
test('archive retry is idempotent and erased content cannot be resurrected by a delayed POST',async()=>{
 const f=fixture(),payload={id,snapshot:body,acknowledged:true};
 assert.equal((await f.call('POST',payload)).status,201);assert.equal((await f.call('POST',payload)).status,200);assert.equal(f.rows.size,1);
 assert.equal((await f.call('POST',{...payload,snapshot:{...body,answer:'changed'}})).status,409);
 await f.call('DELETE',undefined,owner,'?kind=body-dialogue&id='+id);
 assert.equal((await (await f.call('GET')).json()).entries.length,0);
 assert.equal(f.rows.get(owner+':'+id).snapshot,null);
 assert.equal((await f.call('POST',payload)).status,410);
 assert.equal((await f.call('DELETE',undefined,owner,'?kind=body-dialogue&id='+id)).status,200);
});
test('archive scopes read and erasure by both owner and kind; missing schema has explicit private failure',async()=>{
 const f=fixture();await f.call('POST',{id,snapshot:body,acknowledged:true});
 await f.call('DELETE',undefined,owner,'?kind=japanese-practice&id='+id);assert.notEqual(f.rows.get(owner+':'+id).snapshot,null);
 f.state.owner=other;const res=await f.call('GET',undefined,other);assert.equal(res.headers.get('cache-control'),'private, no-store');assert.equal((await res.json()).entries.length,0);
 await f.call('DELETE',undefined,other,'?kind=body-dialogue&id='+id);assert.notEqual(f.rows.get(owner+':'+id).snapshot,null);
 f.state.failed=true;const failure=await f.call('GET',undefined,other);assert.equal(failure.status,503);assert.ok(!(await failure.text()).includes('PRIVATE'));
});
test('archive keyset pagination returns tied timestamps once and excludes erased entries',async()=>{
 const f=fixture();for(let i=1;i<=12;i++){const rowId='00000000-0000-4000-8000-'+String(i).padStart(12,'0');f.rows.set(owner+':'+rowId,{user_id:owner,id:rowId,kind:body.kind,snapshot:body,created_at:'2026-10-21T00:00:00.000Z'});}
 const first=await (await f.call('GET')).json();assert.equal(first.entries.length,10);assert.ok(first.nextCursor);
 const next=await (await f.call('GET',undefined,owner,'?kind=body-dialogue&'+new URLSearchParams(first.nextCursor))).json();assert.equal(next.entries.length,2);assert.equal(next.nextCursor,null);assert.equal(new Set([...first.entries,...next.entries].map(x=>x.id)).size,12);
});
test('draft SQL enforces two-owner RLS, immutable content, permanent erasure and retry tombstones',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.test_user',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(readFileSync(new URL('../docs/confirmed-conversation-archive/schema-draft.sql',import.meta.url),'utf8'));
  await db.exec(`set app.test_user='${owner}';set role authenticated;`);
  for(const bad of [{...body,date:'2026-02-30'},{...body,secret:'raw'},{...body,version:'1'},{...japanese,turn:{...japanese.turn,review:'yes'}},{...japanese,turn:{...japanese.turn,practiced:-1}}])await assert.rejects(db.query('insert into confirmed_conversation_archive(user_id,id,kind,snapshot) values($1,$2,$3,$4)',[owner,id,bad.kind,JSON.stringify(bad)]));
  await assert.rejects(db.query('insert into confirmed_conversation_archive(user_id,id,kind,snapshot) values($1,$2,$3,null)',[owner,id,body.kind]));
  await db.query('insert into confirmed_conversation_archive(user_id,id,kind,snapshot) values($1,$2,$3,$4)',[owner,id,body.kind,JSON.stringify(body)]);
  await assert.rejects(db.query('update confirmed_conversation_archive set snapshot=$1',[JSON.stringify({...body,answer:'changed'})]));
  await assert.rejects(db.query('update confirmed_conversation_archive set user_id=$1',[other]));
  await assert.rejects(db.query('delete from confirmed_conversation_archive'));
  await db.exec(`reset role;set app.test_user='${other}';set role authenticated;`);
  assert.equal((await db.query('select * from confirmed_conversation_archive')).rows.length,0);
  assert.equal((await db.query('update confirmed_conversation_archive set snapshot=null returning id')).rows.length,0);
  await assert.rejects(db.query('insert into confirmed_conversation_archive(user_id,id,kind,snapshot) values($1,$2,$3,$4)',[owner,id,japanese.kind,JSON.stringify(japanese)]));
  await db.query('insert into confirmed_conversation_archive(user_id,id,kind,snapshot) values($1,$2,$3,$4)',[other,id,japanese.kind,JSON.stringify(japanese)]);
  await db.exec('reset role;set role anon;');await assert.rejects(db.query('select * from confirmed_conversation_archive'));
  await db.exec(`reset role;set app.test_user='${owner}';set role authenticated;`);
  await db.query('update confirmed_conversation_archive set snapshot=null where id=$1',[id]);
  const deleted=(await db.query<{snapshot:unknown;deleted_at:unknown}>('select snapshot,deleted_at from confirmed_conversation_archive')).rows[0];assert.equal(deleted.snapshot,null);assert.ok(deleted.deleted_at);
  await assert.rejects(db.query('update confirmed_conversation_archive set snapshot=$1',[JSON.stringify(body)]));
  await assert.rejects(db.query('insert into confirmed_conversation_archive(user_id,id,kind,snapshot) values($1,$2,$3,$4)',[owner,id,body.kind,JSON.stringify(body)]));
 }finally{await db.close();}
});
