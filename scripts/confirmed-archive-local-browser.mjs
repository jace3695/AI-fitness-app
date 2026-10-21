import { build } from './browser-qa/node_modules/esbuild/lib/main.js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import postcss from 'postcss';import tailwindcss from 'tailwindcss';
const out='scripts/browser-qa/.generated/confirmed-archive';mkdirSync(out,{recursive:true});
const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import Archive from './components/ConfirmedConversationArchive';import Workspace from './app/language/practice/PracticeWorkspace';
function App(){const[version,setVersion]=useState(1);const owner=localStorage.getItem('qa-owner')||'A';return location.pathname==='/body'?<><button onClick={()=>setVersion(v=>v+1)}>후보 변경</button><Archive ownerId={owner} kind="body-dialogue" candidate={{version:1,kind:'body-dialogue',date:'2026-10-21',question:'합성 질문 '+version,answer:'합성 답변'}}/></>:<Workspace owner={owner}/>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'synthetic-auth',setup(b){b.onResolve({filter:/(^|\/)supabase(\.ts)?$/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`const user=()=>({id:localStorage.getItem('qa-owner')||'A'});export const supabase={auth:{getUser:async()=>{if(window.hangAuth)await new Promise(r=>window.releaseAuth=r);return{data:{user:user()},error:null}},onAuthStateChange:fn=>{queueMicrotask(()=>fn('INITIAL_SESSION',{user:user()}));const change=()=>fn('SIGNED_IN',{user:user()});window.addEventListener('fixture-auth',change);return{data:{subscription:{unsubscribe:()=>window.removeEventListener('fixture-auth',change)}}}}}};export const authenticatedFetch=(url,init)=>fetch(url,init);`}));}}]});
const css=(await postcss([tailwindcss({content:['./components/ConfirmedConversationArchive.tsx','./app/language/practice/PracticeWorkspace.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css+readFileSync('app/language/language.css','utf8');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{padding:12px}</style><div id="root"></div><script src="/app.js"></script></html>`)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});const page=await context.newPage();
const rows=new Map(),requests=[],external=[],errors=[],passed=[];let loseSave=true,failLoad=false,hold=false,release;
page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(()=>{if(!localStorage.getItem('qa-owner'))localStorage.setItem('qa-owner','A');Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>Promise.reject(Error('No real microphone'))}})});
await context.route('**/*',route=>{
 const req=route.request(),u=new URL(req.url());if(u.origin!==origin){external.push(u.origin);return route.abort()}
 if(u.pathname!=='/api/confirmed-conversation-archive')return route.continue();
 const owner=req.headers()['x-expected-owner'],method=req.method(),body=method==='POST'?req.postDataJSON():null;requests.push({owner,method,body});
 if(method==='POST'){
  const key=owner+':'+body.id,prior=rows.get(key);
  if(prior?.snapshot===null)return route.fulfill({status:410,json:{error:'이미 내용을 삭제한 보관 요청입니다.'}});
  if(prior&&JSON.stringify(prior.snapshot)!==JSON.stringify(body.snapshot))return route.fulfill({status:409,json:{error:'동일 ID 내용 충돌'}});
  rows.set(key,prior||{id:body.id,created_at:'2026-10-21T00:00:00.000Z',snapshot:body.snapshot});
  if(loseSave){loseSave=false;return route.abort('failed')}
  return route.fulfill({json:{entry:rows.get(key)}});
 }
 if(method==='DELETE'){const row=rows.get(owner+':'+u.searchParams.get('id'));if(row?.snapshot?.kind===u.searchParams.get('kind'))row.snapshot=null;return route.fulfill({json:{deleted:true}})}
 const entries=[...rows.entries()].filter(([key,row])=>key.startsWith(owner+':')&&row.snapshot?.kind===u.searchParams.get('kind')).map(([,row])=>row).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id)).filter(row=>!u.searchParams.has('before')||row.created_at<u.searchParams.get('before')||row.created_at===u.searchParams.get('before')&&row.id<u.searchParams.get('beforeId'));
 const visible=entries.slice(0,10),last=visible.at(-1),payload={entries:visible,nextCursor:entries.length>10?{before:last.created_at,beforeId:last.id}:null};
 if(hold){release=()=>route.fulfill({json:payload});return}
 return failLoad?route.fulfill({status:503,json:{error:'합성 보관 서비스 미준비'}}):route.fulfill({json:payload});
});
let failure;
try{
 await page.goto(origin);let panel=page.getByRole('region',{name:'일본어 연습 계정 보관'});
 await page.getByLabel('자유 일본어 문장').fill('合成の保管です。');await page.getByRole('button',{name:'연습 기록 보관',exact:true}).click();
 await page.getByRole('button',{name:'계정 보관 대상으로 선택',exact:true}).click();await expect(panel.getByRole('button',{name:'선택 내용 계정 보관',exact:true})).toBeDisabled();assert.equal(requests.length,0);
 await panel.getByText('계정에 보낼 내용 확인',{exact:true}).click();await expect(panel).toContainText('合成の保管です。');await panel.getByRole('checkbox').check();
 await panel.getByRole('button',{name:'선택 내용 계정 보관',exact:true}).click();await expect(panel.getByRole('status')).toBeVisible();assert.equal(rows.size,1);
 await panel.getByRole('button',{name:'선택 내용 계정 보관',exact:true}).dblclick();await expect(panel.getByRole('status')).toContainText('저장했어요');assert.equal(rows.size,1);assert.equal(new Set(requests.filter(r=>r.method==='POST').map(r=>r.body.id)).size,1);
 passed.push('manual journal sends nothing; selected preview and explicit consent; lost-response retry reuses one ID');
 await page.evaluate(()=>sessionStorage.clear());await page.reload();await expect(page.getByRole('article')).toHaveCount(0);
 await panel.getByRole('button',{name:'계정 보관본 불러오기',exact:true}).click();await expect(panel.getByRole('article')).toHaveCount(1);
 await panel.getByRole('button',{name:'이 탭으로 가져오기',exact:true}).click();await expect(page.getByRole('article')).toHaveCount(2);
 await panel.getByRole('button',{name:'이 탭으로 가져오기',exact:true}).click();await expect(page.getByRole('article')).toHaveCount(2);await expect(page.getByText('같은 문장의 탭 기록이 이미 있어요.',{exact:false})).toBeVisible();
 passed.push('explicit fetch restores account snapshot into empty tab; repeated import does not overwrite or duplicate');
 await panel.getByRole('button',{name:'보관 내용 삭제',exact:true}).click();const before=requests.length;await panel.getByRole('button',{name:'삭제 취소',exact:true}).click();assert.equal(requests.length,before);
 await panel.getByRole('button',{name:'보관 내용 삭제',exact:true}).click();await panel.getByRole('button',{name:'내용 삭제 확인',exact:true}).click();await expect(panel.getByRole('article')).toHaveCount(0);await expect(page.getByRole('article')).toHaveCount(1);assert.equal([...rows.values()][0].snapshot,null);
 passed.push('confirmed content erasure leaves original tab intact; cancel sends no mutation');
 await page.goto(origin+'/body');panel=page.getByRole('region',{name:'체성분 대화 계정 보관'});
 await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'선택 내용 계정 보관',exact:true}).click();await expect(panel.getByRole('article')).toHaveCount(1);
 await panel.getByRole('button',{name:'보관 내용 삭제',exact:true}).click();await panel.getByRole('button',{name:'내용 삭제 확인',exact:true}).click();await expect(panel.getByRole('article')).toHaveCount(0);
 await panel.getByRole('button',{name:'선택 내용 계정 보관',exact:true}).click();await expect(panel.getByRole('status')).toContainText('이미 내용을 삭제');await expect(panel.getByRole('article')).toHaveCount(0);
 passed.push('body question and answer remain separate from raw measurements; deleted request cannot resurrect via retry');
 await page.getByRole('button',{name:'후보 변경',exact:true}).click();await expect(panel.getByRole('checkbox')).not.toBeChecked();await expect(panel.getByRole('button',{name:'선택 내용 계정 보관',exact:true})).toBeDisabled();passed.push('changed candidate requires fresh consent and new request identity');
 for(let i=1;i<=12;i++){const id='00000000-0000-4000-8000-'+String(i).padStart(12,'0');rows.set('A:'+id,{id,created_at:'2026-10-21T00:00:00.000Z',snapshot:{version:1,kind:'body-dialogue',date:'2026-10-21',question:'합성 '+i,answer:'합성 답변'}})}
 await panel.getByRole('button',{name:'계정 보관본 불러오기',exact:true}).click();await expect(panel.getByRole('article')).toHaveCount(10);await panel.getByRole('button',{name:'이전 보관본 더 보기',exact:true}).click();await expect(panel.getByRole('article')).toHaveCount(12);passed.push('ten-row keyset pagination handles timestamp ties and excludes erased content');
 failLoad=true;await panel.getByRole('button',{name:'계정 보관본 불러오기',exact:true}).click();await expect(panel.getByRole('status')).toContainText('서비스 미준비');await expect(panel.getByRole('article')).toHaveCount(12);failLoad=false;passed.push('unavailable schema/service is an explicit failure and preserves displayed records');
 await page.clock.install();await page.evaluate(()=>window.hangAuth=true);const beforeTimeout=requests.length;
 await panel.getByRole('button',{name:'계정 보관본 불러오기',exact:true}).click();await page.clock.fastForward(15001);await expect(panel.getByRole('status')).toContainText('요청 시간이 초과');await page.evaluate(()=>{window.hangAuth=false;window.releaseAuth()});await page.clock.runFor(100);assert.equal(requests.length,beforeTimeout);passed.push('stalled auth timeout unlocks controls and suppresses late dispatch');
 await page.setViewportSize({width:320,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:out+'/archive-320.png',fullPage:true});passed.push('320px archive preview, pagination and confirmation reflow without horizontal overflow');
 hold=true;await panel.getByRole('button',{name:'계정 보관본 불러오기',exact:true}).click();await expect.poll(()=>!!release).toBe(true);
 await page.evaluate(()=>{localStorage.setItem('qa-owner','B');window.dispatchEvent(new Event('fixture-auth'))});await release();await expect(panel.getByRole('article')).toHaveCount(0);await expect(panel.getByRole('button',{name:'계정 보관본 불러오기',exact:true})).toBeDisabled();hold=false;
 await page.reload();await panel.getByRole('button',{name:'계정 보관본 불러오기',exact:true}).click();await expect(panel.getByRole('article')).toHaveCount(0);passed.push('account switch clears prior content and ignores late response; new account cannot see prior archive');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
}catch(e){failure=String(e);process.exitCode=1}
finally{writeFileSync(out+'/result.json',JSON.stringify({passed,errors,external,failure:failure??null,scope:'Actual React UI; synthetic Auth/HTTP records only. No hosted DB, microphone or AI.'},null,2));console.log(JSON.stringify({passed,errors,external,failure},null,2));await browser.close();await new Promise(r=>server.close(r))}
