import {chromium,webkit} from 'playwright';
import {build} from '../browser-qa/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {renderHumanRig} from '../yeoni-human-rig/render.mjs';
import {humanPreviewPath} from '../browser-qa/human-preview-path.mjs';
const root=new URL('../../',import.meta.url),dir=new URL('public/yeoni/human/rig-v4/',root),kind=process.env.YEONI_BROWSER||'chromium';
const out=new URL(`.e2e/yeoni-human-motion/${kind}/`,root);mkdirSync(out,{recursive:true});
const spec=JSON.parse(readFileSync(new URL('manifest.json',dir))),assets={};
const uri=(url)=>'data:image/'+(url.pathname.endsWith('.png')?'png':'webp')+';base64,'+readFileSync(url).toString('base64');
for(const p of [spec.source,...Object.values(spec.layers),...Object.values(spec.faceParts).flat()])assert.equal(createHash('sha256').update(readFileSync(new URL(p.image,dir))).digest('hex'),p.sha256);
for(const name of ['head.png','body.png',...Object.values(spec.faceParts).flat().map(p=>p.image)])assets[name]=uri(new URL(name,dir));
const bundle=await build({entryPoints:[new URL('probe.ts',import.meta.url).pathname],bundle:true,write:false,format:'iife',globalName:'humanReview',tsconfig:new URL('tsconfig.json',root).pathname});
const browser=await({chromium,webkit})[kind].launch({headless:true,
 ...(kind==='chromium'&&process.env.YEONI_CHROMIUM?{executablePath:process.env.YEONI_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{}),
}),page=await browser.newPage({viewport:{width:752,height:600},deviceScaleFactor:1});
const errors=[],external=[],results=[];let identity,performanceResults,nearNeutral,neckResults;
const observe=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url())});};observe(page);
const test=async(name,fn)=>{await fn();results.push({name,passed:true});console.log('PASS '+name)};
const shot=name=>page.screenshot({path:new URL(name+'.png',out).pathname,fullPage:true});
const show=input=>page.evaluate(input=>humanReview.show(input),input);
const eyes=['open','half','closed'],mouths=['closed','a','i','u','e','o','small'];
try{
 await page.setContent('<html lang="ko"><meta charset="utf-8"><style>body{margin:8px;background:#f4f0fa;color:#30253e;font:16px system-ui}.row{display:flex;gap:16px}figure{margin:0;width:360px}canvas{width:360px;height:540px;display:block}figcaption{height:36px;text-align:center;display:grid;place-items:center}.dark #revised{background:#292237}</style><div class="row"><figure><canvas id="original" width="360" height="540"></canvas><figcaption>승인 원본 A안</figcaption></figure><figure><canvas id="revised"></canvas><figcaption id="label">기본 동작</figcaption></figure></div></html>');
 await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(([assets,original])=>humanReview.init(assets,original),[assets,uri(new URL(spec.source.image,dir))]);
 await test('all 21 resting states preserve approved opaque pixels and alpha at render resolution',async()=>{
  identity=await page.evaluate(async({spec,assets,renderSource,eyes,mouths})=>{
   const images={};for(const[name,url]of Object.entries(assets)){const image=new Image();image.src=url;await image.decode();images[name]=image;}
   const make=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c},full=make(1024,1536),small=make(360,540),render=new Function('return '+renderSource)(),rows=[];
   // Match the renderer's explicit CPU readback surface. WebKit uses a different
   // downsampling path for its default GPU canvas; compare like-for-like sampling.
   small.getContext('2d',{willReadFrequently:true}).imageSmoothingQuality='high';
   for(const eye of eyes)for(const mouth of mouths){render(full.getContext('2d'),images,spec,{open:'open',half:'eyesHalf',closed:'eyesClosed'}[eye],mouth,make);small.getContext('2d').clearRect(0,0,360,540);small.getContext('2d').drawImage(full,0,0,360,540);humanReview.show({eye,mouth,still:true});const a=small.getContext('2d').getImageData(0,0,360,540).data,b=document.querySelector('#revised').getContext('2d').getImageData(0,0,360,540).data;let opaqueChanged=0,alphaChanged=0;for(let i=0;i<a.length;i+=4){if(a[i+3]===255&&(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]))opaqueChanged++;if(a[i+3]!==b[i+3])alphaChanged++;}rows.push({eye,mouth,opaqueChanged,alphaChanged});}return rows;
  },{spec,assets,renderSource:renderHumanRig.toString(),eyes,mouths});
  for(const row of identity){assert.equal(row.opaqueChanged,0,JSON.stringify(row));assert.equal(row.alphaChanged,0,JSON.stringify(row));}await show({still:true});await shot('baseline');
 });
 await test('near-neutral inverse sampling preserves opacity with no triangle cracks or doubled hair alpha',async()=>{
  nearNeutral=await page.evaluate(()=>{const{frame}=humanReview.show({still:true}),c=document.querySelector('#revised'),ctx=c.getContext('2d'),a=ctx.getImageData(0,0,360,540).data;humanReview.draw({...frame,sway:1e-8});const b=ctx.getImageData(0,0,360,540).data;let alphaMax=0,opaqueMax=0;for(let i=0;i<a.length;i+=4){alphaMax=Math.max(alphaMax,Math.abs(a[i+3]-b[i+3]));if(a[i+3]===255)opaqueMax=Math.max(opaqueMax,Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));}return{alphaMax,opaqueMax}});assert.ok(nearNeutral.alphaMax<=1,JSON.stringify(nearNeutral));assert.ok(nearNeutral.opaqueMax<=1,JSON.stringify(nearNeutral));
 });
 await test('all 21 facial states remain on the rigid face during maximum idle tilt',async()=>{
  const original=await page.locator('#original').evaluate(c=>c.toDataURL());
  for(const eye of eyes){const frames=[{label:'원본 A안',src:original}];for(const mouth of mouths){const r=await show({time:1550,eye,mouth});assert.equal(r.artwork.mouthArtwork,mouth);frames.push({label:mouth,src:await page.locator('#revised').evaluate(c=>c.toDataURL())});const d=Math.hypot(r.landmarks[0].x-r.landmarks[3].x,r.landmarks[0].y-r.landmarks[3].y);assert.ok(Math.abs(d-Math.hypot(354-625,355-624))<1e-8);}await sheet(frames,'moving-'+eye,true);}
 });
 await test('neck remains opaque across y740 split and complete motion cycle',async()=>{
  neckResults=await page.evaluate(()=>{let min=255,samples=0;for(let time=0;time<14000;time+=100){const r=humanReview.show({time}),n=humanReview.neckAlpha(r.frame);min=Math.min(min,n.min);samples+=n.count;}return{min,samples}});assert.equal(neckResults.min,255,JSON.stringify(neckResults));
 });
 await test('full portrait extremes face zoom original overlay and dark backdrop are captured',async()=>{
  const frames=[{label:'원본 A안',src:await page.locator('#original').evaluate(c=>c.toDataURL())}];for(const time of [0,1550,3100,4220,4650,6200,7000]){await show({time});frames.push({label:time+'ms',src:await page.locator('#revised').evaluate(c=>c.toDataURL())});}await sheet(frames,'motion-cycle',false);
  await show({still:true});await page.evaluate(()=>{const a=document.querySelector('#original'),b=document.querySelector('#revised');b.getContext('2d').globalAlpha=.5;b.getContext('2d').drawImage(a,0,0);b.getContext('2d').globalAlpha=1;});await shot('rest-overlay');
  await show({time:1550});await page.evaluate(()=>document.body.classList.add('dark'));await shot('dark-motion');await page.evaluate(()=>document.body.classList.remove('dark'));
 });
 await test('render work is bounded at both regular and high-DPR maximum sizes',async()=>{
  performanceResults=[];for(const size of [360,720]){const p=await page.evaluate(size=>{const times=[];for(let i=0;i<90;i++)times.push(humanReview.show({time:i*1000/30,size}).milliseconds);times.sort((a,b)=>a-b);return{requestedSize:size,width:document.querySelector('#revised').width,samples:times.length,median:times[45],p95:times[85],max:times[89],average:times.reduce((a,b)=>a+b)/times.length}},size);assert.ok(p.width<=512);assert.ok(p.average<33.34,JSON.stringify(p));performanceResults.push(p);}await show({time:0,size:360});
 });
 await test('offline preview starts still loads assets and plays without external requests',async()=>{
  const offline=await browser.newPage({viewport:{width:430,height:960}});observe(offline);await offline.setContent(readFileSync(humanPreviewPath('motion'),'utf8'));await offline.locator('[data-human-status="ready"]').waitFor();assert.equal(await offline.locator('canvas').getAttribute('data-running'),'false');await offline.getByRole('button',{name:'움직임 켜기',exact:true}).click();await offline.evaluate(()=>scrollTo(0,0));await offline.waitForFunction(()=>document.querySelector('canvas')?.dataset.running==='true');await offline.getByRole('button',{name:'움직임 멈추기',exact:true}).click();await offline.screenshot({path:new URL('offline.png',out).pathname});await offline.close();
 });
 if(kind==='chromium'&&process.env.YEONI_REVIEW_VIDEO==='1')await test('12-second review video uses actual browser Canvas motion frames and plays on request',async()=>{
  const frames=new URL('video-frames/',out);mkdirSync(frames,{recursive:true});
  for(let i=0;i<144;i++){await show({time:i*1000/12});await page.evaluate(dark=>document.body.classList.toggle('dark',dark),i>=72);await page.locator('#label').evaluate((e,t)=>{e.textContent=t},'깜빡임 · 숨쉬기 · 작은 고개 움직임');await page.locator('.row').screenshot({path:new URL(String(i).padStart(4,'0')+'.png',frames).pathname});}
  const videoFile=new URL('human-motion-v1.mp4',out);execFileSync('ffmpeg',['-y','-framerate','12','-i',new URL('%04d.png',frames).pathname,'-c:v','libx264','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',videoFile.pathname],{stdio:'pipe'});rmSync(frames,{recursive:true});
  const v=await browser.newPage();await v.setContent('<video controls muted playsinline preload="metadata"></video>');await v.locator('video').evaluate((el,src)=>{el.src=src},'data:video/mp4;base64,'+readFileSync(videoFile).toString('base64'));await v.waitForFunction(()=>document.querySelector('video').readyState>=1);assert.equal(await v.locator('video').evaluate(v=>v.paused),true);await v.locator('video').evaluate(v=>v.play());await v.waitForFunction(()=>document.querySelector('video').currentTime>.3);await v.locator('video').evaluate(v=>v.pause());await v.close();
 });
 await test('disposing releases resources clears pixels and prevents stale drawing',async()=>{await page.evaluate(()=>humanReview.dispose());const blank=await page.locator('#revised').evaluate(c=>c.toDataURL());await show({time:2000});assert.equal(await page.locator('#revised').evaluate(c=>c.toDataURL()),blank)});
 await test('no runtime errors or external requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(external,[])});
}catch(e){results.push({passed:false,error:String(e)});console.error(e);process.exitCode=1;}
finally{writeFileSync(new URL('visual-results.json',out),JSON.stringify({browser:kind,version:browser.version(),results,reviewVideoRequested:process.env.YEONI_REVIEW_VIDEO==='1',identity,nearNeutral,neckResults,performanceResults,errors,external,scope:'Basic human motion only. All mouth states are synthetic visual binding checks, not speech or lip-sync verification. Physical devices not tested.'},null,2));await browser.close();}
async function sheet(frames,name,face){
 const p=await browser.newPage({viewport:{width:1440,height:face?780:1160}});await p.setContent('<style>body{margin:0;background:#f4f0fa;font:18px system-ui}.grid{display:grid;grid-template-columns:repeat(4,360px)}figure{margin:0}.view{position:relative;width:360px;height:'+(face?'343':'540')+'px;overflow:hidden}img{position:absolute;'+(face?'width:878px;height:1317px;left:-257px;top:-236px':'width:360px;height:540px')+'}figcaption{height:30px;text-align:center}</style><div class="grid">'+frames.map(f=>`<figure><figcaption>${f.label}</figcaption><div class="view"><img src="${f.src}"></div></figure>`).join('')+'</div>');await p.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));await p.screenshot({path:new URL(name+'.png',out).pathname,fullPage:true});await p.close();
}
