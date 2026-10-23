import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../app/budget/page.tsx',import.meta.url),'utf8');
test('recent record heading explains all-period transaction-date ordering',()=>{
 assert.ok(source.includes('>전체 기간 최근 기록</p>'));
 assert.ok(source.includes('>조회한 월과 관계없이, 거래 날짜가 최근인 순서예요.</h2>'));
});
test('recent records retain cross-month date order and five/all toggle independently of selected month',()=>{
 const start=source.indexOf('  const recentThreshold = 5');
 const end=source.indexOf('  const shouldShowAppSplash',start);
 assert.ok(start>=0&&end>start);
 const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const transactions=Array.from({length:6},(_,i)=>({id:String(i),date:`2026-10-0${i+1}`,amount:1}));
 for(const selectedMonth of ['2026-09','2026-10'])for(const showAllRecent of [false,true]){
  const result=vm.runInNewContext(code+';visibleRecent.map(item=>item.date)',{transactions,incomeList:[{date:'2026-09-30',amount:1}],savings:[],selectedMonth,showAllRecent});
  assert.deepEqual(Array.from(result),showAllRecent?['2026-10-06','2026-10-05','2026-10-04','2026-10-03','2026-10-02','2026-10-01','2026-09-30']:['2026-10-06','2026-10-05','2026-10-04','2026-10-03','2026-10-02']);
 }
});
