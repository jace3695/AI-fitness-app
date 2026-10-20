// Actual UI components with synthetic auth/RPC/media boundaries. No real DB,
// provider, speech API, personal records, or asset appearance certification.
import { build } from './browser-qa/node_modules/esbuild/lib/main.js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const out=resolve('scripts/browser-qa/.generated/existing-apps');mkdirSync(out,{recursive:true});
const clip=readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3').toString('base64');
const auth=`
export const createClient=()=>({auth:{
onAuthStateChange(fn){window.qa.auth.push(fn);queueMicrotask(()=>fn('INITIAL_SESSION',{user:{id:window.qa.owner}}));return{data:{subscription:{unsubscribe(){window.qa.auth=window.qa.auth.filter(x=>x!==fn)}}}}},
async getUser(){return{data:{user:{id:window.qa.owner}},error:null}}
},from(table){let filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},limit(){return q},then(resolve){const data=(window.qa.db[table]||[]).filter(r=>filters.every(([k,v])=>r[k]===v));return Promise.resolve({data:structuredClone(data),count:data.length,error:null}).then(resolve)}};return q},
async rpc(name,p){const q=window.qa;q.rpcCalls++;const owner=q.owner;
 const fail=message=>({data:null,error:{code:'P0001',message}});
 if(name==='undo_budget_category_change'){const h=q.db.budget_category_changes.find(h=>h.id===p.p_change_id&&h.user_id===owner);if(!h)return fail('다른 계정 이력');if(h.undone_at)return{error:null};const row=q.rows.find(r=>r.id===h.original.id&&r.user_id===owner);if(JSON.stringify(row)!==JSON.stringify(h.after))return fail('이후 바뀐 내역이 있어요.');Object.assign(row,h.original);h.undone_at='2026-10-31T12:00:00Z';return{error:null}}
 const old=q.db.budget_category_changes.find(h=>h.id===p.p_request_id&&h.user_id===owner);if(old)return{data:{count:old.entry_count,undone:!!old.undone_at},error:null};
 if(p.p_rows.some(x=>x.expected.user_id!==owner))return fail('계정이 달라요.');
 const x=p.p_rows[0],r=q.rows.find(r=>r.id===x.id&&r.user_id===owner);if(JSON.stringify(r)!==JSON.stringify(x.expected))return fail('다른 화면에서 바뀐 내역이에요.');
 const original=structuredClone(r),field=p.p_field||'category';r[field]=p.p_value??p.p_category;
 q.db.budget_category_changes.push({id:p.p_request_id,user_id:owner,field_name:field,field_value:r[field],category:null,entry_count:1,created_at:'2026-10-31T10:00:00Z',undone_at:null,original,after:structuredClone(r)});
 if(q.loseReply){q.loseReply=false;return{data:null,error:{code:'NETWORK'}}}return{data:{count:1,undone:false},error:null}
}});
export async function authenticatedFetch(_url,init){const body=JSON.parse(init.body);window.qa.requests.push(body);if(body.action!=='preview')throw Error('Provider requests forbidden');const context=window.qa.makeContext(body);if(window.qa.holdAdvice)await new Promise(r=>window.qa.releaseAdvice=r);if(window.qa.failAdvice)return Response.json({error:'합성 조회 오류'},{status:503});return Response.json({context,fingerprint:'synthetic',configured:false})}`;
const entry=`
import React from 'react';import{createRoot}from'react-dom/client';
import Advice from './components/FreeAdvicePanel';import Editor from './app/budget/components/category-editor';import Monthly from './app/budget/components/monthly-check';
import Panel from './components/yeoni/ReplyCharacterPanel';import{savedReplyClips,REPLY_SAMPLES}from'./lib/yeoni/reply-samples';import{buildReplyPlan}from'./lib/yeoni/reply-plan';
import{buildFreeAdviceContext,buildExampleAdviceContext}from'./lib/free-advice-context';
const root=createRoot(document.getElementById('root')),clips=savedReplyClips({ko:${JSON.stringify(clip)},ja:''}).slice(0,1);
window.qa={owner:'A',auth:[],requests:[],rpcCalls:0,rows:[{id:'a',user_id:'A',date:'2026-10-31',amount:100,place:'합성 카페',category:'기타'},{id:'b',user_id:'B',date:'2026-10-31',amount:200,place:'합성 B',category:'기타'}],db:{budget_category_changes:[],budget_category_rules:[]},
duration:REPLY_SAMPLES.ko.durationMs/1000,
makeContext:body=>body.recordSource==='example'?buildExampleAdviceContext(body.scope,new Date('2026-10-31T12:00:00Z')):buildFreeAdviceContext(body.scope,window.qa.empty?{}:{budgetCurrency:'USD',expenses:[{date:'2026-10-31',amount:30},{date:'2026-10-31',amount:100,transaction_type:'충전카드 충전'}]},new Date('2026-10-31T12:00:00Z')),
mount(mode='advice'){window.qa.mode=mode;const q=window.qa;root.render(mode==='advice'?<Advice scope="assistant"/>:mode==='budget'?<><Editor key={q.owner} userId={q.owner} records={structuredClone(q.rows.filter(r=>r.user_id===q.owner))} currency="KRW" onChanged={async()=>q.mount('budget')}/><Monthly records={structuredClone(q.rows.filter(r=>r.user_id===q.owner))} month={q.month||'2026-10'} today={q.today||'2026-10-31'} budget={1000} ready={true} currency="KRW"/></>:mode==='character'?<Panel clips={clips} incoming={q.incoming}/>:null)},
switchOwner(){window.qa.owner='B';window.qa.auth.forEach(fn=>fn('SIGNED_IN',{user:{id:'B'}}));if(window.qa.mode==='character')window.qa.incoming=null;window.qa.mount(window.qa.mode)},
loadReply(){window.qa.incoming={value:{reply:REPLY_SAMPLES.ko.spokenText,performance:buildReplyPlan(REPLY_SAMPLES.ko.spokenText,'synthetic')}};window.qa.mount('character')}
};window.qa.mount();`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:out,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'boundaries',setup(b){
  b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'auth',namespace:'fixture'}));
  b.onResolve({filter:/SwitchableCharacterStage$/},()=>({path:'stage',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='auth'?auth:'export default function Stage(){return null}',loader:'js'}));
}}]});
const css=(await postcss([tailwindcss({content:['./components/FreeAdvicePanel.tsx','./components/ConfirmDialog.tsx']})]).process(readFileSync('app/globals.css','utf8'),{from:undefined})).css+(bundle.outputFiles.find(x=>x.path.endsWith('.css'))?.text||'')+readFileSync('app/budget/budget.css','utf8');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/app.js'?bundle.outputFiles.find(x=>x.path.endsWith('.js')).text:`<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:390,height:844}});
const blocked=[];await context.route('**/*',r=>r.request().url().startsWith(base)?r.continue():(blocked.push(r.request().url()),r.abort()));
await context.addInitScript(()=>{
  const states=new WeakMap();const state=a=>{if(!states.has(a))states.set(a,{paused:true,plays:0});return states.get(a)};
  window.mediaState=state;window.pendingMedia=[];
  Object.defineProperties(HTMLMediaElement.prototype,{paused:{get(){return state(this).paused}},ended:{get(){return false}},currentSrc:{get(){return this.getAttribute('src')||''}},readyState:{get(){return 4}},duration:{get(){return window.qa.duration}}});
  HTMLMediaElement.prototype.pause=function(){state(this).paused=true;this.dispatchEvent(new Event('pause'))};
  HTMLMediaElement.prototype.load=function(){if(this.src)queueMicrotask(()=>this.dispatchEvent(new Event('loadedmetadata')))};
  HTMLMediaElement.prototype.play=function(){state(this).plays++;return new Promise(resolve=>{const finish=()=>{state(this).paused=false;this.dispatchEvent(new Event('playing'));resolve()};if(window.deferMedia)window.pendingMedia.push(finish);else finish()})};
});
const page=await context.newPage(),passed=[],errors=[];page.on('pageerror',e=>errors.push(e.message));let failure=null;
const mount=async mode=>{await page.evaluate(mode=>window.qa.mount(mode),mode)};
try{
  await page.goto(base);await page.getByRole('button',{name:'조언받을 기록 확인',exact:true}).click();
  await expect(page.getByText('2026-10-04 ~ 2026-10-31',{exact:false})).toBeVisible();
  await expect(page.getByText('30USD',{exact:true})).toHaveCount(2);
  await expect(page.getByText('직접 저장한 회화 예문',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'무료 AI 조언받기',exact:true})).toBeDisabled();
  passed.push('advice actual 28-day source, exclusions, configured currency and recharge exclusion agree with rendered metrics');
  await page.getByRole('button',{name:'예시 기록으로 먼저 보기',exact:true}).click();
  await expect(page.getByText('가상의 예시 기록',{exact:true})).toBeVisible();passed.push('example is visibly fictional');
  await page.evaluate(()=>window.qa.empty=true);await page.getByRole('button',{name:'최신 기록 다시 확인',exact:true}).click();
  await expect(page.getByText('아직 분석할 기록이 없어요.',{exact:false})).toBeVisible();
  await page.evaluate(()=>window.qa.failAdvice=true);await page.getByRole('button',{name:'최신 기록 다시 확인',exact:true}).click();
  await expect(page.getByText('합성 조회 오류',{exact:true})).toBeVisible();passed.push('empty data and retrieval error stay distinct; no provider call');
  await page.evaluate(()=>{window.qa.failAdvice=false;window.qa.empty=false;window.qa.holdAdvice=true});
  await page.getByRole('button',{name:'조언받을 기록 확인',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>!!window.qa.releaseAdvice)).toBe(true);
  await page.evaluate(()=>{window.qa.switchOwner();window.qa.releaseAdvice()});
  await expect(page.getByText('보낼 기록 요약',{exact:true})).toHaveCount(0);passed.push('late advice preview cannot repopulate after account switch');

  await page.evaluate(()=>{window.qa.owner='A';window.qa.mount('budget')});
  const selected=page.getByLabel('합성 카페 2026-10-31 내역 선택');
  await expect(selected).toBeEnabled();await selected.check();await page.getByLabel('수정할 항목').selectOption('amount');await page.getByLabel('변경할 금액').fill('150');
  await page.getByRole('button',{name:'선택 1건 금액 변경',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.qa.rpcCalls),0);passed.push('budget confirmation cancel makes no RPC');
  await page.evaluate(()=>window.qa.loseReply=true);
  await page.getByRole('button',{name:'선택 1건 금액 변경',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'금액 변경',exact:true}).dblclick();
  await expect(page.getByRole('button',{name:'같은 변경 결과 확인',exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>window.qa.db.budget_category_changes.length),1);
  await page.getByRole('button',{name:'같은 변경 결과 확인',exact:true}).click();
  await expect(page.getByText('1건의 금액 변경을 확인했어요.',{exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>window.qa.db.budget_category_changes.length),1);passed.push('budget lost reply retry and repeated confirm reuse the request ID');
  await page.getByText('변경 이력 · 최근 20건',{exact:true}).click();
  await page.getByRole('button',{name:'금액 1건 수정 되돌리기',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'되돌리기',exact:true}).click();
  await expect(page.getByText('되돌림 완료',{exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>window.qa.rows[0].amount),100);passed.push('budget undo restores original amount');
  await selected.check();await page.getByLabel('변경할 금액').fill('160');
  await page.getByRole('button',{name:'선택 1건 금액 변경',exact:true}).click();
  await page.evaluate(()=>window.qa.rows[0].amount=120);
  await page.getByRole('dialog').getByRole('button',{name:'금액 변경',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('바뀐');
  assert.equal(await page.evaluate(()=>window.qa.rows[0].amount),120);passed.push('budget stale confirmation refuses overwrite');
  await expect(page.getByText('남은 1일',{exact:false})).toBeVisible();
  await page.evaluate(()=>{window.qa.month='2026-11';window.qa.today='2026-11-01';window.qa.mount('budget')});
  await expect(page.getByText('남은 30일',{exact:false})).toBeVisible();passed.push('actual monthly calculator crosses October end without carrying prior-month expense');
  await page.evaluate(()=>window.qa.switchOwner());
  await expect(page.getByLabel('합성 B 2026-10-31 내역 선택')).toBeEnabled();
  await expect(page.getByLabel('합성 카페 2026-10-31 내역 선택')).toHaveCount(0);passed.push('budget keyed owner transition isolates records and pending edit UI');

  await page.evaluate(()=>window.qa.loadReply());
  const panel=page.getByRole('region',{name:'연이 대화 캐릭터'}); // section has accessible name
  await expect(panel).toHaveAttribute('data-reply-status','ready');
  assert.equal(await page.locator('audio').evaluate(a=>window.mediaState(a).plays),0);
  await page.evaluate(()=>window.deferMedia=true);
  await page.getByRole('button',{name:'답변 듣기',exact:true}).dblclick();
  assert.equal(await page.locator('audio').evaluate(a=>window.mediaState(a).plays),1);
  await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));window.pendingMedia.splice(0).forEach(f=>f())});
  await expect(panel).toHaveAttribute('data-speech-state','paused');passed.push('character rapid clicks issue one play; pagehide defeats late playing');
  await page.evaluate(()=>window.deferMedia=false);
  await page.getByRole('button',{name:'답변 듣기',exact:true}).click();
  await expect(panel).toHaveAttribute('data-speech-state','playing');
  await page.locator('audio').evaluate(a=>{a.muted=true;a.dispatchEvent(new Event('volumechange'));a.dispatchEvent(new Event('pause'));a.dispatchEvent(new Event('ended'))});
  await expect(panel).toHaveAttribute('data-speech-state','playing');
  assert.equal(await page.locator('audio').evaluate(a=>a.muted),true);passed.push('synthetic mute keeps one clock; stale pause/ended events do not replace current playback');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
  await expect(panel).toHaveAttribute('data-speech-state','paused');
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});
  await expect(panel).toHaveAttribute('data-speech-state','paused');passed.push('character hidden/visible transition does not autoplay');
  await page.getByRole('button',{name:'답변 듣기',exact:true}).click();
  await page.evaluate(()=>window.qa.switchOwner());
  await expect(panel).toHaveAttribute('data-reply-status','idle');
  assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);passed.push('parent account reset clears incoming character reply and stops media');
  await page.evaluate(()=>window.qa.loadReply());await expect(panel).toHaveAttribute('data-reply-status','ready');
  await page.getByRole('button',{name:'답변 듣기',exact:true}).click();
  await page.evaluate(()=>{window.oldMedia=document.querySelector('audio');window.qa.mount('empty')});
  await expect(page.locator('audio')).toHaveCount(0);
  assert.equal(await page.evaluate(()=>window.oldMedia.paused&&window.oldMedia.getAttribute('src')===null),true);passed.push('character unmount stops media and removes source');
  await page.evaluate(()=>{window.qa.holdAdvice=false;window.qa.failAdvice=false;window.qa.empty=false});
  await mount('advice');await page.setViewportSize({width:320,height:844});
  await page.getByRole('button',{name:'조언받을 기록 확인',exact:true}).click();
  await expect(page.getByText('직접 저장한 회화 예문',{exact:false})).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:out+'/advice-320.png',fullPage:true});
  passed.push('320px advice scope and omission notes render without horizontal overflow');
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
}catch(e){failure=String(e);throw e}finally{
  writeFileSync(out+'/result.json',JSON.stringify({passed,errors,blocked,failure,scope:'actual UI and media adapter; synthetic auth/RPC/media, stubbed character visual renderer; no real DB/RLS/device/provider'},null,2));
  writeFileSync(out+'/last-dom.txt',await page.locator('body').innerText());console.log(JSON.stringify({passed,errors,failure},null,2));await browser.close();await new Promise(r=>server.close(r));
}
