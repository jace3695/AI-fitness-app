import { startOwnedNext,stopOwnedNext } from './owned-next-local.mjs';
import { mkdirSync,writeFileSync,appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium,expect } from '@playwright/test';
const out=resolve('scripts/browser-qa/.generated/practice-body-links');mkdirSync(out,{recursive:true});
const languageRows=new Map();
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SystemRoot|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(k)));
Object.assign(env,{NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:4318',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_local_only',YEONI_COMMON_CHARACTER_ENABLED:'1',NODE_OPTIONS:'--require '+JSON.stringify(resolve('scripts/next-local-network-guard.cjs'))});
const log=out+'/server.log';writeFileSync(log,'');
let owned;
const origin='http://127.0.0.1:4317';let browser;const passed=[],errors=[],consoleErrors=[],blocked=[],requests=[];let failure;const beforeUnloadEvents=[];let dialogs=0;let acceptNavigation=process.argv.includes('--baseline');
const user={id:'00000000-0000-4000-8000-000000000701',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const token=b64({alg:'none',typ:'JWT'})+'.'+b64({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})+'.synthetic';
try{
 owned=await startOwnedNext({env,log});

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
 page.on('dialog',async d=>{dialogs++;if(acceptNavigation)await d.accept();else await d.dismiss()});

 await page.goto(origin+'/language/conversation',{waitUntil:'networkidle'});const fixed=page.getByLabel('예문 직접 입력',{exact:true});await expect(fixed).toBeEnabled({timeout:30000});await page.getByLabel('상황',{exact:true}).selectOption('카페');await fixed.fill('synthetic fixed body draft');await page.evaluate(()=>window.__bodyLinkDocument='shared-document');await page.getByRole('link',{name:'자유 문장 기록·발음 자기 점검',exact:true}).focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(origin+'/language/practice');const free=page.locator('#practice-message');await expect(free).toBeEnabled();const sameDocument=await page.evaluate(()=>window.__bodyLinkDocument==='shared-document');expect(sameDocument).toBe(!process.argv.includes('--baseline'));await page.locator('select').first().selectOption('여행');await free.fill('synthetic free body draft');if(!process.argv.includes('--baseline'))await page.locator('input[aria-describedby="practice-data-use"]').check();await page.getByRole('link',{name:'← 상황별 회화',exact:true}).focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(origin+'/language/conversation');await expect(fixed).toHaveValue(process.argv.includes('--baseline')?'':'synthetic fixed body draft');if(process.argv.includes('--baseline')){await page.getByRole('link',{name:'자유 문장 기록·발음 자기 점검',exact:true}).focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(origin+'/language/practice');await expect(free).toHaveValue('');}
 passed.push(process.argv.includes('--baseline')?'BASELINE body anchors replace document and lose both fixed/free tab-memory drafts':'actual body links preserve document and fixed draft');

 if(!process.argv.includes('--baseline')){
 const forward=async()=>{await page.getByRole('link',{name:'자유 문장 기록·발음 자기 점검',exact:true}).focus();await page.keyboard.press('Enter');await expect(free).toBeEnabled();};
 const back=async()=>{await page.getByRole('link',{name:'← 상황별 회화',exact:true}).focus();await page.keyboard.press('Enter');await expect(fixed).toBeEnabled();};
 await expect(page.getByLabel('상황',{exact:true})).toHaveValue('카페');await forward();await expect(free).toHaveValue('synthetic free body draft');await expect(page.locator('select').first()).toHaveValue('여행');await expect(page.locator('input[aria-describedby="practice-data-use"]')).not.toBeChecked();expect(await page.evaluate(()=>window.__bodyLinkDocument)).toBe('shared-document');expect(dialogs).toBe(0);passed.push('both drafts and topics coexist through body-link round trip; consent is not restored and no native navigation dialog');
 expect(await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]).includes('synthetic fixed body draft')||JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]).includes('synthetic free body draft'))).toBe(false);passed.push('neither draft is persisted to browser storage');
 await back();await fixed.fill('');await forward();await expect(free).toHaveValue('synthetic free body draft');await free.fill('');await back();await expect(fixed).toHaveValue('');await fixed.fill('synthetic restart draft');await page.getByRole('button',{name:'처음부터 다시 연습',exact:true}).click();await forward();await expect(free).toHaveValue('');await back();await expect(fixed).toHaveValue('');passed.push('clear and explicit fixed restart cannot resurrect either previous sentence');
 await fixed.fill('synthetic invalidated fixed');await forward();await free.fill('synthetic invalidated free');await page.evaluate(()=>window.dispatchEvent(new Event('yeoni-cloud-session-changed')));await expect(free).toHaveCount(0);await page.locator('a[href="/language/conversation"]').first().focus();await page.keyboard.press('Enter');await expect(fixed).toBeEnabled();await expect(fixed).toHaveValue('');await forward();await expect(free).toHaveValue('');passed.push('session invalidation clears both namespaces and old sentences stay absent after reentry');
 await free.fill('synthetic cancelled reload');await expect.poll(()=>page.evaluate(()=>{const r=window.__unloadReadiness();return r.prevented&&r.hasBeenActive})).toBe(true);const beforeCancel=dialogs;await page.reload({timeout:1000}).catch(e=>{if(!/Timeout|ERR_ABORTED/.test(String(e)))throw e});await expect.poll(()=>dialogs).toBe(beforeCancel+1);await expect(free).toHaveValue('synthetic cancelled reload');passed.push('native reload cancellation preserves current draft after observed guard readiness');
 acceptNavigation=true;await page.reload({waitUntil:'networkidle'});await expect(free).toBeEnabled();await expect(free).toHaveValue('');await expect(page.locator('input[aria-describedby="practice-data-use"]')).not.toBeChecked();await back();await expect(fixed).toHaveValue('');passed.push('accepted full reload still clears tab-memory drafts and consent');
 }
 if(requests.some(r=>/\/api\/(claude|language\/practice|speech|tts)/.test(r.path)))throw Error('Unexpected model/audio request');
 if(blocked.length)throw Error('Unexpected external request attempted');
}catch(e){failure=e.stack}
finally{await browser?.close();if(owned)await stopOwnedNext(owned);}
writeFileSync(out+(process.argv.includes('--baseline')?'/before.json':'/result.json'),JSON.stringify({passed,errors,consoleErrors,blocked,requests,beforeUnloadEvents,dialogs,acceptNavigation,failure:failure??null,serverOwnership:owned?{ready:owned.ready,cleanup:owned.cleanup}:null,scope:'actual repository Next App Router, native next/link and browser back, fresh synthetic local auth/REST/API; no real account/DB/provider. Existing local network guard blocks external traffic.'},null,2));console.log(JSON.stringify({passed,errors,consoleErrors,blocked,failure},null,2));if(failure||errors.length)process.exitCode=1;
