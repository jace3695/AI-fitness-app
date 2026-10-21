import { spawn } from 'node:child_process';
import { mkdirSync,writeFileSync,appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium,expect } from '@playwright/test';
const out=resolve('scripts/browser-qa/.generated/next-archive-integration');mkdirSync(out,{recursive:true});
const fileName=path=>path.slice(1).replaceAll('/','-')||'home';
const languageRows=new Map();
const archiveRows=new Map();
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SystemRoot|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(k)));
Object.assign(env,{NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:4318',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_local_only',YEONI_COMMON_CHARACTER_ENABLED:'1',NODE_OPTIONS:'--require '+JSON.stringify(resolve('scripts/next-local-network-guard.cjs'))});
const log=out+'/server.log';writeFileSync(log,'');
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','4317'],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
server.stdout.on('data',b=>appendFileSync(log,b));server.stderr.on('data',b=>appendFileSync(log,b));
const origin='http://127.0.0.1:4317';let browser;const passed=[],errors=[],consoleErrors=[],blocked=[],requests=[];let failure;
const user={id:'00000000-0000-4000-8000-000000000701',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const token=b64({alg:'none',typ:'JWT'})+'.'+b64({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})+'.synthetic';
try{
 for(let i=0;i<90;i++){if(server.exitCode!==null)throw Error('local Next process exited; see server.log');try{const r=await fetch(origin);if(r.ok)break}catch{}if(i===89)throw Error('local Next startup timeout');await new Promise(r=>setTimeout(r,500));}
 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
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
   if(u.pathname==='/api/confirmed-conversation-archive'){
    const owner=req.headers()['x-expected-owner'];
    if(req.method()==='POST'){
     const payload=req.postDataJSON(),key=owner+':'+payload.id;
     if(!archiveRows.has(key))archiveRows.set(key,{id:payload.id,created_at:new Date().toISOString(),snapshot:payload.snapshot});
     return route.fulfill({json:{entry:archiveRows.get(key)}});
    }
    if(req.method()==='GET')return route.fulfill({json:{entries:[...archiveRows.entries()].filter(([key,row])=>key.startsWith(owner+':')&&row.snapshot.kind===u.searchParams.get('kind')).map(([,row])=>row),nextCursor:null}});
    return route.fulfill({status:400,json:{error:'Synthetic integration does not erase records'}});
   }
   if(u.pathname==='/api/pin')return route.fulfill({json:{configured:false}});
   if(u.pathname==='/api/fitness/coach/history'&&req.method()==='GET')return route.fulfill({json:{reviews:[]}});
   if(u.pathname==='/api/assistant/chat'&&req.method()==='GET')return route.fulfill({json:{messages:[]}});
   return route.fulfill({status:503,json:{error:'Isolated QA: service unavailable'}});
  }
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
 await page.goto(origin,{waitUntil:'networkidle'});await page.screenshot({path:out+'/initial.png'});
 const host=page.locator('[data-yeoni-common-host]');await expect(host.locator('canvas')).toHaveCount(1,{timeout:30000});
 for(const appearance of ['고양이형','인간형']){
  await host.getByRole('button',{name:appearance,exact:true}).click();
  if(await host.getByRole('button',{name:'움직임 끄기',exact:true}).count())await host.getByRole('button',{name:'움직임 끄기',exact:true}).click();
  for(const path of ['/','/fitness','/budget','/assistant','/language','/language/practice','/language/conversation','/language/speaking']){
   await page.goto(origin+path,{waitUntil:'networkidle'});
   await expect(host.getByRole('img',{name:appearance+' 연이',exact:true})).toBeVisible({timeout:30000});
   await expect(page.locator('canvas')).toHaveCount(1);
   await expect(host.getByRole('button',{name:'움직임 켜기',exact:true})).toBeVisible();
   await page.screenshot({path:out+'/'+appearance+'-'+fileName(path)+'-route.png'});
   const body=await page.locator('body').innerText();
   if(/로그인 계정을 다시|로그인하기|이메일로 로그인/.test(body))throw Error('authentication gate remains on '+path);
   if(await page.locator('[data-yeoni-action]').count())throw Error('duplicate legacy mascot '+path);
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('horizontal overflow '+path);
   if(path==='/fitness'){
    await page.getByRole('button',{name:'기록보기',exact:false}).click();
    await page.getByRole('tab',{name:'체중관리',exact:true}).click();
    await expect(page.getByRole('tab',{name:'체중관리',exact:true})).toHaveAttribute('aria-selected','true');
    passed.push(appearance+' actual fitness record/body tab');
   }
   if(path==='/budget'){
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button',{name:'기록',exact:false}).filter({hasText:'기록'}).first().click();
   }
   if(path==='/language/practice')await expect(page.getByLabel('자유 일본어 문장')).toBeEnabled();
   const fields=page.locator('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]),textarea');
   let field;
   for(let i=0;i<await fields.count();i++)if(await fields.nth(i).isVisible()&&await fields.nth(i).isEnabled()){field=fields.nth(i);break;}
   if(field){
    await page.setViewportSize({width:320,height:420});await field.focus();await field.scrollIntoViewIfNeeded();
    await expect(host).toHaveAttribute('data-quiet','true');
    await expect(page.getByRole('button',{name:'맨 위로 이동',exact:true})).toHaveCount(0);
    const accessible=await field.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&[r.top+16,r.top+r.height/2,r.bottom-16].every(y=>[r.left+16,r.left+r.width/2,r.right-16].every(x=>el.contains(document.elementFromPoint(x,y))))});
    if(!accessible){await page.screenshot({path:out+'/occluded.png'});const detail=await field.evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {field:el.outerHTML,rect:r.toJSON(),hit:hit?.outerHTML,parents:hit?.parentElement?.outerHTML.slice(0,1500)}});throw Error('input occluded on '+path+' '+JSON.stringify(detail));}
    passed.push(appearance+' '+path+' focused input unobscured at 320x420');
    await page.screenshot({path:out+'/'+appearance+'-'+fileName(path)+'-focused.png'});
    await page.setViewportSize({width:390,height:844});
   }
   if(path==='/language/practice'){
    const sentence='合成の練習です。'+appearance;
    await page.getByLabel('자유 일본어 문장').fill(sentence);
    await expect(page.getByRole('button',{name:'AI와 대화하기',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'연습 기록 보관',exact:true}).click();
    await page.reload({waitUntil:'networkidle'});
    await expect(page.getByRole('article').filter({hasText:sentence})).toHaveCount(1);
    await page.getByRole('link',{name:'상황별 회화로 돌아가기',exact:true}).click();
    await page.getByRole('link',{name:'자유 문장 기록·발음 자기 점검',exact:true}).click();
    await expect(page.getByRole('article').filter({hasText:sentence})).toHaveCount(1);
    await expect(host.getByRole('img',{name:appearance+' 연이',exact:true})).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(1);
    passed.push(appearance+' actual practice reload/link roundtrip restores synthetic journal and one character');
    const turn=page.getByRole('article',{name:'연습 기록 일상',exact:true}).filter({hasText:sentence});
    await turn.getByRole('button',{name:'계정 보관 대상으로 선택',exact:true}).click();
    const archive=page.getByRole('region',{name:'일본어 연습 계정 보관'});
    await expect(archive.getByRole('button',{name:'선택 내용 계정 보관',exact:true})).toBeDisabled();
    await archive.getByRole('checkbox').check();await archive.getByRole('button',{name:'선택 내용 계정 보관',exact:true}).click();
    await expect(archive.getByRole('status')).toContainText('저장했어요');await page.reload({waitUntil:'networkidle'});
    await archive.getByRole('button',{name:'계정 보관본 불러오기',exact:true}).click();
    await expect(archive.getByRole('article').filter({hasText:sentence})).toHaveCount(1);
    passed.push(appearance+' actual Japanese consent archive saves and reloads through synthetic API');
   }
   if(path==='/assistant'){
    const input=page.locator('#assistant-chat-input');await expect(input).toBeEnabled();await input.fill('체성분 점검');await input.press('Enter');
    const archive=page.getByRole('region',{name:'체성분 대화 계정 보관'});await expect(archive).toBeVisible();
    await expect(archive.getByRole('button',{name:'선택 내용 계정 보관',exact:true})).toBeDisabled();
    await archive.getByText('계정에 보낼 내용 확인',{exact:true}).click();await expect(archive).toContainText('질문: 체성분 점검');
    await archive.getByRole('checkbox').check();await archive.getByRole('button',{name:'선택 내용 계정 보관',exact:true}).click();await expect(archive.getByRole('status')).toContainText('저장했어요');
    await archive.getByRole('button',{name:'계정 보관본 불러오기',exact:true}).click();await expect(archive.getByRole('article').first()).toBeVisible();
    passed.push(appearance+' actual assistant body question/answer explicit archive, no AI request');
   }
   await page.screenshot({path:out+'/'+appearance+'-'+fileName(path)+'.png'});
   passed.push(appearance+' actual Next route '+path);
  }
 }
 await page.goto(origin+'/language/practice',{waitUntil:'networkidle'});
 await expect(page.getByLabel('자유 일본어 문장')).toBeEnabled();
 await page.evaluate(()=>{localStorage.setItem('language-cloud-sync-user','synthetic-other-owner');window.dispatchEvent(new StorageEvent('storage',{key:'language-cloud-sync-user'}))});
 await expect(page.getByLabel('자유 일본어 문장')).toHaveCount(0);
 await expect(page.getByRole('article')).toHaveCount(0);
 passed.push('actual Next practice immediately hides journal after synthetic owner boundary');
}catch(e){failure=e.stack}
finally{await browser?.close();server.kill();}
writeFileSync(out+'/result.json',JSON.stringify({passed,errors,consoleErrors,blocked,requests,failure:failure??null,scope:'real Next pages; synthetic local auth/rest/API; no actual account/DB/provider'},null,2));console.log(JSON.stringify({passed,errors,consoleErrors,blocked,failure},null,2));if(failure||errors.length)process.exitCode=1;
