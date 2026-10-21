import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve('scripts/browser-qa/.generated/yeoni-common'); mkdirSync(out, { recursive:true });
const evidence = resolve(out, 'integration-evidence'); mkdirSync(evidence,{recursive:true});
await build({entryPoints:['scripts/yeoni-common/browser.tsx'],bundle:true,outfile:resolve(out,'app.js'),jsx:'automatic',tsconfig:'tsconfig.json',external:['/yeoni-cat-sprite-v1.webp'],
  define:{'process.env.NODE_ENV':'"development"','process.env':'{}',QA_SAVED_AUDIO:JSON.stringify(readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3').toString('base64'))},plugins:[{name:'synthetic-boundaries',setup(b){
    b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'qa'}));
    b.onResolve({filter:/app\/lib\/supabase$/},()=>({path:'auth',namespace:'qa'}));
    b.onLoad({filter:/.*/,namespace:'qa'},({path})=>({contents:path==='navigation'
      ? 'export const usePathname=()=>window.qa.path;'
      : `export const supabase={auth:{onAuthStateChange(fn){window.qa.listeners.add(fn);return {data:{subscription:{unsubscribe(){window.qa.listeners.delete(fn)}}}}}}};`,loader:'js'}));
  }}]});
const server = createServer((req,res)=>{
  const pathname = new URL(req.url,'http://local').pathname;
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/app.css"><style>body{margin:0}main{padding:16px}button,input{min-height:44px}</style><div id="root"></div><script>window.qa={path:"/",listeners:new Set()}</script><script src="/app.js"></script>');return;}
  try {const file=pathname==='/app.js'||pathname==='/app.css'?resolve(out,pathname.slice(1)):resolve('public','.'+pathname);
    if(!file.startsWith(out)&&!file.startsWith(resolve('public')+ '/'.replace('/',process.platform==='win32'?'\\':'/'))) throw Error('outside assets');
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.json':'application/json'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
  }catch {res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844}});
