import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createQueuedRefresh } from '../app/lib/queuedRefresh.ts';
const source=fs.readFileSync(new URL('../app/assistant/AssistantClient.tsx',import.meta.url),'utf8');
const start=source.indexOf('  const load = useMemo'),end=source.indexOf('  useEffect(',start);
function deferred(){let resolve!:(v:unknown)=>void,reject!:(e:Error)=>void;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject};}
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const calls:{table:string;wait:ReturnType<typeof deferred>}[]=[];
 const state={items:[{id:'existing'}] as unknown[],projects:[] as unknown[],memories:[] as unknown[],failures:['existing status'],loading:false,briefing:{budget:{},fitness:{},diet:{},language:{},growth:{}} as Record<string,unknown>,weekly:null as unknown};
 const context={useMemo:(fn:()=>unknown)=>fn(),createQueuedRefresh,dashboardRead:{current:{version:0,mounted:true}},chatEpoch:{current:1},localBodyOwner:{current:'A'},supabase:{auth:{getUser:async()=>({data:{user:{id:context.localBodyOwner.current}}})},from:(table:string)=>{const q=new Proxy({},{get:(_,key)=>key==='then'?(resolve:(v:unknown)=>void,reject:(e:Error)=>void)=>{const wait=deferred();calls.push({table,wait});return wait.promise.then(resolve,reject)}:()=>q});return q;}},setLoading:(v:boolean)=>state.loading=v,setMessage:()=>{},setLoadFailures:(v:string[])=>state.failures=v,setItems:(v:unknown[])=>state.items=v,setProjects:(v:unknown[])=>state.projects=v,setMemories:(v:unknown[])=>state.memories=v,setBriefing:(fn:(v:typeof state.briefing)=>typeof state.briefing)=>state.briefing=fn(state.briefing),setWeeklyBriefing:(v:unknown)=>state.weekly=v,setLastLoadedAt:()=>{},getLocalDateKey:()=> '2026-10-24',getAssistantWeeklyStartDate:()=> '2026-10-19',getAssistantBudgetQueryStart:()=> '2026-10-01',isRetiredGrowthRoutine:()=>false,parseStateObject:(v:unknown)=>v,buildAssistantWeeklyBriefing:()=>({synthetic:true}),EMPTY_BRIEFING:{fitness:{},diet:{},language:{}},summarizeGrowthRoutineWeek:()=>({achieved:false}),isGrowthRoutineScheduled:()=>true};
 const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const load=vm.runInNewContext(code+';load',context) as()=>Promise<void>;
 const finish=(offset:number,id:string,failedTable='')=>calls.slice(offset,offset+9).forEach(({table,wait})=>wait.resolve({data:table==='assistant_items'?[{id}]:table==='budget_monthly_budgets'?null:[],error:table===failedTable?{message:'synthetic partial error'}:null}));
 return{context,state,calls,load,finish};
}
test('late previous owner list cannot replace current account state',async()=>{const f=fixture();const task=f.load();await tick();assert.equal(f.calls.length,9);f.context.localBodyOwner.current='B';f.context.chatEpoch.current++;f.context.dashboardRead.current.version++;f.state.items=[{id:'B'}];f.finish(0,'A');await task;assert.deepEqual(f.state.items,[{id:'B'}]);});
test('A-B-A generation ignores old list even when owner string matches again',async()=>{const f=fixture();const task=f.load();await tick();f.context.chatEpoch.current+=2;f.context.dashboardRead.current.version+=2;f.state.items=[{id:'new A'}];f.finish(0,'old A');await task;assert.deepEqual(f.state.items,[{id:'new A'}]);});
test('new queued refresh invalidates old failure before starting fresh read',async()=>{const f=fixture();const old=f.load();await tick();const fresh=f.load();f.calls.slice(0,9).forEach(c=>c.wait.reject(Error('old network error')));await tick();assert.equal(f.calls.length,18);assert.deepEqual(f.state.failures,['existing status']);f.finish(9,'fresh');await Promise.all([old,fresh]);assert.deepEqual(structuredClone(f.state.items),[{id:'fresh'}]);assert.deepEqual(structuredClone(f.state.failures),[]);});
test('unmounted list ignores response and does not clear another view loading state',async()=>{const f=fixture();const task=f.load();await tick();f.context.dashboardRead.current.mounted=false;f.context.dashboardRead.current.version++;f.state.loading=true;f.finish(0,'late');await task;assert.deepEqual(f.state.items,[{id:'existing'}]);assert.equal(f.state.loading,true);});
test('current same-owner partial failure keeps prior failed section and reports it',async()=>{const f=fixture();const task=f.load();await tick();f.finish(0,'ignored','assistant_items');await task;assert.deepEqual(f.state.items,[{id:'existing'}]);assert.ok(f.state.failures.includes('할 일'));assert.equal(f.state.loading,false);});
