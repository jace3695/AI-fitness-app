import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '../lib/body-analysis-history.ts';
const owner='00000000-0000-4000-8000-000000000501', other='00000000-0000-4000-8000-000000000502', id='00000000-0000-4000-8000-000000000503';
const snapshot={version:1,source:'local-rules',date:'2026-10-21',text:'합성 참고 분석문'};
test('snapshot rejects unknown payload, invalid dates and unbounded content',()=>{
 assert.deepEqual(schema.parseBodyAnalysisSnapshot(snapshot),snapshot);
 for(const value of [{...snapshot,rawRecords:{}},{...snapshot,date:'2026-02-30'},{...snapshot,version:'1'},{...snapshot,text:''},{...snapshot,text:'x'.repeat(12001)},{...snapshot,source:'ai'}])assert.equal(schema.parseBodyAnalysisSnapshot(value),null);
});
function fixture(){
 const rows=new Map<string,unknown>();const state={owner,failed:false,writes:0};
 const db={auth:{getUser:async()=>({data:{user:state.owner?{id:state.owner}:null},error:null})},from(table:string){assert.equal(table,schema.BODY_HISTORY_TABLE);let payload:any,op='select';const filters:Record<string,string>={};
 const run=()=>{if(state.failed)return{data:null,error:{code:'42P01',message:'PRIVATE'}};const key=filters.user_id+':'+filters.id;
 if(op==='insert'){state.writes++;const k=payload.user_id+':'+payload.id;if(rows.has(k))return{data:null,error:{code:'23505'}};const row={id:payload.id,snapshot:payload.snapshot,created_at:'2026-10-21T00:00:00Z'};rows.set(k,row);return{data:row,error:null};}
 if(op==='delete'){state.writes++;rows.delete(key);return{error:null};}
 if(filters.id)return{data:rows.get(key)||null,error:null};return{data:[...rows.entries()].filter(([k])=>k.startsWith(filters.user_id+':')).map(([,v])=>v),error:null};};
 const q:any={select(){return q},eq(k:string,v:string){filters[k]=v;return q},order(){return q},limit(){return q},insert(v:any){op='insert';payload=v;return q},delete(){op='delete';return q},single:async()=>run(),maybeSingle:async()=>run(),then(resolve:any){resolve(run())}};return q;}};
 const exports:any={};const code=ts.transpileModule(readFileSync(new URL('../app/api/fitness/body-analysis-history/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext('(function(exports,require){'+code+'})',{Response,URL,console})(exports,(name:string)=>name==='@/lib/supabase-server'?{createServerSupabaseClient:async()=>db}:schema);
 const call=(method:string,body?:unknown,expected=owner,query='')=>exports[method](new Request('https://fixture.local/history'+query,{method,headers:{'X-Expected-Owner':expected},...(body?{body:JSON.stringify(body)}:{})}));
 return{state,rows,call};
}
test('API authenticated ownership, explicit consent and unknown fields gate all writes',async()=>{
 const f=fixture();f.state.owner='';assert.equal((await f.call('GET')).status,401);f.state.owner=other;
 assert.equal((await f.call('POST',{id,snapshot,acknowledged:true})).status,409);f.state.owner=owner;
 for(const body of [{id,snapshot,acknowledged:false},{id,snapshot,acknowledged:true,user_id:other},{id:'bad',snapshot,acknowledged:true}])assert.equal((await f.call('POST',body)).status,400);
 assert.equal(f.state.writes,0);
});
test('API lost-response retry is idempotent; changed content conflicts; other owner cannot read/delete',async()=>{
 const f=fixture(),body={id,snapshot,acknowledged:true};assert.equal((await f.call('POST',body)).status,201);
 assert.equal((await f.call('POST',body)).status,200);assert.equal(f.rows.size,1);
 assert.equal((await f.call('POST',{...body,snapshot:{...snapshot,text:'changed'}})).status,409);
 let res=await f.call('GET');assert.equal(res.headers.get('cache-control'),'private, no-store');assert.equal((await res.json()).entries.length,1);
 f.state.owner=other;assert.equal((await (await f.call('GET',undefined,other)).json()).entries.length,0);
 await f.call('DELETE',undefined,other,'?id='+id);assert.equal(f.rows.size,1);
 f.state.owner=owner;await f.call('DELETE',undefined,owner,'?id='+id);assert.equal(f.rows.size,0);
});
test('API missing schema fails explicitly without raw error disclosure',async()=>{const f=fixture();f.state.failed=true;const res=await f.call('GET');assert.equal(res.status,503);assert.ok(!(await res.text()).includes('PRIVATE'));});
test('draft SQL enforces actual owner RLS, immutable snapshots, retry uniqueness and private deletion',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.test_user',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 await db.exec(readFileSync(new URL('../docs/body-analysis-history/schema-draft.sql',import.meta.url),'utf8'));
 await db.exec(`set app.test_user='${owner}';set role authenticated;`);
 for(const bad of [{...snapshot,date:'2026-02-30'},{...snapshot,version:'1'},{...snapshot,secret:'raw'},{}])await assert.rejects(db.query('insert into body_analysis_history(user_id,id,snapshot) values($1,$2,$3)',[owner,id,JSON.stringify(bad)]));
 await db.query('insert into body_analysis_history(user_id,id,snapshot) values($1,$2,$3)',[owner,id,JSON.stringify(snapshot)]);
 await assert.rejects(db.query('insert into body_analysis_history(user_id,id,snapshot) values($1,$2,$3)',[owner,id,JSON.stringify(snapshot)]));
 await assert.rejects(db.query('update body_analysis_history set snapshot=$1',[JSON.stringify({...snapshot,text:'changed'})]));
 await db.exec(`reset role;set app.test_user='${other}';set role authenticated;`);
 assert.equal((await db.query('select * from body_analysis_history')).rows.length,0);
 await assert.rejects(db.query('insert into body_analysis_history(user_id,id,snapshot) values($1,$2,$3)',[owner,id,JSON.stringify(snapshot)]));
 assert.equal((await db.query('delete from body_analysis_history returning id')).rows.length,0);
 await db.exec('reset role;set role anon;');await assert.rejects(db.query('select * from body_analysis_history'));
 await db.exec(`reset role;set app.test_user='${owner}';set role authenticated;`);
 assert.equal((await db.query('select * from body_analysis_history')).rows.length,1);assert.equal((await db.query('delete from body_analysis_history returning id')).rows.length,1);
 }finally{await db.close();}
});
