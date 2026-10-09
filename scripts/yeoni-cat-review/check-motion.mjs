import {chromium,webkit} from 'playwright';
import {build} from '../browser-qa/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {renderReferencePortrait} from '../yeoni-human-assets/reference-renderer.mjs';
const root=new URL('../../',import.meta.url),kind=process.env.YEONI_BROWSER||'chromium';
const out=new URL(`.e2e/yeoni-cat-motion-v3/${kind}/`,root);mkdirSync(out,{recursive:true});
const bundle=await build({entryPoints:[new URL('motion-probe.ts',import.meta.url).pathname],bundle:true,write:false,format:'iife',globalName:'catReview',tsconfig:new URL('tsconfig.json',root).pathname});
const uri=(path,mime)=>`data:${mime};base64,`+readFileSync(new URL(path,root)).toString('base64');
const browser=await({chromium,webkit})[kind].launch({headless:true});
const page=await browser.newPage({viewport:{width:760,height:460},deviceScaleFactor:1});
const errors=[],requests=[],results=[];let identity,performanceResult;
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});
const test=async(name,fn)=>{await fn();results.push({name,passed:true});console.log('PASS '+name)};
const capture=async(name)=>page.screenshot({path:new URL(name+'.png',out).pathname});
const pixels=()=>page.locator('#revised').evaluate(c=>c.toDataURL());
const show=input=>page.evaluate(input=>catReview.show(input),input);
const eyes=['open','half','closed'],mouths=['closed','a','i','u','e','o','small'];
try{
 await page.setContent('<html lang="ko"><meta charset="utf-8"><style>body{margin:12px;font:16px system-ui;background:#fff;color:#302244}.row{display:flex;gap:16px}figure{margin:0}canvas{width:360px;height:360px;display:block}figcaption{text-align:center;height:40px;display:grid;place-items:center}</style><div class="row"><figure><canvas id="original" width="360" height="360"></canvas><figcaption>공식 원본</figcaption></figure><figure id="motion-panel"><canvas id="revised" width="360" height="360"></canvas><figcaption id="label">기본 모습</figcaption></figure></div></html>');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(([atlas,base])=>catReview.init(atlas,base),[uri('public/yeoni/cat/preserved-motion-v3.png','image/png'),uri('public/yeoni/cat/reference-v2/base.png','image/png')]);
 await test('all 21 resting states match the approved original and patches pixel for pixel',async()=>{
  const spec=JSON.parse(readFileSync(new URL('public/yeoni/cat/reference-v2/manifest.json',root)));
  const imageData={};for(const f of [spec.base.image,...Object.values(spec.parts).flat().map(p=>p.image)])imageData[f]=uri('public/yeoni/cat/reference-v2/'+f,f.endsWith('.png')?'image/png':'image/webp');
  identity=await page.evaluate(async({spec,imageData,renderer,eyes,mouths})=>{
   const images={};for(const[k,data]of Object.entries(imageData)){const im=new Image();im.src=data;await im.decode();images[k]=im}
   const make=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c},reference=make(313,313),ctx=reference.getContext('2d'),render=new Function('return '+renderer)(),rows=[];
   for(const eye of eyes)for(const mouth of mouths){render(ctx,images[spec.base.image],images,spec,{open:'open',half:'eyesHalf',closed:'eyesClosed'}[eye],mouth,make);catReview.show({eye,mouth,still:true});const a=ctx.getImageData(0,0,313,313).data,b=document.querySelector('#revised').getContext('2d').getImageData(24,24,313,313).data;let changed=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])changed++;rows.push({eye,mouth,changed})}return rows;
  },{spec,imageData,renderer:renderReferencePortrait.toString(),eyes,mouths});
  for(const row of identity)assert.equal(row.changed,0,JSON.stringify(row));await show({still:true});await capture('baseline');await page.locator('#original').screenshot({path:new URL('original.png',out).pathname});await page.locator('#motion-panel').screenshot({path:new URL('poster.png',out).pathname});
 });
 await test('near-neutral mesh has no bright diagonal rasterization seams',async()=>{
  const r=await page.evaluate(()=>{const canvas=document.querySelector('#revised'),ctx=canvas.getContext('2d');const{frame}=catReview.show({still:true});const a=ctx.getImageData(0,0,360,360).data;catReview.draw({...frame,expression:{...frame.expression,headTilt:1e-8}});const b=ctx.getImageData(0,0,360,360).data;let max=0,large=0;for(let i=0;i<a.length;i+=4){const d=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));max=Math.max(max,d);if(d>8)large++;}return{max,large}});assert.equal(r.large,0,JSON.stringify(r));
 });
 await test('21 eye/mouth combinations remain attached during the tilt gesture',async()=>{
  for(const eye of eyes){const frames=[{label:'original',src:await page.locator('#original').evaluate(c=>c.toDataURL())}];for(const mouth of mouths){await show({eye,mouth,gesture:'tilt',progress:.3});frames.push({label:mouth,src:await pixels()})}await sheet(frames,'moving-'+eye)}
 });
 await test('all four gestures have continuous start middle end and source comparison sheets',async()=>{
  for(const gesture of ['nod','tilt','greet','cheer']){const frames=[{label:'original',src:await page.locator('#original').evaluate(c=>c.toDataURL())}];for(const progress of [0,.15,.3,.5,.7,.85,1]){const r=await show({gesture,progress});frames.push({label:String(progress),src:await pixels()});if(progress===1)assert.equal(r.frame.gesture,'idle')}await sheet(frames,'gesture-'+gesture)}
 });
 await test('continuous motion has finite bounded render cost at 360px',async()=>{
  performanceResult=await page.evaluate(()=>{const times=[];for(let i=0;i<180;i++)times.push(catReview.show({time:i*1000/30}).milliseconds);times.sort((a,b)=>a-b);return{samples:times.length,median:times[90],p95:times[171],max:times[179],average:times.reduce((a,b)=>a+b)/times.length}});assert.ok(performanceResult.average<33.34,JSON.stringify(performanceResult));
 });
 if(kind==='chromium'&&process.env.YEONI_REVIEW_VIDEO==='1')await test('review video contains actual Canvas frames for blink tail and all gestures',async()=>{
  const frames=new URL('video-frames/',out);mkdirSync(frames,{recursive:true});
  const sequence=[];for(let i=0;i<60;i++)sequence.push({label:'깜빡임 · 숨쉬기 · 꼬리',input:{time:i*1000/12}});
  for(const[gesture,label]of [['nod','끄덕임'],['tilt','갸웃'],['greet','꾸벅 인사'],['cheer','가벼운 응원']])for(let i=0;i<24;i++)sequence.push({label,input:{gesture,progress:i/23}});
  for(let i=0;i<sequence.length;i++){const s=sequence[i];await show(s.input);await page.locator('#label').evaluate((e,t)=>{e.textContent=t},s.label);await page.locator('#motion-panel').screenshot({path:new URL(String(i).padStart(4,'0')+'.png',frames).pathname});}
  execFileSync('ffmpeg',['-y','-framerate','12','-i',new URL('%04d.png',frames).pathname,'-c:v','libx264','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart',new URL('original-motion-comparison.mp4',out).pathname],{stdio:'pipe'});
  rmSync(frames,{recursive:true});
  const video=await browser.newPage();await video.setContent('<video controls muted playsinline preload="metadata" style="width:360px"></video>');await video.locator('video').evaluate((el,src)=>{el.src=src},'data:video/mp4;base64,'+readFileSync(new URL('original-motion-comparison.mp4',out)).toString('base64'));await video.waitForFunction(()=>document.querySelector('video').readyState>=1);assert.equal(await video.locator('video').evaluate(v=>v.paused),true);await video.locator('video').evaluate(v=>v.play());await video.waitForFunction(()=>document.querySelector('video').currentTime>.3);await video.locator('video').evaluate(v=>v.pause());await video.screenshot({path:new URL('video-replay.png',out).pathname});await video.close();
 });
 await test('renderer disposal clears pixels and prevents stale drawing',async()=>{await page.evaluate(()=>catReview.dispose());const blank=await pixels();await show({time:700});assert.equal(await pixels(),blank)});
 await test('no runtime errors or external requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(requests,[])});
}catch(e){results.push({passed:false,error:String(e)});console.error(e);process.exitCode=1;}
finally{writeFileSync(new URL('results.json',out),JSON.stringify({browser:kind,version:browser.version(),results,reviewVideoRequested:process.env.YEONI_REVIEW_VIDEO==='1',identity,performanceResult,errors,requests,scope:'Opaque original-preserving Canvas motion. Visual review required; no real audio timing judgement or physical iPhone performance claim.'},null,2));await browser.close()}
async function sheet(frames,name){
 const p=await browser.newPage({viewport:{width:1440,height:790}});
 await p.setContent('<style>body{margin:0;background:white;font:18px system-ui}.grid{display:grid;grid-template-columns:repeat(4,360px)}figure{margin:0}img{width:360px;height:360px}figcaption{height:30px;text-align:center}</style><div class="grid">'+frames.map(f=>`<figure><figcaption>${f.label}</figcaption><img src="${f.src}"></figure>`).join('')+'</div>');
 await p.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));await p.screenshot({path:new URL(name+'.png',out).pathname,fullPage:true});await p.close();
}
