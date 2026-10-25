import { startOwnedNext,stopOwnedNext } from './owned-next-local.mjs';
import { mkdirSync,writeFileSync,appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium,expect } from '@playwright/test';
const evidence=process.argv.find(x=>x.startsWith('--evidence='))?.slice(11);if(evidence&&!/^[a-z0-9-]+$/.test(evidence))throw Error('Invalid local evidence label');const out=resolve('scripts/browser-qa/.generated/assistant-chat-navigation'+(evidence?'/'+evidence:''));mkdirSync(out,{recursive:true});
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
 let dialogs=0,acceptNavigation=false;page.on('dialog',async d=>{dialogs++;if(acceptNavigation)await d.accept();else await d.dismiss()});
 await page.goto(origin+'/',{waitUntil:'networkidle'});const input=page.locator('#assistant-chat-input');await expect(input).toBeEnabled({timeout:30000});
 const baseline=process.argv.includes('--baseline'),draft='합성 미전송 문장 - 화면 이동 점검';
 await input.fill(draft);const budget=page.locator('a[href="/budget"]:visible').first();await budget.focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(origin+'/budget');await page.goBack();await expect(input).toBeEnabled({timeout:30000});const afterBack=await input.inputValue();
 await input.fill(draft);await page.locator('a[href="/budget"]:visible').first().focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(origin+'/budget');const home=page.locator('a[href="/"]:visible').first();await home.focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(origin+'/');await expect(input).toBeEnabled({timeout:30000});const afterMenu=await input.inputValue();writeFileSync(out+'/navigation-values.json',JSON.stringify({afterBack,afterMenu,baseline},null,2));if(baseline){if(afterBack===draft&&afterMenu===draft)passed.push('no draft loss reproduced in browser back or menu return');else passed.push('draft loss reproduced: '+JSON.stringify({back:afterBack===draft,menu:afterMenu===draft}));}else{await expect(input).toHaveValue(draft);if(afterBack!==draft)throw Error('Browser back discarded draft');passed.push('browser back and real menu return preserve unsent chat input');}

 if(!baseline){
 const returnHome=async()=>{await page.locator('a[href="/budget"]:visible').first().focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(origin+'/budget');await page.locator('a[href="/"]:visible').first().focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(origin+'/');await expect(input).toBeEnabled({timeout:30000});};
 await input.fill('');await returnHome();await expect(input).toHaveValue('');passed.push('explicit input clear cannot resurrect earlier text after menu round trip');
 await input.fill(draft);const persisted=await page.evaluate(text=>[localStorage,sessionStorage].some(storage=>Array.from({length:storage.length},(_,i)=>storage.getItem(storage.key(i))).some(value=>value?.includes(text))),draft);if(persisted)throw Error('Chat input persisted to browser storage');passed.push('unsent text absent from localStorage and sessionStorage');
 await page.evaluate(()=>window.dispatchEvent(new Event('yeoni-cloud-session-changed')));await expect(input).toHaveValue('');await returnHome();await expect(input).toHaveValue('');passed.push('cloud account boundary clears current input and old cache without resurrection');
 await input.fill('synthetic reload cancel');await input.focus();await expect.poll(()=>page.evaluate(()=>{const r=window.__unloadReadiness();return r.prevented&&r.hasBeenActive})).toBe(true);const beforeCancel=dialogs;await page.reload({timeout:1000}).catch(e=>{if(!/Timeout|ERR_ABORTED/.test(String(e)))throw e});await expect.poll(()=>dialogs).toBe(beforeCancel+1);await expect(input).toHaveValue('synthetic reload cancel');passed.push('observed-ready native reload cancellation preserves text');
 acceptNavigation=true;await page.reload({waitUntil:'networkidle'});await expect(input).toBeEnabled({timeout:30000});await expect(input).toHaveValue('');passed.push('accepted full reload clears tab-memory input');
 }

 if(requests.some(r=>r.method==='POST'&&/\/api\/(assistant\/chat|claude|language\/practice|speech|tts)/.test(r.path)))throw Error('Unexpected model/audio request');
 if(blocked.length)throw Error('Unexpected external request attempted');
}catch(e){failure=e.stack;const active=browser?.contexts()[0]?.pages()[0];if(active){await active.screenshot({path:out+'/failure.png'}).catch(()=>{});writeFileSync(out+'/failure-state.json',JSON.stringify(await active.evaluate(()=>({url:location.href,active:document.activeElement?.outerHTML,body:document.body.innerText.slice(-18000),readyState:document.readyState,locks:window.__qaLockEvents,resources:performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,type:r.initiatorType,duration:r.duration,status:r.responseStatus})),scripts:[...document.scripts].filter(s=>s.src).map(s=>({path:new URL(s.src).pathname,async:s.async}))})).catch(()=>null),null,2));}}
finally{if(activePage)writeFileSync(out+'/runtime-observation.json',JSON.stringify(await activePage.evaluate(async()=>({readyState:document.readyState,locks:window.__qaLockEvents,lockState:navigator.locks?await navigator.locks.query().then(x=>({held:x.held.map(l=>({mode:l.mode})),pending:x.pending.map(l=>({mode:l.mode}))})):null,resources:performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,type:r.initiatorType,duration:r.duration,status:r.responseStatus}))})).catch(()=>null),null,2));writeFileSync(out+'/request-events.json',JSON.stringify(resources,null,2));await browser?.close();if(owned)await stopOwnedNext(owned);}
writeFileSync(out+'/result.json',JSON.stringify({passed,errors,consoleErrors,blocked,requests,beforeUnloadEvents,failure:failure??null,serverOwnership:owned?{ready:owned.ready,cleanup:owned.cleanup}:null,scope:'actual repository Next home, keyboard and mobile layout, fresh synthetic local auth/REST/API; no real account/DB/provider. Existing local network guard blocks external traffic.'},null,2));console.log(JSON.stringify({passed,errors,consoleErrors,blocked,failure},null,2));if(failure||errors.length)process.exitCode=1;
