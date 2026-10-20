// Actual conversation/review pages and device speech utility. Synthetic auth,
// storage, and speech only; all non-loopback requests are blocked.
import { build } from './browser-qa/node_modules/esbuild/lib/main.js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const out=resolve('scripts/browser-qa/.generated/japanese-conversation');mkdirSync(out,{recursive:true});
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Conversation from './app/language/conversation/page';import Review from './app/language/review/page';createRoot(document.getElementById('root')).render(location.pathname.includes('review')?<Review/>:<Conversation/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:out,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'synthetic-auth',setup(b){
  b.onResolve({filter:/(^|\/)supabase(\.ts)?$/},()=>({path:'auth',namespace:'fixture'}));
  b.onResolve({filter:/next\/link$/},()=>({path:'link',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>path==='link'?{resolveDir:process.cwd(),contents:`import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}`}:{contents:`
    export const supabase={auth:{
      getUser:async()=>{const result={data:{user:{id:localStorage.getItem('qa-auth-owner')||'A'}},error:null};if(window.__holdAuth)return new Promise(resolve=>window.__finishAuth=()=>resolve(result));return result;},
      onAuthStateChange:fn=>{const listener=()=>fn('SIGNED_IN',{user:{id:localStorage.getItem('qa-auth-owner')||'A'}});window.addEventListener('qa-auth',listener);return{data:{subscription:{unsubscribe:()=>window.removeEventListener('qa-auth',listener)}}};}
    }};export async function authenticatedFetch(){throw Error('external service forbidden')}`});
}}]});
const css=(await postcss([tailwindcss({content:['./components/language/FreeConversationPractice.tsx']})]).process(readFileSync('app/globals.css','utf8'),{from:undefined})).css+(bundle.outputFiles.find(f=>f.path.endsWith(".css"))?.text||"")+readFileSync('app/language/language.css','utf8');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/app.js'?bundle.outputFiles.find(f=>f.path.endsWith(".js")).text:`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div class="language-app-shell"><main class="app-main" id="root"></main></div><script src="/app.js"></script></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:390,height:844}});
const blocked=[];await context.route('**/*',r=>{if(r.request().url().startsWith(base))return r.continue();blocked.push(r.request().url());return r.abort();});
await context.addInitScript(()=>{
  if(!localStorage.getItem('qa-initialized')){localStorage.setItem('qa-initialized','1');localStorage.setItem('language-cloud-sync-user','A');localStorage.setItem('savedSentences',JSON.stringify([{japanese:'合成の文です。',meaning:'합성 이전 문장',category:'일상',note:'preserve'}]));}
  window.__voicesReady=true;window.__spoken=[];window.__cancelled=0;window.__voiceListeners=[];
  window.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
    getVoices:()=>window.__voicesReady?[{lang:'ja-JP',name:'Synthetic Japanese',localService:true}]:[],
    addEventListener:(_,fn)=>window.__voiceListeners.push(fn),
    removeEventListener:(_,fn)=>window.__voiceListeners=window.__voiceListeners.filter(x=>x!==fn),
    speak:u=>{window.__spoken.push(u.text);window.__utterance=u;},
    cancel:()=>window.__cancelled++,
  }});
});
const page=await context.newPage(),errors=[],passed=[];page.on('pageerror',e=>errors.push(e.message));let failure=null;
const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('savedSentences')));
try{
  await page.goto(base+'/language/conversation');
  await expect(page.getByLabel('상황',{exact:true})).toBeEnabled();
  for (const width of [320,390]) {
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
    await page.screenshot({path:out+`/conversation-${width}.png`,fullPage:true});
  }
  passed.push('320px and 390px initial practice layout has no horizontal overflow');
  const initial=await stored();
  for(const situation of ['카페','여행','일상','업무','친구']){
    await page.getByLabel('상황',{exact:true}).selectOption(situation);
    await page.getByRole('button',{name:'이 예문으로 시작',exact:true}).click();
    const options=page.getByRole('group',{name:'어떻게 답할까요? 뜻을 보고 골라요.'}).getByRole('button');
    assert.equal(await options.count(),2);
    for(let i=0;i<2;i++){
      await options.nth(i).click();await expect(page.getByRole('article',{name:'상대방의 마무리'})).toBeVisible();
      if(!i)await page.getByRole('button',{name:'다른 답으로 연습',exact:true}).click();
    }
    assert.deepEqual(await stored(),initial);passed.push(`${situation}: both fixed branches, no automatic bookmarks`);
  }
  await page.getByRole('button',{name:'처음부터 다시 연습',exact:true}).click();
  await page.getByLabel('예문 직접 입력').fill('これは別の文です。');
  await page.getByRole('button',{name:'준비된 예문 확인',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('틀렸다는 뜻은 아니에요');
  assert.equal(await page.evaluate(()=>localStorage.getItem('wrongSentences')),null);passed.push('unmatched input is not an error score or persisted wrong answer');
  const card=page.getByRole('article',{name:'내가 먼저 하는 말'});
  await card.getByRole('button',{name:'이 예문 복습에 저장',exact:true}).dblclick();
  await expect(page.getByRole('status')).toContainText('복습 목록');
  assert.equal((await stored()).length,2);assert.deepEqual((await stored())[0],initial[0]);passed.push('explicit repeated bookmark preserves legacy entry and adds exactly one');
  await page.reload();await expect(page.getByLabel('상황',{exact:true})).toBeEnabled();
  await page.getByLabel('상황',{exact:true}).selectOption('친구');
  await card.getByRole('button',{name:'이 예문 복습에 저장',exact:true}).click();await expect(page.getByRole('status')).toContainText('이미');assert.equal((await stored()).length,2);
  await page.getByRole('link',{name:'저장한 문장 복습하기',exact:true}).click();
  await expect(page.getByText('一緒にご飯を食べよう。',{exact:true})).toBeVisible();
  await page.goBack();await expect(page.getByLabel('상황',{exact:true})).toBeEnabled();passed.push('reentry deduplicates, real review renders selected sentence, back returns');
  await card.getByRole('button',{name:'듣기',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__spoken.length)).toBe(1);
  await page.getByLabel('상황',{exact:true}).selectOption('카페');await expect(page.getByRole('button',{name:'음성 멈추기',exact:true})).toBeDisabled();
  const count=await page.evaluate(()=>window.__spoken.length);
  await page.evaluate(()=>{window.__voicesReady=false;});
  await card.getByRole('button',{name:'듣기',exact:true}).click();
  await page.getByRole('button',{name:'처음부터 다시 연습',exact:true}).click();
  await page.evaluate(()=>{window.__voicesReady=true;window.__voiceListeners.forEach(fn=>fn());});
  await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>window.__spoken.length),count);passed.push('situation change cancels playing speech; reset cancels late voice availability');
  await card.getByRole('button',{name:'듣기',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__spoken.length)).toBe(count+1);
  await page.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate')));
  await expect(page.getByRole('button',{name:'음성 멈추기',exact:true})).toBeDisabled();passed.push('back navigation cancels device speech');
  await page.evaluate(()=>{window.__voicesReady=false;});
  await card.getByRole('button',{name:'듣기',exact:true}).click();
  await page.getByRole('link',{name:'저장한 문장 복습하기',exact:true}).click();
  await expect(page.getByText('一緒にご飯を食べよう。',{exact:true})).toBeVisible();
  await page.goBack();await expect(page.getByLabel('상황',{exact:true})).toBeEnabled();
  assert.equal(await page.evaluate(()=>window.__spoken.length),0);
  passed.push('review navigation during pending speech and return do not restart audio');
  await card.getByRole('button',{name:'듣기',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__spoken.length)).toBe(1);
  await page.evaluate(()=>{window.__oldUtterance=window.__utterance;window.__cancelBefore=window.__cancelled;});
  await card.getByRole('button',{name:'처음부터 듣기',exact:true}).dblclick();
  await expect.poll(()=>page.evaluate(()=>window.__spoken.length)).toBe(2);
  assert.ok(await page.evaluate(()=>window.__cancelled>window.__cancelBefore));
  await page.evaluate(()=>window.__oldUtterance.onend());
  await expect(page.getByRole('button',{name:'음성 멈추기',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'음성 멈추기',exact:true}).click();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.__spoken.length),2);
  passed.push('rapid replay cancels old utterance; old completion cannot clear current playback; explicit stop stays stopped');
  await page.evaluate(()=>{window.__voicesReady=false;});
  await card.getByRole('button',{name:'듣기',exact:true}).click();
  await page.evaluate(()=>{window.__holdAuth=true;});
  await card.getByRole('button',{name:'이 예문 복습에 저장',exact:true}).click();
  const savedA=await stored();
  await page.evaluate(()=>{localStorage.setItem('qa-auth-owner','B');localStorage.setItem('language-cloud-sync-user','B');localStorage.setItem('savedSentences','[]');window.dispatchEvent(new Event('qa-auth'));window.__holdAuth=false;window.__finishAuth();});
  await expect(page.getByLabel('상황',{exact:true})).toBeDisabled();assert.deepEqual(await stored(),[]);passed.push('account switch blocks late bookmark and clears in-memory practice');
  await page.evaluate(()=>{window.__voicesReady=true;window.__voiceListeners.forEach(fn=>fn());});
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(()=>window.__spoken.length),2);
  await expect(page.getByRole('button',{name:'음성 멈추기',exact:true})).toBeDisabled();
  passed.push('account switch cancels pending voice and late voice availability cannot restart playback');
  await page.reload();await expect(page.getByLabel('상황',{exact:true})).toBeEnabled();
  await page.getByRole('link',{name:'저장한 문장 복습하기',exact:true}).click();await expect(page.getByText('一緒にご飯を食べよう。',{exact:true})).toHaveCount(0);
  assert.equal(savedA.length,2);passed.push('owner B review contains no A bookmarks');
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
}catch(e){failure=String(e);throw e;}finally{
  writeFileSync(out+'/result.json',JSON.stringify({passed,errors,blocked,failure,scope:'actual pages/device speech utility, synthetic auth/storage/speech; no actual account/voice/provider'},null,2));
  writeFileSync(out+'/last-dom.txt',await page.locator('body').innerText());console.log(JSON.stringify({passed,errors,failure},null,2));await browser.close();await new Promise(r=>server.close(r));
}
