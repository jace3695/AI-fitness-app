import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../app/budget/page.tsx',import.meta.url),'utf8');
const start=source.indexOf('  const fetchRecordKind =');
const end=source.indexOf('  const fetchTransactions =',start);
function deferred(){let resolve!:(v:unknown)=>void,reject!:(e:Error)=>void;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject};}
function fixture(){
 const state={expense:[] as unknown[],income:[] as unknown[],saving:[] as unknown[],loads:{} as Record<string,string>};const pending:ReturnType<typeof deferred>[]=[];
 const context={recordReadVersions:{current:{expense:0,income:0,saving:0}},budgetEpoch:{current:1},liveBudgetOwner:{current:'A'},supabase:{auth:{getUser:async()=>({data:{user:{id:context.liveBudgetOwner.current}},error:null})}},BUDGET_RECORD_TABLE:{expense:'budget_transactions',income:'budget_income',saving:'budget_savings'},loadBudgetRows:()=>{const d=deferred();pending.push(d);return d.promise;},setTransactions:(v:unknown[])=>state.expense=v,setIncomeList:(v:unknown[])=>state.income=v,setSavings:(v:unknown[])=>state.saving=v,setRecurringTransactions:()=>{},getLocalDateKey:()=> '2026-01-01',setRecordLoads:(fn:(x:Record<string,string>)=>Record<string,string>)=>state.loads=fn(state.loads)};
 const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const run=vm.runInNewContext(code+';fetchRecordKind',context) as(kind:string)=>Promise<boolean>;
 return{context,state,pending,run};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('a slower old refresh cannot replace a newer same-account list',async()=>{const f=fixture();const old=f.run('expense');await tick();const fresh=f.run('expense');await tick();f.pending[1].resolve([{id:'new',date:'2026-10-23'}]);assert.equal(await fresh,true);f.pending[0].resolve([{id:'old',date:'2026-10-01'}]);assert.equal(await old,false);assert.deepEqual(structuredClone(f.state.expense),[{id:'new',date:'2026-10-23'}]);});
test('old refresh failure cannot replace latest ready status',async()=>{const f=fixture();const old=f.run('expense');await tick();const fresh=f.run('expense');await tick();f.pending[1].resolve([]);await fresh;f.pending[0].reject(Error('old'));await old;assert.equal(f.state.loads.expense,'ready');});
test('A to B to A generation boundary ignores old rows and errors',async()=>{for(const fail of [false,true]){const f=fixture();const task=f.run('expense');await tick();f.context.liveBudgetOwner.current='B';f.context.budgetEpoch.current++;f.context.liveBudgetOwner.current='A';f.context.budgetEpoch.current++;f.state.loads.expense='new generation';if(fail)f.pending[0].reject(Error('old'));else f.pending[0].resolve([{id:'old'}]);assert.equal(await task,false);assert.deepEqual(f.state.expense,[]);assert.equal(f.state.loads.expense,'new generation');}});
test('income and expense refreshes do not cancel one another',async()=>{const f=fixture();const expense=f.run('expense'),income=f.run('income');await tick();f.pending[0].resolve([{id:'e',date:'2026-10-23'}]);f.pending[1].resolve([{id:'i'}]);assert.equal(await expense,true);assert.equal(await income,true);assert.equal(f.state.loads.income,'ready');assert.equal(f.state.loads.expense,'ready');});
test('latest failure retains previous rows and offers load-error state',async()=>{const f=fixture();f.state.expense=[{id:'keep'}];const task=f.run('expense');await tick();f.pending[0].reject(Error('offline'));assert.equal(await task,false);assert.deepEqual(f.state.expense,[{id:'keep'}]);assert.match(f.state.loads.expense,/다시 불러와/);});
test('visible load retry refreshes three lists without reloading or losing an unsaved draft',async()=>{
 const section=source.slice(source.indexOf('{dataLoadError && !isOffline && ('),source.indexOf('{deleteUndo && !isOffline'));
 const expression=section.match(/onClick={(.*?)}/)?.[1];assert.ok(expression);
 const state={draft:'unsaved synthetic draft',reads:0,reloads:0};
 const read=async()=>{state.reads++;return true;};
 const run=vm.runInNewContext('('+expression+')',{fetchIncome:read,fetchTransactions:read,fetchSavings:read,window:{location:{reload(){state.reloads++;state.draft='';}}}}) as()=>void;
 run();await tick();assert.equal(state.reloads,0);assert.equal(state.draft,'unsaved synthetic draft');assert.equal(state.reads,3);
});
test('page-exit epoch invalidation ignores late completion',async()=>{const f=fixture();const task=f.run('expense');await tick();assert.match(source,/useEffect\(\(\) => \(\) => { budgetEpoch.current \+= 1 }, \[\]\)/);f.context.budgetEpoch.current++;f.pending[0].resolve([{id:'late'}]);assert.equal(await task,false);assert.deepEqual(f.state.expense,[]);});
