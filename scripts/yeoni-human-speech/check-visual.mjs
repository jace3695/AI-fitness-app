import {chromium,webkit} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {server} from './server.mjs';
const root=new URL('../../',import.meta.url),kind=process.env.YEONI_BROWSER||'chromium',out=new URL(`.e2e/yeoni-human-speech/${kind}/`,root);
mkdirSync(out,{recursive:true});
const dir=new URL('public/yeoni/human/rig-v4/',root),spec=JSON.parse(readFileSync(new URL('manifest.json',dir))),assets={};
const uri=url=>'data:image/'+(url.pathname.endsWith('.png')?'png':'webp')+';base64,'+readFileSync(url).toString('base64');
for(const p of [spec.source,...Object.values(spec.layers),...Object.values(spec.faceParts).flat()]){
 assert.equal(createHash('sha256').update(readFileSync(new URL(p.image,dir))).digest('hex'),p.sha256);assets[p.image]=uri(new URL(p.image,dir));
}
const browser=await({chromium,webkit})[kind].launch({headless:true}),context=await browser.newContext({viewport:{width:800,height:1150},reducedMotion:'no-preference'});
const errors=[],external=[],results=[];let comparison=[],sampleCount=0,video;
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
context.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:8879/'))external.push(r.url())});
const page=await context.newPage(),button=name=>page.getByRole('button',{name,exact:true});
const state=value=>page.locator(`[data-speech-state="${value}"]`).waitFor();
const test=async(name,run)=>{await run();results.push({name,passed:true});console.log('PASS '+name)};
let samples=[];
try{
 await page.goto('http://127.0.0.1:8879/');await page.locator('[data-human-status="ready"]').waitFor();
 await page.addScriptTag({url:'http://127.0.0.1:8879/probe.js'});
 await button('저장된 연이 음성 불러오기').click();await state('ready');
 await test('record actual normal-speed MP3 playback and return to the original closed mouth',async()=>{
  await page.evaluate(()=>speechReview.record());await button('재생').click();await state('playing');await state('ended');
  await page.waitForFunction(()=>document.querySelector('.portrait canvas').dataset.viseme==='rest');
  samples=await page.evaluate(()=>speechReview.finish());sampleCount=samples.length;
  assert.ok(sampleCount>30);assert.equal(samples.at(-1).shape,'rest');assert.ok(samples.at(-1).media>=5276);
  await page.screenshot({path:new URL('real-voice-ended.png',out).pathname,fullPage:true});
 });
 await test('actual speech pixels match approved face patches and neck remains opaque',async()=>{
  comparison=await page.evaluate(input=>speechReview.compare(input),{samples,spec,assets});
  for(const row of comparison){assert.equal(row.opaqueChanged,0,JSON.stringify(row));assert.ok(row.alphaMax<=1,JSON.stringify(row));assert.equal(row.neckMin,255,JSON.stringify(row));}
  assert.ok(new Set(comparison.map(r=>r.shape)).size>=6);
 });
 await test('original comparison sheets capture natural speech states and end state',async()=>{
  const choices=[{label:'승인 원본 A안',png:assets[spec.source.image]}];
  for(const shape of ['rest','a','i','u','e','o','closed','small']){const s=samples.find(s=>s.shape===shape);if(s)choices.push({label:`${shape} · ${(s.media/1000).toFixed(2)}초`,png:s.png});}
  for(const face of [true,false]){
   const p=await context.newPage();await p.setViewportSize({width:1440,height:face?1120:1710});
   await p.setContent('<style>body{margin:0;background:#f4f0fa;font:18px system-ui}.grid{display:grid;grid-template-columns:repeat(4,360px)}figure{margin:0}.view{position:relative;width:360px;height:'+(face?'343':'540')+'px;overflow:hidden}img{position:absolute;'+(face?'width:878px;height:1317px;left:-257px;top:-236px':'width:360px;height:540px')+'}figcaption{height:30px;text-align:center}</style><div class="grid">'+choices.map(f=>`<figure><figcaption>${f.label}</figcaption><div class="view"><img src="${f.png}"></div></figure>`).join('')+'</div>');
   await p.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));await p.screenshot({path:new URL(face?'speech-faces.png':'speech-portraits.png',out).pathname,fullPage:true});await p.close();
  }
 });
 await test('offline HTML loads its embedded MP3 and face assets without external requests or autoplay',async()=>{
  const p=await context.newPage();await p.goto(pathToFileURL(new URL('docs/yeoni-phase9/Yeoni_Human_Speech_Preview.html',root).pathname).href);
  await p.locator('[data-human-status="ready"]').waitFor();await p.getByRole('button',{name:'저장된 연이 음성 불러오기',exact:true}).click();await p.locator('[data-speech-state="ready"]').waitFor();
  assert.equal(await p.locator('audio').evaluate(a=>a.paused),true);await p.getByRole('button',{name:'재생',exact:true}).click();await p.locator('[data-speech-state="playing"]').waitFor();
  await p.waitForFunction(()=>document.querySelector('.portrait canvas').dataset.viseme==='a');await p.getByRole('button',{name:'일시정지',exact:true}).click();
  await p.screenshot({path:new URL('offline.png',out).pathname});await p.close();
 });
 if(kind==='chromium')await test('review MP4 reuses the original voice with timestamped actual browser frames',async()=>{
  const p=await context.newPage();await p.setViewportSize({width:736,height:600});
  await p.setContent('<style>body{margin:0;background:#f4f0fa}</style><canvas width="736" height="600"></canvas>');
  await p.evaluate(async data=>{window.framesToShow=await Promise.all(data.map(async s=>{const img=new Image();img.src=s.png;await img.decode();return{...s,img}}));},[{media:-1,png:assets[spec.source.image]},...samples]);
  const frames=new URL('video-frames/',out);mkdirSync(frames,{recursive:true});
  for(let i=0;i<144;i++){
   const png=await p.evaluate(ms=>{const frames=window.framesToShow,c=document.querySelector('canvas'),ctx=c.getContext('2d');let s=frames[1];for(const f of frames.slice(1))if(f.media<=ms)s=f;
    ctx.fillStyle='#f4f0fa';ctx.fillRect(0,0,736,600);ctx.imageSmoothingQuality='high';ctx.drawImage(frames[0].img,0,30,360,540);ctx.drawImage(s.img,376,30,360,540);
    ctx.fillStyle='#342d47';ctx.textAlign='center';ctx.font='16px system-ui';ctx.fillText('승인 원본 A안',180,22);ctx.fillText('기존 음성 · 실제 발화 동작',556,22);ctx.font='14px system-ui';ctx.fillText('안녕하세요. 오늘 일정을 알려드릴게요. 오늘은 조금 쉬는 게 좋겠어요.',368,590);return c.toDataURL().split(',')[1];},i*1000/24);
   writeFileSync(new URL(String(i).padStart(4,'0')+'.png',frames),Buffer.from(png,'base64'));
  }
  const file=new URL('human-speech-v1.mp4',out);execFileSync('ffmpeg',['-y','-framerate','24','-i',new URL('%04d.png',frames).pathname,'-i',new URL('docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3',root).pathname,'-c:v','libx264','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-af','apad','-t','6','-movflags','+faststart',file.pathname],{stdio:'pipe'});rmSync(frames,{recursive:true});
  video={path:'human-speech-v1.mp4',durationSeconds:6,fps:24,sourceFrames:sampleCount,audio:'unchanged 5.376-second MP3 decoded and AAC muxed; silence padded to 6s',sampling:'Timestamped actual playback Canvas snapshots held until next captured media timestamp; not interpolated or slowed'};
  await p.setContent('<video controls playsinline></video>');await p.locator('video').evaluate((v,src)=>{v.src=src},'data:video/mp4;base64,'+readFileSync(file).toString('base64'));await p.waitForFunction(()=>document.querySelector('video').readyState>=1);
  assert.equal(await p.locator('video').evaluate(v=>v.paused),true);await p.locator('video').evaluate(v=>v.play());await p.waitForFunction(()=>document.querySelector('video').currentTime>.3);await p.locator('video').evaluate(v=>v.pause());await p.close();
 });
 await test('no runtime exceptions or external requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(external,[])});
}catch(e){results.push({passed:false,error:String(e)});console.error(e);process.exitCode=1;}
finally{writeFileSync(new URL('visual-results.json',out),JSON.stringify({browser:kind,version:browser.version(),results,sampleCount,comparison,video,errors,external,scope:'Actual saved MP3 and approved human artwork. Automatic alignment/listening and physical-device latency remain unverified.'},null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
