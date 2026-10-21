import { build } from './browser-qa/node_modules/esbuild/lib/main.js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';import tailwindcss from 'tailwindcss';
const out=resolve('scripts/browser-qa/.generated/body-history');mkdirSync(out,{recursive:true});
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Coach from './app/components/BodyCompositionCoach';createRoot(document.getElementById('root')).render(<Coach/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'synthetic-auth',setup(b){b.onResolve({filter:/(^|\/)supabase$/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`
const user=()=>({id:localStorage.getItem('fitness-cloud-sync-user')});
export const supabase={auth:{
 getUser:async()=>{if(window.fixtureHangAuth)await new Promise(resolve=>{window.fixtureReleaseAuth=resolve});return {data:{user:user()},error:null}},
 onAuthStateChange:fn=>{
  queueMicrotask(()=>fn('INITIAL_SESSION',{user:user()}));
  const change=()=>fn('SIGNED_IN',{user:user()});
  window.addEventListener('fixture-auth',change);
  return {data:{subscription:{unsubscribe(){window.removeEventListener('fixture-auth',change)}}}};
 }
}};
export async function authenticatedFetch(url,init){return fetch(url,init)};
`}));}}]});
const css=(await postcss([tailwindcss({content:['./app/components/BodyCompositionCoach.tsx','./app/components/BodyAnalysisHistory.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{padding:12px}</style><div id="root"></div><script src="/app.js"></script></html>`)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
const rows=new Map(),requests=[],external=[],errors=[],passed=[];let failSave=true,delay=false,held,failLoad=false;
page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(()=>{if(!localStorage.getItem('fitness-cloud-sync-user'))localStorage.setItem('fitness-cloud-sync-user','A');});
await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin){external.push(u.href);return route.abort()}
 if(u.pathname!== '/api/fitness/body-analysis-history')return route.continue();
 const owner=route.request().headers()['x-expected-owner'],method=route.request().method(),body=method==='POST'?route.request().postDataJSON():null;requests.push({owner,method,body});
 if(method==='POST'){const key=owner+':'+body.id;rows.set(key,rows.get(key)||{id:body.id,created_at:'2026-10-21T00:00:00Z',snapshot:body.snapshot});if(failSave){failSave=false;return route.abort('failed')}return route.fulfill({json:{entry:rows.get(key)}})}
 if(method==='DELETE'){rows.delete(owner+':'+u.searchParams.get('id'));return route.fulfill({json:{deleted:true}})}
 const entries=[...rows.entries()].filter(([k])=>k.startsWith(owner+':')).map(([,v])=>v).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id)).filter(row=>!u.searchParams.has('before')||row.created_at<u.searchParams.get('before')||row.created_at===u.searchParams.get('before')&&row.id<u.searchParams.get('beforeId'));
 const visible=entries.slice(0,20),last=visible.at(-1),payload={entries:visible,nextCursor:entries.length>20?{before:last.created_at,beforeId:last.id}:null};
 if(delay){held=()=>route.fulfill({json:payload});return;}
 if(failLoad)return route.fulfill({status:503,json:{error:'합성 이력 조회 실패'}});
 return route.fulfill({json:payload});
});
try{
 await page.goto(origin);const check=page.getByRole('button',{name:'체성분·운동 무료 점검',exact:true}),panel=page.getByRole('region',{name:'저장한 체성분 분석 이력'}),save=panel.getByRole('button',{name:'현재 점검 저장',exact:true});
 await check.click();await expect(save).toBeDisabled();assert.equal(requests.length,0);passed.push('ordinary local check sends no request and requires explicit storage consent');
 await panel.getByText('저장할 내용 확인',{exact:true}).click();await expect(panel).toContainText('기준일');await panel.getByRole('checkbox').check();
 await save.click();await expect(panel.getByRole('status')).toBeVisible();assert.equal(rows.size,1);const id=requests[0].body.id;
 await save.dblclick();await expect(panel.getByRole('status')).toContainText('계정 이력에 저장');assert.equal(rows.size,1);assert.ok(requests.filter(r=>r.method==='POST').every(r=>r.body.id===id));passed.push('lost response retry and rapid clicks reuse one immutable request ID');
 await page.reload();assert.equal(requests.filter(r=>r.method==='GET').length,0);await panel.getByRole('button',{name:'저장 이력 불러오기',exact:true}).click();await expect(panel.getByRole('article')).toHaveCount(1);await expect(panel).toContainText('현재 기록으로 다시 계산한 결과가 아닙니다');passed.push('explicit reload restores saved analysis snapshot without recalculation or automatic upload');
 await panel.getByRole('button',{name:'이력 삭제',exact:true}).click();await panel.getByRole('button',{name:'삭제 취소',exact:true}).click();assert.equal(rows.size,1);
 await panel.getByRole('button',{name:'이력 삭제',exact:true}).click();await panel.getByRole('button',{name:'삭제 확인',exact:true}).click();await expect(panel.getByRole('article')).toHaveCount(0);assert.equal(rows.size,0);passed.push('delete requires confirmation; cancel preserves snapshot; confirmed delete removes only selected history');
 for(let i=1;i<=22;i++){const id=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;rows.set('A:'+id,{id,created_at:'2026-10-21T00:00:00Z',snapshot:{version:1,source:'local-rules',date:'2026-10-21',text:'합성 과거 점검 '+i}})}
 await panel.getByRole('button',{name:'저장 이력 불러오기',exact:true}).click();await expect(panel.getByRole('article')).toHaveCount(20);await panel.getByRole('button',{name:'이전 이력 더 보기',exact:true}).click();await expect(panel.getByRole('article')).toHaveCount(22);passed.push('cursor pagination restores all older history with equal timestamps without duplicates');
 for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}await page.screenshot({path:out+'/history-390.png',fullPage:true});passed.push('saved history and confirmation reflow at 320/390px');
 failLoad=true;await panel.getByRole('button',{name:'저장 이력 불러오기',exact:true}).click();await expect(panel.getByRole('status')).toContainText('합성 이력 조회 실패');await expect(panel.getByRole('article')).toHaveCount(22);failLoad=false;passed.push('read failure is explicit and does not pretend stored history is empty');
 await page.clock.install();await page.evaluate(()=>{window.fixtureHangAuth=true});const beforeTimeout=requests.length;
 await panel.getByRole('button',{name:'저장 이력 불러오기',exact:true}).click();await page.clock.fastForward(15001);
 await expect(panel.getByRole('status')).toContainText('요청 시간이 초과');await expect(panel.getByRole('button',{name:'저장 이력 불러오기',exact:true})).toBeEnabled();
 await page.evaluate(()=>{window.fixtureHangAuth=false;window.fixtureReleaseAuth()});await page.waitForTimeout(100);assert.equal(requests.length,beforeTimeout);
 passed.push('stalled auth times out, unlocks controls and cannot dispatch after late resolution');
 delay=true;await panel.getByRole('button',{name:'저장 이력 불러오기',exact:true}).click();await expect.poll(()=>!!held).toBe(true);
 await page.evaluate(()=>{localStorage.setItem('fitness-cloud-sync-user','B');window.dispatchEvent(new Event('fixture-auth'));window.dispatchEvent(new Event('yeoni-cloud-session-changed'));});await held();await expect(panel.getByRole('article')).toHaveCount(0);await expect(save).toBeDisabled();delay=false;
 await panel.getByRole('button',{name:'저장 이력 불러오기',exact:true}).click();await expect(panel).toContainText('저장한 분석 이력이 없습니다');assert.equal(rows.size,22);passed.push('account switch clears prior history and draft; late response cannot repopulate it');
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 writeFileSync(out+'/result.json',JSON.stringify({passed,errors,external,scope:'Actual coach/history UI, synthetic auth/HTTP database; no hosted DB or provider'},null,2));console.log(JSON.stringify({passed,errors,external},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
