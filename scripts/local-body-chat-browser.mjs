// Actual AssistantClient routing and rendering. All auth/database/API services
// are synthetic; no account, cloud write, provider or speech request is allowed.
import { build } from './browser-qa/node_modules/esbuild/lib/main.js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const output=resolve('scripts/browser-qa/.generated/local-body-chat');
mkdirSync(output,{recursive:true});
const bundle=await build({
  stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';
    import AssistantClient from './app/assistant/AssistantClient';
    createRoot(document.getElementById('root')).render(<AssistantClient/>);`,
    resolveDir:process.cwd(),loader:'tsx'},
  bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},
  plugins:[{name:'synthetic-services',setup(b){
    b.onResolve({filter:/(^|\/)supabase$/},()=>({path:'auth',namespace:'fixture'}));
    b.onResolve({filter:/next\/link$/},()=>({path:'link',namespace:'fixture'}));
    b.onResolve({filter:/next\/dynamic$/},()=>({path:'dynamic',namespace:'fixture'}));
    b.onResolve({filter:/\/(AppCompanion|DailyBriefing|FreeAdvicePanel|ZephyrReadButton|AssistantCommandReview|AppIdentity|AssistantCharacter)$/},args=>({path:args.path.split('/').pop(),namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>{
      if(path==='link')return{resolveDir:process.cwd(),contents:`import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}`};
      if(path==='dynamic')return{contents:`export default function dynamic(){return ()=>null}`};
      if(path==='auth')return{contents:`
        const user=()=>({id:localStorage.getItem('fitness-cloud-sync-user')||'synthetic-A'});
        const makeQuery=table=>{const query=new Proxy({}, {get(_,key){
          if(key==='then')return resolve=>{
            if(table==='assistant_chat_messages'&&window.__failHistory)throw Error('synthetic history network failure');
            const result={data:table==='assistant_chat_messages'?(window.__history??[]):[],error:null,count:0};
            if(table==='assistant_chat_messages'&&window.__holdHistory){window.__holdHistory=false;window.__finishHistory=()=>resolve(result);}
            else resolve(result);
          };
          if(key==='single'||key==='maybeSingle')return async()=>({data:null,error:null});
          return (...args)=>{if(['insert','update','delete','upsert'].includes(key)){(window.__writes??=[]).push(key);throw Error('write forbidden')}
            return query};
        }});return query;};
        export const supabase={auth:{
          getUser:async()=>({data:{user:user()}}),
          getSession:async()=>({data:{session:{user:user(),access_token:'synthetic-token'}}}),
          onAuthStateChange:fn=>{queueMicrotask(()=>fn('INITIAL_SESSION',{user:user()}));
            const change=()=>fn('SIGNED_IN',{user:user()});window.addEventListener('fixture-auth',change);
            return{data:{subscription:{unsubscribe(){window.removeEventListener('fixture-auth',change)}}}}},
          },from:table=>makeQuery(table)};
        export async function authenticatedFetch(){throw Error('unexpected authenticated fetch')}
      `};
      if(path==='ZephyrReadButton')return{resolveDir:process.cwd(),contents:`import React from 'react';export default function Voice(p){return React.createElement('button',{'data-voice':p.text,onClick:()=>{(window.__voice??=[]).push(p.text)}},'합성 음성 버튼')}`};
      return{contents:`export const AssistantCommandReview=()=>null;export default function Stub(){return null}`};
    });
  }}],
});
const css=(await postcss([tailwindcss({content:['./app/assistant/AssistantClient.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css;
const server=createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html;charset=utf-8');
  res.end(req.url==='/app.js'?bundle.outputFiles[0].text:`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;font-family:sans-serif}</style><div id="root"></div><script src="/app.js"></script></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
