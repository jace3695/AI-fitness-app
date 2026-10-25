import { startOwnedNext,stopOwnedNext } from './owned-next-local.mjs';
import { mkdirSync,writeFileSync,appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium,expect } from '@playwright/test';
const evidence=process.argv.find(x=>x.startsWith('--evidence='))?.slice(11);if(evidence&&!/^[a-z0-9-]+$/.test(evidence))throw Error('Invalid local evidence label');const out=resolve('scripts/browser-qa/.generated/home-first-action'+(evidence?'/'+evidence:''));mkdirSync(out,{recursive:true});
const languageRows=new Map();
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SystemRoot|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(k)));
Object.assign(env,{NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:4318',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_local_only',YEONI_COMMON_CHARACTER_ENABLED:'1',NODE_OPTIONS:'--require '+JSON.stringify(resolve('scripts/next-local-network-guard.cjs'))});
const log=out+'/server.log';writeFileSync(log,'');
let owned;
const origin='http://127.0.0.1:4317';let browser;const passed=[],errors=[],consoleErrors=[],blocked=[],requests=[];let failure;const beforeUnloadEvents=[],resources=[];let activePage;
const user={id:'00000000-0000-4000-8000-000000000701',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const token=b64({alg:'none',typ:'JWT'})+'.'+b64({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})+'.synthetic';
try{
 owned=await startOwnedNext({env,log});

 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript(()=>{window.__qaLockEvents=[];const locks=navigator.locks;if(locks){const request=locks.request.bind(locks);locks.request=function(...args){const at=performance.now();window.__qaLockEvents.push({event:'requested',at});const index=args.length-1,callback=args[index];args[index]=async function(lock){window.__qaLockEvents.push({event:'acquired',at:performance.now()});try{return await callback(lock)}finally{window.__qaLockEvents.push({event:'released',at:performance.now()})}};return request(...args);};}});
 await context.addInitScript(()=>{const listeners=new Set();const add=window.addEventListener.bind(window),remove=window.removeEventListener.bind(window);window.addEventListener=function(type,fn,...rest){if(type==="beforeunload")listeners.add(fn);return add(type,fn,...rest)};window.removeEventListener=function(type,fn,...rest){if(type==="beforeunload")listeners.delete(fn);return remove(type,fn,...rest)};window.__unloadReadiness=()=>{const probe=new Event("beforeunload",{cancelable:true});window.dispatchEvent(probe);return{listeners:listeners.size,prevented:probe.defaultPrevented,hasBeenActive:navigator.userActivation?.hasBeenActive??null,isActive:navigator.userActivation?.isActive??null,documentMarker:window.__draftNextDocument}};});
 await context.addInitScript(({token,user})=>{const expires_at=Math.floor(Date.now()/1000)+3600;localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic-only',expires_in:3600,expires_at,token_type:'bearer',user}));},{token,user});
 await context.addInitScript(()=>{Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>Promise.reject(Error('Real microphone forbidden in QA'))}})});
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.origin==='http://127.0.0.1:4318'){
   requests.push({path:u.pathname,method:req.method()});
   if(u.pathname==='/auth/v1/user')return route.fulfill({json:user});
   if(u.pathname.startsWith('/rest/v1/')){
    if(u.pathname.endsWith('/language_user_state')){
     if(req.method()==='POST'){const row=req.postDataJSON();languageRows.set(row.user_id,row)}
     if(req.method()==='PATCH'){const owner=u.searchParams.get('user_id')?.replace(/^eq\./,'');languageRows.set(owner,{...languageRows.get(owner),...req.postDataJSON()})}
     const owner=u.searchParams.get('user_id')?.replace(/^eq\./,'')||user.id;
     const row=languageRows.get(owner)||null;
     return route.fulfill({json:req.headers().accept?.includes('object+json')?row:row?[row]:[]});
    }
    const rows=u.pathname.endsWith('/budget_profiles')?[{user_id:user.id,nickname:'합성 계정'}]:[];
    return route.fulfill({status:200,headers:{'content-range':rows.length?'0-0/1':'*/0','access-control-expose-headers':'content-range'},json:req.headers().accept?.includes('object+json')?(rows[0]??null):rows});
   }
   return route.fulfill({status:400,json:{error:'unhandled synthetic service request'}});
  }
  if(u.origin!==origin){blocked.push(u.origin);return route.abort();}
  if(u.pathname.startsWith('/api/')){
   requests.push({path:u.pathname,method:req.method()});
   if(u.pathname==='/api/pin')return route.fulfill({json:{configured:false}});
   if(u.pathname==='/api/fitness/coach/history'&&req.method()==='GET')return route.fulfill({json:{reviews:[]}});
   if(u.pathname==='/api/assistant/chat'&&req.method()==='GET')return route.fulfill({json:{messages:[]}});
   return route.fulfill({status:503,json:{error:'Isolated QA: service unavailable'}});
  }
  return route.continue();
 });
 const page=await context.newPage();activePage=page;page.on('request',r=>{if(r.url().startsWith(origin))resources.push({event:'request',path:new URL(r.url()).pathname,type:r.resourceType(),at:Date.now()})});page.on('requestfailed',r=>{if(r.url().startsWith(origin))resources.push({event:'failed',path:new URL(r.url()).pathname,error:r.failure()?.errorText,at:Date.now()})});page.on('requestfinished',r=>{if(r.url().startsWith(origin))resources.push({event:'finished',path:new URL(r.url()).pathname,at:Date.now()})});page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());if(m.text().startsWith('__qa_unload__'))beforeUnloadEvents.push(JSON.parse(m.text().slice(13)))});
 page.on('response',async r=>{if(r.url().startsWith(origin))resources.push({event:'response',path:new URL(r.url()).pathname,type:r.request().resourceType(),status:r.status(),at:Date.now()});if(r.request().resourceType()==='script'&&r.url().startsWith(origin)){const data=await r.body().catch(()=>null);if(data)writeFileSync(out+'/chunk-'+Buffer.from(r.url()).toString('base64url').slice(-100)+'.txt',data)}});
 let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss()});
 await page.goto(origin+'/',{waitUntil:'networkidle'});const input=page.locator('#assistant-chat-input');await expect(input).toBeEnabled({timeout:30000});
 const chat=page.locator('#yeoni-chat'),form=chat.locator('form').first();const recommendations=chat.locator('section[aria-label="추천 질문"]');
 await expect(input).toHaveAttribute('aria-describedby','assistant-start-help');await expect(chat.locator('#assistant-start-help')).toBeVisible();await expect(form.getByRole('button',{name:'보내기',exact:true})).toBeDisabled();passed.push('visible short instruction describes labelled input and empty send stays disabled');
 const order=await chat.evaluate(el=>{const form=el.querySelector('form'),samples=el.querySelector('section[aria-label="추천 질문"]');return !!form&&!!samples&&!!(form.compareDocumentPosition(samples)&Node.DOCUMENT_POSITION_FOLLOWING)});if(!order)throw Error('Input must precede recommendations');
 await page.screenshot({path:out+'/after-390.png',fullPage:false});
 const buttons=recommendations.locator('button');const sample=buttons.nth(1);const selected=await sample.innerText();await sample.focus();await page.keyboard.press('Enter');await expect(input).toHaveValue(selected);await expect(input).toBeFocused();await expect(buttons.first()).toBeDisabled();passed.push('keyboard recommendation fills only and protects nonempty draft');
 await input.fill('내가 쓰던 문장');await expect(buttons.nth(2)).toBeDisabled();await expect(input).toHaveValue('내가 쓰던 문장');await input.fill('');const old=await sample.innerText();await buttons.first().focus();await page.keyboard.press('Enter');await expect(sample).not.toHaveText(old);passed.push('editing is preserved and explicit other-question control rotates after clearing');
 const archive=chat.locator('section[aria-label="대화 보관함 입구"]');await expect(archive.getByRole('button',{name:'보관함',exact:true})).toHaveAttribute('aria-expanded','false');await archive.getByRole('button',{name:'보관함',exact:true}).click();await expect(archive.getByRole('button',{name:'보관함 닫기',exact:true})).toHaveAttribute('aria-expanded','true');writeFileSync(out+'/archive-open.json',JSON.stringify(await archive.evaluate(el=>({html:el.outerHTML,focused:document.activeElement?.outerHTML})),null,2));const panel=archive.getByRole('region',{name:'보관함 상세'});await expect(panel).toBeVisible();const checks=panel.getByRole('checkbox');for(let i=0;i<await checks.count();i++)await expect(checks.nth(i)).not.toBeChecked();await expect(panel).toContainText('삭제');await expect(panel).toContainText('동의');passed.push('archive remains collapsed initially and opening preserves unchecked consent and deletion information');
 await archive.getByRole('button',{name:'보관함 닫기',exact:true}).click();await input.focus();for(const width of [390,1280]){await page.setViewportSize({width,height:844});await input.scrollIntoViewIfNeeded();const b=await input.boundingBox();if(!b||b.x<0||b.x+b.width>width||b.y+b.height>750)throw Error('Input outside accessible viewport');const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Horizontal overflow');await page.screenshot({path:out+'/after-'+width+'.png',fullPage:false});}passed.push('390px and desktop input visible above bottom navigation with no horizontal overflow');
 const opener=archive.getByRole('button',{name:'보관함',exact:true});await opener.focus();await expect(opener).toBeFocused();await page.keyboard.press('Enter');await expect(panel).toBeVisible();await expect(panel).toContainText('외부 AI·음성 서비스로 전송하지 않습니다');await expect(panel).toContainText('계정 삭제까지');await expect(panel).toContainText('복구할 수 없습니다');await expect(panel).toContainText('요청 ID');await panel.getByRole('button',{name:'닫기',exact:true}).focus();await page.keyboard.press('Enter');await expect(opener).toBeFocused();await expect(opener).toHaveAttribute('aria-expanded','false');passed.push('keyboard archive open and close retains focus and complete privacy retention deletion notices');
 const host=page.locator('[data-yeoni-common-host]');await expect(host).toHaveCount(1);const controls=host.locator('button');await expect(controls.first()).toBeVisible();await controls.first().focus();await expect(controls.first()).toBeFocused();await page.keyboard.press('Tab');await expect(controls.nth(1)).toBeFocused();await page.setViewportSize({width:390,height:844});await controls.first().scrollIntoViewIfNeeded();const cb=await controls.first().boundingBox();if(!cb||cb.x<0||cb.x+cb.width>390)throw Error('Character control outside390px');passed.push('one common character host remains reachable by keyboard and within390px without changing preferences');


 if(requests.some(r=>r.method==='POST'&&/\/api\/(assistant\/chat|claude|language\/practice|speech|tts)/.test(r.path)))throw Error('Unexpected model/audio request');
 if(blocked.length)throw Error('Unexpected external request attempted');
}catch(e){failure=e.stack;const active=browser?.contexts()[0]?.pages()[0];if(active){await active.screenshot({path:out+'/failure.png'}).catch(()=>{});writeFileSync(out+'/failure-state.json',JSON.stringify(await active.evaluate(()=>({url:location.href,active:document.activeElement?.outerHTML,body:document.body.innerText.slice(-18000),readyState:document.readyState,locks:window.__qaLockEvents,resources:performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,type:r.initiatorType,duration:r.duration,status:r.responseStatus})),scripts:[...document.scripts].filter(s=>s.src).map(s=>({path:new URL(s.src).pathname,async:s.async}))})).catch(()=>null),null,2));}} 
finally{if(activePage)writeFileSync(out+'/runtime-observation.json',JSON.stringify(await activePage.evaluate(async()=>({readyState:document.readyState,locks:window.__qaLockEvents,lockState:navigator.locks?await navigator.locks.query().then(x=>({held:x.held.map(l=>({mode:l.mode})),pending:x.pending.map(l=>({mode:l.mode}))})):null,resources:performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,type:r.initiatorType,duration:r.duration,status:r.responseStatus}))})).catch(()=>null),null,2));writeFileSync(out+'/request-events.json',JSON.stringify(resources,null,2));await browser?.close();if(owned)await stopOwnedNext(owned);}
writeFileSync(out+'/result.json',JSON.stringify({passed,errors,consoleErrors,blocked,requests,beforeUnloadEvents,failure:failure??null,serverOwnership:owned?{ready:owned.ready,cleanup:owned.cleanup}:null,scope:'actual repository Next home, keyboard and mobile layout, fresh synthetic local auth/REST/API; no real account/DB/provider. Existing local network guard blocks external traffic.'},null,2));console.log(JSON.stringify({passed,errors,consoleErrors,blocked,failure},null,2));if(failure||errors.length)process.exitCode=1;
