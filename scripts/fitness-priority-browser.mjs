// Local component regression harness: synthetic records and a deferred OCR fixture.
// No authenticated app, real health data, remote API, or OCR accuracy claims.
import { build } from './browser-qa/node_modules/esbuild/lib/main.js';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const output = resolve('scripts/browser-qa/.generated/fitness-priority');
const realOcr = process.env.FITNESS_REAL_OCR === '1';
mkdirSync(output, { recursive: true });
const bundle = await build({ stdin: { contents: `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import BodyRecordCard from './app/components/BodyRecordCard';
import RecordCalendarView from './app/components/RecordCalendarView';
import DailyWorkoutEditor from './app/components/DailyWorkoutEditor';
import ExerciseGuidePanel from './app/components/ExerciseGuidePanel';
import { applyDayRoutineEdit, EMPTY_USER_WORKOUT_SETTINGS } from './app/data/userWorkoutSettings';
const W='ai-fitness-weight-records', I='ai-fitness-inbody-records';
function App() {
 const [date,setDate]=useState('2026-10-14');
 const [weights,setWeights]=useState(()=>JSON.parse(localStorage.getItem(W)||'{}'));
 const [inbody,setInbody]=useState(()=>JSON.parse(localStorage.getItem(I)||'{}'));
 const [settings,setSettings]=useState(()=>JSON.parse(localStorage.getItem('fixture-settings')||'null')||EMPTY_USER_WORKOUT_SETTINGS);
 const edit=settings.dateOverrides['2026-10-14']?.edit;
 const custom=applyDayRoutineEdit({phases:[{exercises:[]}]},edit).phases[0].exercises;
 if (${realOcr}) return <RecordCalendarView/>;
 return <main><button onClick={()=>setDate('2026-10-13')}>달력 다른 날짜</button><output aria-label="선택 날짜">{date}</output>
 <BodyRecordCard dateKey={date} weights={weights} inbody={inbody} onDateChange={setDate} onChange={next=>{setWeights(next.weights);setInbody(next.inbody)}} />
 <DailyWorkoutEditor dayId="wed" dateKey="2026-10-14" defaultGroupId="current-fullbody-hamstring-circuit" recommendedGroupId="current-fullbody-hamstring-circuit" recommendationReason="합성 테스트" settings={settings} onChange={next=>{localStorage.setItem('fixture-settings',JSON.stringify(next));setSettings(next)}} onClose={()=>{}} />
 {custom.map(e=><ExerciseGuidePanel key={e.exerciseId} exercise={e} />)}</main>
} createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, plugins: realOcr ? [] : [{ name: 'deferred-ocr-fixture', setup(b) {
 b.onResolve({ filter: /oaReportParser$/ }, () => ({ path: 'ocr', namespace: 'fixture' }));
 b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const parseOaReport = () => new Promise(resolve => { window.resolveOcr = resolve; });' }));
} }] });
const js = bundle.outputFiles[0].text;
const css = (await postcss([tailwindcss({ content: ['./app/components/*.tsx'] })]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined })).css;
const server = createServer((req,res)=> { res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html; charset=utf-8'); res.end(req.url==='/app.js'?js:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css} body{font-family:sans-serif;margin:12px} main{max-width:1100px;margin:auto}</style><div id="root"></div><script src="/app.js"></script>`); });
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
const checks=[];
try {
 browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage();
 const errors=[]; page.on('pageerror',e=>{errors.push(e.message); console.error('PAGE_ERROR',e.message);});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const assetRequests=[];
 await context.route('**/*', route=> {
   const url=route.request().url();
   if(url.startsWith(origin)) return route.continue();
   const name=new URL(url).pathname.split('/').at(-1);
   let file;
   if(realOcr && route.request().method()==='GET') {
     if(name==='worker.min.js') file=resolve('node_modules/tesseract.js/dist/worker.min.js');
     if(/^tesseract-core[-a-z]*\.wasm(?:\.js)?$/.test(name)) file=resolve('node_modules/tesseract.js-core',name);
     if(name==='eng.traineddata.gz') file=resolve('scripts/browser-qa/.generated/ocr-assets/node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
   }
   if(file) { assetRequests.push(name); return route.fulfill({body:readFileSync(file),headers:{'Access-Control-Allow-Origin':'*'},contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.wasm')?'application/wasm':'application/octet-stream'}); }
   return route.abort();
 });
 await page.goto(origin);
 await page.evaluate(()=>{localStorage.setItem('fitness-cloud-sync-user','fixture-A');localStorage.setItem('ai-fitness-inbody-records',JSON.stringify({'2026-10-01':{bodyAge:40,memo:'preserve synthetic memo'}}));});
 await page.reload();
 if(realOcr) {
   await page.evaluate(()=>localStorage.setItem('ai-fitness-inbody-records',JSON.stringify({'2026-10-02':{memo:'keep real OCR fixture memo',bodyAge:39}})));
   await page.reload();
   const data=await page.evaluate(()=>{
     const canvas=document.createElement('canvas'); canvas.width=1000; canvas.height=6000;
     const ctx=canvas.getContext('2d'); ctx.fillStyle='white';ctx.fillRect(0,0,1000,6000);ctx.fillStyle='black';ctx.font='70px Arial';ctx.textBaseline='middle';
     ctx.fillText('2026-10-01',140,210);ctx.fillText('83.0',80,630);ctx.font='65px Arial';ctx.fillText('24.5',600,2874);
     return canvas.toDataURL('image/png').split(',')[1];
   });
   await page.locator('input[type=file]').setInputFiles({name:'synthetic-oa-layout.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
   await page.getByLabel('측정 날짜',{exact:true}).waitFor({timeout:90000});
   assert.equal(await page.getByLabel('측정 날짜',{exact:true}).inputValue(),'2026-10-01');
   assert.equal(await page.locator('input[inputmode=decimal]').first().inputValue(),'83');
   await page.getByLabel('측정 날짜',{exact:true}).fill('2026-10-02');
   await page.locator('input[inputmode=decimal]').first().fill('82.7');
   page.once('dialog',dialog=>dialog.accept());
   await page.getByRole('button',{name:'확인한 측정일에 저장'}).click();
   await page.reload();
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-fitness-weight-records'))['2026-10-02'].weight),82.7);
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-fitness-inbody-records'))['2026-10-02']),{memo:'keep real OCR fixture memo',bodyAge:39,bmi:24.5});
   await page.locator('button').filter({has:page.locator('span').filter({hasText:/^2$/})}).first().click();
   assert.equal(await page.locator('input[inputmode=decimal]').first().inputValue(),'82.7');
   await page.screenshot({path:resolve(output,'real-calendar-ocr.png'),fullPage:true});
   assert.deepEqual(errors,[]);
   const result={passed:1,scope:'Actual RecordCalendarView + browser image/canvas + OA parser/Tesseract worker and model; date/value edit, existing-record confirmation, memo preservation, save, reload and calendar re-query. Synthetic OA-layout image only, not real report accuracy.',assetRequests,externalRequestsSent:0};
   writeFileSync(resolve(output,'real-ocr-result.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
 } else {
 const upload=async(result)=>{ await page.locator('input[type=file]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('fixture')}); await page.waitForFunction(()=>typeof window.resolveOcr==='function'); if(result) await page.evaluate(r=>window.resolveOcr(r),result); };
 const result={detectedDate:'2026-10-01',values:{weight:79.2,bmi:23},recognizedCount:2};
 await upload(result);
 await page.getByLabel('측정 날짜',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('측정 날짜',{exact:true}).inputValue(),'2026-10-01');
 await page.getByRole('button',{name:'달력 다른 날짜'}).click();
 assert.equal(await page.getByLabel('측정 날짜',{exact:true}).inputValue(),'2026-10-01');
 checks.push('detected date and draft survive calendar change');
 page.once('dialog',d=>d.dismiss());
 await page.getByRole('button',{name:'확인한 측정일에 저장'}).click();
 assert.equal(await page.evaluate(()=>localStorage.getItem('ai-fitness-weight-records')),null);
 checks.push('conflict cancellation leaves storage unchanged');
 page.once('dialog',d=>d.accept());
 await page.getByRole('button',{name:'확인한 측정일에 저장'}).click();
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-fitness-inbody-records')));
 assert.deepEqual(stored['2026-10-01'],{bodyAge:40,memo:'preserve synthetic memo',bmi:23});
 assert.equal(await page.getByLabel('선택 날짜').textContent(),'2026-10-01');
 await page.reload();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-fitness-weight-records'))['2026-10-01'].weight),79.2);
 checks.push('measurement date save, memo preservation and reload');
 await upload({...result,detectedDate:'2026-02-30'});
 assert.equal(await page.getByLabel('측정 날짜',{exact:true}).inputValue(),'');
 assert.equal(await page.getByRole('button',{name:'확인한 측정일에 저장'}).isDisabled(),true);
 await page.getByLabel('측정 날짜',{exact:true}).fill('2026-10-02');
 await page.getByRole('button',{name:'확인한 측정일에 저장'}).click();
 checks.push('invalid date requires explicit correction');
 await upload({values:{weight:80},recognizedCount:1});
 assert.equal(await page.getByLabel('측정 날짜',{exact:true}).inputValue(),'');
 assert.equal(await page.getByRole('button',{name:'확인한 측정일에 저장'}).isDisabled(),true);
 await page.getByLabel('측정 날짜',{exact:true}).fill('2026-10-05');
 await page.getByRole('button',{name:'확인한 측정일에 저장'}).click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-fitness-weight-records'))['2026-10-05'].weight),80);
 checks.push('missing OCR date remains blank until user supplies the save date');
 await upload();
 await page.evaluate(()=>{localStorage.setItem('fitness-cloud-sync-user','fixture-B');localStorage.setItem('fitness-cloud-sync-epoch','2');window.dispatchEvent(new Event('yeoni-cloud-session-changed'));window.resolveOcr({detectedDate:'2026-10-03',values:{weight:99},recognizedCount:1});});
 await page.waitForTimeout(100);
 assert.equal(await page.getByLabel('측정 날짜',{exact:true}).count(),0);
 checks.push('late OCR discarded after session change');
 await upload(result);
 const other=await page.context().newPage(); await other.goto(origin);
 await other.evaluate(()=>localStorage.setItem('fitness-cloud-sync-user','fixture-C'));
 await page.getByLabel('측정 날짜',{exact:true}).waitFor({state:'detached'});
 await other.close();
 checks.push('cross-tab account switch clears completed draft');
 await upload();
 await page.getByRole('button',{name:'달력 다른 날짜'}).click();
 await page.evaluate(r=>window.resolveOcr(r),result);
 await page.waitForTimeout(50);
 assert.equal(await page.getByLabel('측정 날짜',{exact:true}).count(),0);
 checks.push('late OCR discarded after calendar navigation');
 await upload({...result,detectedDate:'2026-10-04'});
 await page.locator('input[inputmode=decimal]').first().fill('77.3');
 const beforeFailure=await page.evaluate(()=>[localStorage.getItem('ai-fitness-weight-records'),localStorage.getItem('ai-fitness-inbody-records')]);
 await page.evaluate(()=>{ const original=Storage.prototype.setItem; window.restoreStorage=()=>Storage.prototype.setItem=original; let fail=true; Storage.prototype.setItem=function(key,value){if(fail && key==='ai-fitness-inbody-records'){fail=false;throw new DOMException('Synthetic quota error','QuotaExceededError');} return original.call(this,key,value);}; });
 await page.getByRole('button',{name:'확인한 측정일에 저장'}).click();
 assert.deepEqual(await page.evaluate(()=>[localStorage.getItem('ai-fitness-weight-records'),localStorage.getItem('ai-fitness-inbody-records')]),beforeFailure);
 assert.equal(await page.getByLabel('측정 날짜',{exact:true}).inputValue(),'2026-10-04');
 await page.evaluate(()=>window.restoreStorage());
 await page.getByRole('button',{name:'확인한 측정일에 저장'}).click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ai-fitness-weight-records'))['2026-10-04'].weight),77.3);
 checks.push('edited value and draft survive transactional quota failure, retry saves');
 await page.getByLabel('보유 장비').selectOption('맨몸');
 await page.getByRole('button',{name:'+ 벽 푸시업',exact:true}).click();
 await page.reload();
 assert.ok((await page.getByText('벽에서 팔 길이 정도 떨어져 섭니다.',{exact:false}).count())>0);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture-settings')));
 assert.equal(saved.dateOverrides['2026-10-14'].edit.customExercises[0].sourceExerciseId,'wall-pushup');
 checks.push('equipment selection source ID and guide survive reload');
 const demo=page.getByRole('region',{name:'벽 푸시업 측면 도해'});
 await demo.waitFor();
 await page.clock.install();
 const position=demo.getByRole('slider',{name:'동작 위치'});
 assert.equal(await position.inputValue(),'0');
 await demo.screenshot({path:resolve(output,'wall-pushup-start.png')});
 await demo.getByRole('button',{name:'재생',exact:true}).click();
 await page.clock.runFor(1000);
 const normal=Number(await position.inputValue());
 assert.ok(normal>.12 && normal<.2);
 await demo.getByRole('button',{name:'일시정지',exact:true}).click();
 const paused=Number(await position.inputValue());
 await page.clock.runFor(500);
 assert.equal(Number(await position.inputValue()),paused);
 checks.push('wall pushup starts paused, advances and pauses on request');
 await demo.getByRole('button',{name:'시작 자세 보기'}).click();
 await demo.getByLabel('느리게 (0.5배)').check();
 await demo.getByRole('button',{name:'재생',exact:true}).click();
 await page.clock.runFor(1000);
 const slow=Number(await position.inputValue());
 assert.ok(Math.abs(slow/normal-.5)<.1);
 checks.push('wall pushup half-speed advances at half the normal rate');
 await demo.getByRole('button',{name:'굽힌 자세 보기'}).click();
 assert.equal(await position.inputValue(),'0.5');
 await demo.screenshot({path:resolve(output,'wall-pushup-bent.png')});
 await page.clock.runFor(500);
 assert.equal(await position.inputValue(),'0.5');
 await position.fill('0.75');
 await demo.screenshot({path:resolve(output,'wall-pushup-return.png')});
 checks.push('wall pushup static keyframes and manual scrubbing stay paused');
 await demo.getByLabel('느리게 (0.5배)').uncheck();
 await demo.getByLabel('반복',{exact:true}).uncheck();
 await position.fill('0.99');
 await demo.getByRole('button',{name:'재생',exact:true}).click();
 await page.clock.runFor(250);
 assert.equal(await position.inputValue(),'1');
 await demo.getByRole('button',{name:'재생',exact:true}).waitFor();
 checks.push('wall pushup stops at cycle end when repeat is disabled');
 await demo.getByLabel('반복',{exact:true}).check();
 await position.fill('0.99');
 await demo.getByRole('button',{name:'재생',exact:true}).click();
 await page.clock.runFor(500);
 assert.ok(Number(await position.inputValue())<.1);
 await demo.getByRole('button',{name:'일시정지',exact:true}).click();
 checks.push('wall pushup repeat wraps continuously to the start');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.reload();
 assert.equal(await position.inputValue(),'0');
 await demo.getByRole('button',{name:'재생',exact:true}).waitFor();
 assert.ok(await demo.getByText('정지 안내:',{exact:false}).isVisible());
 checks.push('reduced-motion reload remains paused with static text available');
 for(const equipment of await page.getByLabel('보유 장비').locator('option').allTextContents()) {
   await page.getByLabel('보유 장비').selectOption(equipment);
   assert.equal(await page.getByRole('button',{name:/^\+.*(슬라이딩\s*보드|힙\s*브[릿리]지)/}).count(),0);
 }
 checks.push('every equipment category excludes sliding board and hip bridge');
 for(const width of [320,390,1280]) {
   await page.setViewportSize({width,height:844});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
   await page.screenshot({path:resolve(output,`viewport-${width}.png`),fullPage:true});
 }
 checks.push('styled 320/390/1280px layout has no horizontal overflow');
 assert.deepEqual(errors,[]);
 await page.screenshot({path:resolve(output,'mobile.png'),fullPage:true});
 writeFileSync(resolve(output,'result.json'),JSON.stringify({passed:checks.length,checks,scope:'Local actual React components; synthetic OCR and storage. Not authenticated Next app or real OCR accuracy.'},null,2));
 console.log(JSON.stringify({passed:checks.length,checks}));
 }
} finally { await browser?.close(); server.close(); }