const external=[],errors=[],passed=[];
await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():(external.push(route.request().url()),route.abort()));
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
let failure;
try{
  await page.goto(base);
  const host=page.locator('[data-yeoni-common-host]');
  await expect(host.locator('canvas')).toHaveAttribute('data-draws',/\d+/);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByText('기존 안내문을 그대로 보존합니다.')).toBeVisible();
  assert.equal(await page.locator('[data-yeoni-action]').count(),0);passed.push('single renderer in StrictMode; legacy guidance preserved');
  await host.getByRole('button',{name:'인간형',exact:true}).click();
  await expect(host.getByRole('img',{name:'인간형 연이',exact:true})).toBeVisible();
  for(const path of ['/fitness','/diet','/language','/budget','/assistant','/growth/drawing','/']){
    await page.evaluate(path=>window.qa.navigate(path),path);
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(host.getByRole('img',{name:'인간형 연이',exact:true})).toBeVisible();
  }
  await page.reload();await expect(host.getByRole('img',{name:'인간형 연이',exact:true})).toBeVisible();passed.push('human preference survives all route props and reload');
  await host.getByRole('button',{name:'움직임 켜기',exact:true}).click();
  await page.evaluate(()=>window.qa.setQuiet(true));await expect(host).toHaveAttribute('data-quiet','true');
  await page.evaluate(()=>window.qa.setQuiet(false));await expect(host).toHaveAttribute('data-quiet','false');
  passed.push('existing app quiet state propagates to common host and releases on change');
  await expect(host.locator('canvas')).toHaveAttribute('data-running','true');
  await page.getByLabel('합성 입력').fill('private synthetic text');
  await expect(host).toHaveAttribute('data-quiet','true');await expect(host.locator('canvas')).toHaveAttribute('data-running','false');
  const before=await host.locator('canvas').getAttribute('data-draws');await page.waitForTimeout(250);assert.equal(await host.locator('canvas').getAttribute('data-draws'),before);
  await page.getByRole('heading').click();
  await page.evaluate(()=>window.qa.navigate('/fitness'));await expect(host).toHaveAttribute('data-quiet','true');await expect(host.locator('canvas')).toHaveAttribute('data-running','false');passed.push('input and fitness focus stop render loop and shrink');
  await page.evaluate(()=>window.qa.navigate('/assistant'));
  await page.getByRole('button',{name:'기존 저장 음성 표본',exact:true}).click();
  await expect(page.locator('[data-reply-status]')).toHaveAttribute('data-reply-status','ready');
  await page.getByRole('button',{name:'답변 듣기',exact:true}).click();
  await expect(page.locator('[data-speech-state]')).toHaveAttribute('data-speech-state','playing');
  const audio=await page.locator('audio').getAttribute('src');
  await host.getByRole('button',{name:'고양이형',exact:true}).click();
  await expect(host.getByRole('img',{name:'고양이형 연이',exact:true})).toBeVisible();
  assert.equal(await page.locator('audio').getAttribute('src'),audio);await expect(page.locator('audio')).toHaveCount(1);
  await page.getByRole('button',{name:'다른 음성 포커스',exact:true}).click();await expect(page.locator('[data-speech-state]')).toHaveAttribute('data-speech-state','paused');
  await host.getByRole('button',{name:'인간형',exact:true}).click();passed.push('saved clip plays with one audio through appearance switch; competing voice pauses it');
  await page.getByRole('button',{name:'합성 응답',exact:true}).click();await expect(page.locator('[data-reply-text]')).toContainText('합성 응답');
  await page.evaluate(()=>window.qa.listeners.forEach(fn=>fn('SIGNED_IN',{user:{id:'synthetic-B'}})));
  await expect(page.locator('[data-reply-text]')).toHaveCount(0);await expect(page.locator('[data-reply-status]')).toHaveAttribute('data-reply-status','idle');
  await expect(host.getByRole('img',{name:'인간형 연이',exact:true})).toBeVisible();passed.push('account boundary clears private reply and retains only device appearance');
  await page.getByRole('button',{name:'합성 응답',exact:true}).click();await expect(page.locator('[data-reply-text]')).toHaveCount(1);
  await page.evaluate(()=>{window.qa.navigate('/budget');});await expect(page.locator('[data-reply-text]')).toHaveCount(0);passed.push('navigation resets stale reply state');
  await page.evaluate(()=>window.qa.navigate('/'));await page.getByRole('heading').click();
  await page.emulateMedia({reducedMotion:'reduce'});await expect(host.locator('canvas')).toHaveAttribute('data-running','false');passed.push('reduced motion stops loop');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.evaluate(()=>document.querySelector('main').getBoundingClientRect().top>=document.querySelector('[data-yeoni-common-host]').getBoundingClientRect().bottom),true);
  await page.screenshot({path:resolve(evidence,'mobile-human.png'),fullPage:false});passed.push('390px in-flow layout has no overlap or horizontal overflow');
  await host.getByRole('button',{name:'고양이형',exact:true}).click();await expect(host.getByRole('img',{name:'고양이형 연이',exact:true})).toBeVisible();
  await page.screenshot({path:resolve(evidence,'mobile-cat.png'),fullPage:false});
  await host.getByRole('button',{name:'연이 숨기기',exact:true}).click();await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByText('기존 안내문을 그대로 보존합니다.')).toBeVisible();passed.push('hide disposes renderer while preserving guidance');
  await host.getByRole('button',{name:'연이 보이기',exact:true}).click();
  const other=await context.newPage();await other.goto(base);
  await other.locator('[data-yeoni-common-host]').getByRole('button',{name:'인간형',exact:true}).click();
  await expect(host.getByRole('img',{name:'인간형 연이',exact:true})).toBeVisible();await other.close();passed.push('device preference storage event updates another isolated tab');
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('synthetic quota','QuotaExceededError');};});
  await host.getByRole('button',{name:'고양이형',exact:true}).click();await expect(host.getByRole('img',{name:'고양이형 연이',exact:true})).toBeVisible();passed.push('storage failure keeps in-memory appearance usable');
  // Fresh document avoids the renderer's already decoded asset cache.
  const failurePage=await context.newPage();
  await failurePage.addInitScript(()=>localStorage.setItem('yeoniAppearanceSettingsV1',JSON.stringify({appearance:'cat',visible:true,motion:'off'})));
  await failurePage.route('**/yeoni/human/**',r=>r.abort());await failurePage.goto(base);
  const failureHost=failurePage.locator('[data-yeoni-common-host]');
  await expect(failureHost.getByRole('img',{name:'고양이형 연이',exact:true})).toBeVisible();
  await failureHost.getByRole('button',{name:'인간형',exact:true}).click();
  await expect(failureHost.locator('[data-appearance-status]')).toHaveAttribute('data-appearance-status','error');
  await expect(failureHost.getByRole('img',{name:'고양이형 연이',exact:true})).toBeVisible();
  await expect(failureHost.getByText('모습을 불러오지 못했어요. 현재 모습으로 계속할게요.')).toBeVisible();passed.push('asset failure preserves last good appearance and visible retry notice');
  await failurePage.unroute('**/yeoni/human/**');
  await failureHost.getByRole('button',{name:'다시 불러오기',exact:true}).click();await expect(failureHost.getByRole('img',{name:'인간형 연이',exact:true})).toBeVisible();await failurePage.close();
  for(let i=0;i<6;i++) await page.evaluate(i=>window.qa.navigate(i%2?'/':'/budget'),i);
  await expect(page.locator('canvas')).toHaveCount(1);await expect(host.getByRole('img',{name:'인간형 연이',exact:true})).toBeVisible();passed.push('rapid navigation leaves one renderer');
  await page.setViewportSize({width:1280,height:900});
  assert.equal(await page.evaluate(()=>document.querySelector('[data-common-host=true] [role=status]').getBoundingClientRect().width>document.querySelector('[data-common-host=true]').getBoundingClientRect().width*.9),true);
  await page.screenshot({path:resolve(evidence,'desktop-human.png'),fullPage:false});passed.push('desktop reply uses full width after portrait moves to common host');
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
}catch(e){failure=e.stack;await page.screenshot({path:resolve(evidence,'failure.png')}).catch(()=>{});}
finally{await browser.close();await new Promise(r=>server.close(r));}
writeFileSync(resolve(evidence,'browser.json'),JSON.stringify({passed,errors,external,failure:failure??null,scope:'isolated synthetic browser; actual shared components, mocked route/auth; no real account/DB/provider'},null,2));
console.log(JSON.stringify({passed,errors,external,failure},null,2));if(failure)process.exitCode=1;
