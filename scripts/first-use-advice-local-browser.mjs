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

const output=resolve('scripts/browser-qa/.generated/first-use-advice');
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
    b.onResolve({filter:/\/(AppCompanion|DailyBriefing|ZephyrReadButton|AssistantCommandReview|AppIdentity|AssistantCharacter)$/},args=>({path:args.path.split('/').pop(),namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>{
      if(path==='link')return{resolveDir:process.cwd(),contents:`import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}`};
      if(path==='dynamic')return{contents:`export default function dynamic(){return ()=>null}`};
      if(path==='auth')return{contents:`
        const user=()=>{try{return{id:localStorage.getItem('fitness-cloud-sync-user')||'synthetic-A'}}catch{return null}};
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
          onAuthStateChange:fn=>{queueMicrotask(()=>{const current=user();fn('INITIAL_SESSION',current?{user:current}:null)});
            const change=()=>{const current=user();fn('SIGNED_IN',current?{user:current}:null)};window.addEventListener('fixture-auth',change);
            return{data:{subscription:{unsubscribe(){window.removeEventListener('fixture-auth',change)}}}}},
          },from:table=>makeQuery(table)};
        export const createClient=()=>supabase; export async function authenticatedFetch(url,init){return fetch(url,init)}
      `};
      if(path==='ZephyrReadButton')return{resolveDir:process.cwd(),contents:`import React from 'react';export default function Voice(p){return React.createElement('button',{'data-voice':p.text,onClick:()=>{(window.__voice??=[]).push(p.text)}},'합성 음성 버튼')}`};
      return{contents:`export const AssistantCommandReview=()=>null;export default function Stub(){return null}`};
    });
  }}],
});
const css=(await postcss([tailwindcss({content:['./app/assistant/AssistantClient.tsx','./components/FreeAdvicePanel.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css;
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

  let mode='ok',delayed;const forbidden=[];
  const origin=`http://127.0.0.1:${server.address().port}`;
  const summary={recordSource:'user-records',scope:'assistant',startDate:'2026-09-24',endDate:'2026-10-21',recordCount:1,metrics:[{id:'expenses',label:'합성 지출',value:30,unit:'USD'}],notes:['합성 자료: 서버에 저장된 기록 기준','합성 제외 안내: 충전카드 충전은 지출에서 제외']};
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin){external.push(url.href);return route.abort();}
    if(url.pathname==='/api/assistant/chat'){
      requests.push(route.request().postDataJSON());
      return route.fulfill({json:{reply:'보낼 기록부터 확인해 주세요.',adviceRequest:{scope:'assistant'},historySaved:true}});
    }
    if(url.pathname==='/api/ai/free-advice'){
      const body=route.request().postDataJSON();requests.push(body);
      if(body.action!=='preview'){forbidden.push(body);return route.abort();}
      if(mode==='delay'){delayed=route;return;}
      if(mode==='fail')return route.fulfill({status:503,json:{error:'합성 기록 조회 실패'}});
      return route.fulfill({json:{context:{...summary,recordSource:body.recordSource},fingerprint:'synthetic',configured:false}});
    }
    if(url.pathname.startsWith('/api/')){forbidden.push(url.pathname);return route.abort();}
    return route.continue();
  });
  await page.addInitScript(()=>localStorage.setItem('fitness-cloud-sync-user','synthetic-A'));
  await page.goto(origin+'/?advice=assistant');
  const chat=page.getByRole('region',{name:'연이에게 말하기'}),input=chat.getByRole('textbox',{name:'연이에게 보낼 명령'});
  await expect(input).toBeEnabled();await expect(input).not.toHaveValue('');
  await expect(page.getByLabel('대화 중 조언 확인')).toHaveCount(0);
  assert.equal(requests.length,0);
  checks.push('advice URL prefills question but does not send or open preview automatically');
  await input.press('Enter');
  const panel=page.getByLabel('대화 중 조언 확인');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('보낼 기록 요약',{exact:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'조언받을 기록 확인',exact:true}).click();
  await expect(panel.getByText('보낼 기록 요약',{exact:true})).toBeVisible();
  await expect(panel.getByText('2026-09-24 ~ 2026-10-21',{exact:false})).toBeVisible();
  await expect(panel.getByText('합성 제외 안내:',{exact:false})).toBeVisible();
  await panel.getByRole('checkbox').check();
  await expect(panel.getByRole('button',{name:'무료 AI 조언받기',exact:true})).toBeDisabled();
  checks.push('actual chat opens actual FreeAdvicePanel; preview renders source, period and omission notes; unavailable provider remains blocked even with acknowledgement');
  for(const width of [320,386,390]){await page.setViewportSize({width,height:844});assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth));}
  await page.screenshot({path:resolve(output,'preview-390.png'),fullPage:true});
  checks.push('integrated advice confirmation has no horizontal overflow at 320/386/390px');
  mode='fail';await panel.getByRole('button',{name:'최신 기록 다시 확인',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('합성 기록 조회 실패');
  await expect(panel.getByText('보낼 기록 요약',{exact:true})).toHaveCount(0);
  mode='ok';await panel.getByRole('button',{name:'조언받을 기록 확인',exact:true}).click();
  await expect(panel.getByText('보낼 기록 요약',{exact:true})).toBeVisible();
  await expect(panel.getByRole('checkbox')).not.toBeChecked();
  checks.push('failed refresh removes stale summary; retry restores preview with fresh unconfirmed acknowledgement');
  await panel.getByRole('button',{name:'조언 취소',exact:true}).click();await expect(panel).toHaveCount(0);
  checks.push('cancel closes panel without analyze or database write');
  await input.fill('내 기록을 보고 조언해줘');await input.press('Enter');await expect(panel).toBeVisible();
  mode='delay';await panel.getByRole('button',{name:'조언받을 기록 확인',exact:true}).click();
  await expect.poll(()=>Boolean(delayed)).toBe(true);
  await page.evaluate(()=>{localStorage.setItem('fitness-cloud-sync-user','synthetic-B');window.dispatchEvent(new Event('fixture-auth'));});
  await delayed.fulfill({json:{context:summary,fingerprint:'old',configured:false}});
  await expect(input).toHaveValue('');await expect(panel).toHaveCount(0);await expect(page.getByText('합성 지출',{exact:true})).toHaveCount(0);
  checks.push('account switch unmounts pending panel; late preview cannot display old account summary');
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);
  assert.deepEqual(await page.evaluate(()=>window.__writes??[]),[]);
  const result={passed:checks.length,checks,externalRequests:external.length,databaseWrites:0,forbidden,errors,limitation:'Actual AssistantClient and FreeAdvicePanel; synthetic auth/database/chat/preview. No real account, provider or voice. Not hosted validation.'};
  writeFileSync(resolve(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