const checks=[];
try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage(),errors=[],requests=[],external=[];
  let apiMode='normal', delayedRoute;
  page.on('pageerror',error=>errors.push(error.message));
  const origin=`http://127.0.0.1:${server.address().port}`;
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin){external.push(url.href);return route.abort();}
    if(url.pathname==='/api/assistant/chat'){
      requests.push(route.request().postDataJSON());
      if(apiMode==='fail')return route.abort('failed');
      if(apiMode==='delay'){delayedRoute=route;return;}
      if(apiMode==='health')return route.fulfill({json:{reply:'BMI SERVER_BODY',historySaved:true}});
      return route.fulfill({json:{reply:'합성 일반 응답',historySaved:true}});
    }
    return route.continue();
  });
  await page.clock.install({time:new Date('2026-10-20T12:00:00Z')});
  await page.addInitScript(()=>{
    localStorage.setItem('fitness-cloud-sync-user','synthetic-A');
    localStorage.setItem('ai-fitness-inbody-records',JSON.stringify({'2026-10-20':{bmi:23}}));
  });
  await page.goto(origin);
  const chat=page.getByRole('region',{name:'연이에게 말하기'});
  const input=chat.getByRole('textbox',{name:'연이에게 보낼 명령'});
  const ask=async text=>{await input.fill(text);await input.press('Enter');};
  await expect(input).toBeEnabled();
  const saved=await page.evaluate(()=>JSON.stringify({...localStorage}));
  await ask('인바디 분석해줘');
  await expect(chat.getByText(/무료 로컬 점검 · 서버 전송/)).toBeVisible();
  assert.equal(requests.length,0);
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),saved);
  await expect(chat.locator('[data-voice]')).toHaveCount(0);
  await chat.getByText('대화 메뉴',{exact:true}).click();
  await expect(chat.getByRole('button',{name:'대화 지우기',exact:true})).toBeDisabled();
  await chat.getByText('대화 메뉴',{exact:true}).click();
  checks.push('actual general chat answers body question locally with no API, storage write or TTS button');
  await ask('오늘 할 일 보여줘');
  await expect(chat.getByText('합성 일반 응답',{exact:true})).toBeVisible();
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].history,[]);
  checks.push('subsequent ordinary command retains route but excludes local question and answer from request history');
  await ask('BMI 23 저장해줘');
  await expect(chat.getByText(/이 답변은 저장·삭제·계획 적용 명령을 실행하지 않습니다/)).toHaveCount(2);
  assert.equal(requests.length,1);
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),saved);
  checks.push('body write request produces capability boundary without remote request or command execution');
  await chat.getByRole('button',{name:'로컬 대화만 비우기'}).click();
  await expect(chat.getByText(/무료 로컬 점검 · 서버 전송/)).toHaveCount(0);
  await expect(chat.getByText('합성 일반 응답',{exact:true})).toBeVisible();
  checks.push('local history clear leaves ordinary conversation and database untouched');
  await ask('근육량으로 진단해줘');
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:844});
    assert.ok(await chat.evaluate(el=>el.scrollWidth<=el.clientWidth));
  }
  checks.push('chat layout 320/390/1280px');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(output,'chat-390.png'),fullPage:true});
  await page.evaluate(()=>window.dispatchEvent(new Event('yeoni-records-changed')));
  await expect(chat.getByText(/무료 로컬 점검 · 서버 전송/)).toHaveCount(0);
  checks.push('record refresh clears local health conversation');
  await ask('체성분 점검');
  await page.evaluate(()=>{
    localStorage.setItem('fitness-cloud-sync-user','synthetic-B');
    window.dispatchEvent(new Event('fixture-auth'));
  });
  await expect(chat.getByText(/무료 로컬 점검 · 서버 전송/)).toHaveCount(0);
  await ask('체성분 점검');
  await expect(chat.getByText(/계정 또는 로컬 기록을 확인하지 못했습니다/)).toBeVisible();
  assert.equal(requests.length,1);
  checks.push('auth owner switch without cloud event clears old health context and blocks reads until remount');
  await page.reload();
  await expect(input).toBeEnabled();
  await expect(chat.getByText(/이 화면에서만 보는 로컬 대화/)).toHaveCount(0);
  checks.push('reload does not restore local health history');
  await ask('인바디 점검');
  await page.evaluate(()=>window.dispatchEvent(new Event('yeoni-cloud-session-changed')));
  await expect(chat.getByText(/무료 로컬 점검 · 서버 전송/)).toHaveCount(0);
  await ask('인바디 점검');
  await expect(chat.getByText(/계정 또는 로컬 기록을 확인하지 못했습니다/)).toBeVisible();
  checks.push('cloud session event also invalidates local context');
  await page.reload();
  await expect(input).toBeEnabled();
  await page.evaluate(()=>{Storage.prototype.getItem=()=>{throw Error('synthetic read failure')};});
  await ask('BMI 점검');
  await expect(chat.getByText(/계정 또는 로컬 기록을 확인하지 못했습니다/)).toBeVisible();
  assert.equal(requests.length,1);
  checks.push('storage error stays local without fallback to external AI');
  await page.reload();await expect(input).toBeEnabled();
  await ask('체성분 점검');
  const beforeFollowups=requests.length;
  for(const question of ['그럼 23은 괜찮아?','이전 답변 읽어줘','다시 시도해줘']){
    await ask(question);
  }
  assert.equal(requests.length,beforeFollowups);
  await expect(chat.getByText(/체성분 대화의 후속 질문은 서버로 보내지 않습니다/)).toHaveCount(3);
  await expect(chat.locator('[data-voice]')).toHaveCount(0);
  checks.push('keyword-free follow-ups, read-aloud requests and retries remain local without voice controls');
  await ask('오늘 할 일 보여줘');
  await expect(chat.getByText('합성 일반 응답',{exact:true})).toBeVisible();
  assert.deepEqual(requests.at(-1).history,[]);
  await chat.getByRole('button',{name:'기존 일반 대화로 돌아가기'}).click();
  await ask('프랑스 수도는?');
  await expect(chat.getByText('합성 일반 응답',{exact:true})).toHaveCount(2);
  assert.equal(requests.at(-1).message,'프랑스 수도는?');
  await chat.locator('[data-voice]').last().click();
  assert.deepEqual(await page.evaluate(()=>window.__voice),['합성 일반 응답']);
  checks.push('exact ordinary query and explicit general-mode question work; only ordinary response has voice action');
  apiMode='fail';
  await ask('일반 질문 실패 확인');
  await expect(chat.getByText(/Failed to fetch/)).toBeVisible();
  apiMode='normal';
  await ask('일반 질문 재시도');
  await expect(chat.getByText('합성 일반 응답',{exact:true})).toHaveCount(3);
  assert.ok(requests.at(-1).history.every(item=>!(/체성분|23|서버로 보내지|Failed to fetch/.test(item.text))));
  checks.push('network failure and ordinary retry do not forward protected content or error text');
  apiMode='health';
  await ask('일반 응답 보호 검사');
  await expect(chat.getByText('BMI SERVER_BODY',{exact:true})).toBeVisible();
  await expect(chat.locator('[data-voice*="SERVER_BODY"]')).toHaveCount(0);
  const afterHealthReply=requests.length;
  await ask('그 수치는 무슨 뜻이야?');
  assert.equal(requests.length,afterHealthReply);
  await chat.getByRole('button',{name:'기존 일반 대화로 돌아가기'}).click();
  checks.push('unexpected body-related response is excluded from speech and activates local follow-up protection');
  apiMode='delay';
  await ask('지연 응답 확인');
  await expect.poll(()=>Boolean(delayedRoute)).toBe(true);
  await page.evaluate(()=>{
    localStorage.setItem('fitness-cloud-sync-user','synthetic-B');
    window.dispatchEvent(new Event('fixture-auth'));
  });
  await delayedRoute.fulfill({json:{reply:'체성분 OLD_SECRET',historySaved:true}});
  apiMode='normal';
  await expect(input).toBeEnabled();
  await expect(chat.getByText(/OLD_SECRET/)).toHaveCount(0);
  await expect(chat.locator('[data-voice]')).toHaveCount(0);
  checks.push('late response after account switch cannot render or create voice controls');
  await page.addInitScript(()=>{window.__history=[
    {id:'old-answer',role:'assistant',content:'이전 수치는 23. PRIVATE_OLD',action_label:'조언',action_href:'/assistant?advice=fitness'},
    {id:'old-question',role:'user',content:'과거 체성분 질문 PRIVATE_OLD',action_label:null,action_href:null},
  ];});
  await page.reload();await expect(input).toBeEnabled();
  await expect(chat.getByText(/이전 대화 · 읽기 전용/)).toHaveCount(2);
  await expect(chat.locator('[data-voice]')).toHaveCount(0);
  await expect(chat.getByRole('link',{name:'조언 →'})).toHaveCount(0);
  const beforeRestored=requests.length;
  await ask('그건 무슨 뜻이야?');
  assert.equal(requests.length,beforeRestored);
  await ask('오늘 할 일 보여줘');
  await expect(chat.getByText('합성 일반 응답',{exact:true})).toBeVisible();
  assert.deepEqual(requests.at(-1).history,[]);
  checks.push('restored health conversation is read-only, no voice/action link, ambiguous follow-up local and excluded from ordinary request');
  await page.evaluate(()=>{
    window.__history=[{id:'late-history',role:'assistant',content:'체성분 LATE_HISTORY',action_label:null,action_href:null}];
    window.__holdHistory=true;
    localStorage.setItem('fitness-cloud-sync-user','synthetic-C');
    window.dispatchEvent(new Event('fixture-auth'));
  });
  await page.waitForFunction(()=>typeof window.__finishHistory==='function');
  await page.evaluate(()=>{
    window.__history=[];
    localStorage.setItem('fitness-cloud-sync-user','synthetic-D');
    window.dispatchEvent(new Event('fixture-auth'));
  });
  await expect(input).toBeEnabled();
  await page.evaluate(()=>window.__finishHistory());
  await expect(chat.getByText(/LATE_HISTORY|PRIVATE_OLD/)).toHaveCount(0);
  checks.push('late history restoration cannot overwrite another account conversation');
  await page.evaluate(()=>{
    window.__failHistory=true;
    localStorage.setItem('fitness-cloud-sync-user','synthetic-E');
    window.dispatchEvent(new Event('fixture-auth'));
  });
  await expect(input).toBeEnabled();
  await expect(chat.getByRole('status')).toContainText('지난 대화를 불러오지 못했어요');
  await expect(chat.getByText(/LATE_HISTORY|PRIVATE_OLD/)).toHaveCount(0);
  checks.push('history network failure gives explicit notice and never restores another account data');
  assert.ok(requests.every(request=>!(/PRIVATE_OLD|OLD_SECRET|LATE_HISTORY|SERVER_BODY|그럼 23|체성분/.test(JSON.stringify(request)))));
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  assert.deepEqual(await page.evaluate(()=>window.__writes??[]),[]);
  const result={passed:checks.length,checks,externalRequests:external.length,databaseWrites:0,errors,
    limitation:'Actual AssistantClient, synthetic auth/DB/API and visual child stubs. Not hosted or real account QA.'};
  writeFileSync(resolve(output,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
