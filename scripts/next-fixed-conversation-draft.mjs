import { spawn } from 'node:child_process';
import { mkdirSync,writeFileSync,appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium,expect } from '@playwright/test';
const out=resolve('scripts/browser-qa/.generated/next-fixed-conversation-draft');mkdirSync(out,{recursive:true});
const languageRows=new Map();
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SystemRoot|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(k)));
Object.assign(env,{NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:4318',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_local_only',YEONI_COMMON_CHARACTER_ENABLED:'1',NODE_OPTIONS:'--require '+JSON.stringify(resolve('scripts/next-local-network-guard.cjs'))});
const log=out+'/server.log';writeFileSync(log,'');
const occupied=await fetch('http://127.0.0.1:4317',{signal:AbortSignal.timeout(500)}).then(()=>true,()=>false);if(occupied)throw Error('Existing local server occupies approved QA address; not touched');
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','4317'],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
server.stdout.on('data',b=>appendFileSync(log,b));server.stderr.on('data',b=>appendFileSync(log,b));
const origin='http://127.0.0.1:4317';let browser;const passed=[],errors=[],consoleErrors=[],blocked=[],requests=[];let failure;const beforeUnloadEvents=[];
const user={id:'00000000-0000-4000-8000-000000000701',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const token=b64({alg:'none',typ:'JWT'})+'.'+b64({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})+'.synthetic';
try{
 for(let i=0;i<90;i++){if(server.exitCode!==null)throw Error('local Next process exited; see server.log');try{const r=await fetch(origin);if(r.ok)break}catch{}if(i===89)throw Error('local Next startup timeout');await new Promise(r=>setTimeout(r,500));}
 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
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
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());if(m.text().startsWith('__qa_unload__'))beforeUnloadEvents.push(JSON.parse(m.text().slice(13)))});
 let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss()});
 await page.goto(origin+'/language/conversation',{waitUntil:'networkidle'});const input=page.getByLabel('예문 직접 입력',{exact:true});await expect(input).toBeEnabled({timeout:30000});await input.fill('synthetic fixed conversation draft');await page.evaluate(()=>window.__fixedDoc='same-doc');await page.getByRole('link',{name:'저장한 문장 복습하기',exact:true}).focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(origin+'/language/review');expect(await page.evaluate(()=>window.__fixedDoc)).toBe('same-doc');await page.goBack();await expect(input).toHaveValue(process.argv.includes('--baseline')?'':'synthetic fixed conversation draft');passed.push(process.argv.includes('--baseline')?'BASELINE actual Next Link/back loses fixed-conversation input':'actual Next Link/back restores fixed-conversation input');

 if(!process.argv.includes('--baseline')){
 const leaveAndBack=async()=>{await page.getByRole('link',{name:'저장한 문장 복습하기',exact:true}).focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(origin+'/language/review');await page.goBack();await expect(input).toBeEnabled();};
 await input.fill('synthetic latest fixed input');await leaveAndBack();await expect(input).toHaveValue('synthetic latest fixed input');passed.push('latest edit replaces earlier draft without submitting or bookmarking');
 await page.getByRole('button',{name:'처음부터 다시 연습',exact:true}).click();await leaveAndBack();await expect(input).toHaveValue('');passed.push('explicit restart clears cache and back cannot resurrect old sentence');
 const situation=page.getByLabel('상황',{exact:true});await situation.selectOption({index:1});const topic=await situation.inputValue();await input.fill('synthetic topic-specific draft');await leaveAndBack();await expect(situation).toHaveValue(topic);await expect(input).toHaveValue('synthetic topic-specific draft');passed.push('topic and typed sentence restore together');
 await page.getByRole('link',{name:'저장한 문장 복습하기',exact:true}).focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(origin+'/language/review');await page.evaluate(()=>window.dispatchEvent(new Event('yeoni-cloud-session-changed')));await page.goBack();await expect(input).toBeEnabled();await expect(input).toHaveValue('');passed.push('session invalidation while away clears cached input');
 const starter=await page.getByRole('article',{name:'내가 먼저 하는 말',exact:true}).locator('p[lang=ja]').first().innerText();await input.fill(starter);await page.getByRole('button',{name:'준비된 예문 확인',exact:true}).click();await expect(input).toHaveCount(0);await leaveAndBack();await expect(input).toHaveValue('');passed.push('accepted matching sentence is consumed and not restored as an unsent draft');
 }
 if(requests.some(r=>/\/api\/(claude|language\/practice|speech|tts)/.test(r.path)))throw Error('Unexpected model/audio request');
 if(blocked.length)throw Error('Unexpected external request attempted');
}catch(e){failure=e.stack}
finally{await browser?.close();server.kill();}
writeFileSync(out+'/result.json',JSON.stringify({passed,errors,consoleErrors,blocked,requests,beforeUnloadEvents,failure:failure??null,scope:'actual repository Next App Router, native next/link and browser back, fresh synthetic local auth/REST/API; no real account/DB/provider. Existing local network guard blocks external traffic.'},null,2));console.log(JSON.stringify({passed,errors,consoleErrors,blocked,failure},null,2));if(failure||errors.length)process.exitCode=1;
