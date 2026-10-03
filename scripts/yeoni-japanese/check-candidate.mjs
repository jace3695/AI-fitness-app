import { chromium } from 'playwright';
import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = 'docs/yeoni-phase12/gemini-candidate/evidence/chromium';
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync('docs/yeoni-phase12/gemini-candidate/alignment/timeline.json'));
const source = 'docs/yeoni-voice-comparison/media/gemini-zephyr-ja-user.wav';
const target = resolve(process.argv[2] || '../deliverables/Yeoni_Korean_Japanese_Character_Preview.html');
const browser = await chromium.launch({executablePath:process.env.YEONI_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage']});
const context = await browser.newContext({viewport:{width:390,height:900}});
await context.addInitScript(()=>{
 const create=URL.createObjectURL.bind(URL);window.blobHashes=new Map();
 URL.createObjectURL=function(blob){const url=create(blob);if(blob instanceof Blob)window.blobHashes.set(url,blob.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(hash=>Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')));return url;};
});
const page = await context.newPage(), errors=[], external=[], results=[], clocks=[], captures=[];
page.on('pageerror', e=>errors.push(e.message));
await context.route('**/*', r=>/^(file:|data:|blob:)/.test(r.request().url())?r.continue():(external.push(r.request().url()),r.abort()));
const button = name=>page.getByRole('button',{name,exact:true});
const state = s=>page.waitForFunction(s=>document.querySelector('[data-speech-state]')?.dataset.speechState===s,s);
const ready = skin=>page.waitForFunction(s=>document.querySelector('[data-appearance-status]')?.dataset.appearanceStatus==='ready' && document.querySelector('canvas')?.dataset.appearance===s,skin);
const rest = ()=>page.waitForFunction(()=>document.querySelector('canvas')?.dataset.viseme==='rest');
async function test(name, fn){await fn();results.push({name,passed:true});console.log('PASS',name);}
async function play(){await button('재생').click();await page.locator('.portrait').scrollIntoViewIfNeeded();await state('playing');}
async function loadJapanese(){await button('후보 일본어 불러오기').click();await state('ready');}
async function digest(){return page.locator('audio').evaluate(a=>window.blobHashes.get(a.currentSrc));}
try {
 await page.goto(pathToFileURL(target).href);await ready('cat');
 await test('candidate loads exact WAV and Japanese text without autoplay',async()=>{
  await loadJapanese();
  assert.equal(await digest(),manifest.audioSha256);
  assert.equal(await page.locator('.spoken').textContent(),manifest.spokenText);
  assert.equal(await page.locator('[data-speech-language]').getAttribute('data-speech-language'),'ja-JP');
  assert.ok(await page.locator('audio').evaluate(a=>a.paused&&Math.abs(a.duration-5.08)<.005));
 });
 const probe = await build({stdin:{contents:`import {parseLipSyncManifest,visemeAt} from './lib/yeoni/lip-sync.ts';import {mouthAt} from './lib/yeoni/mouth-motion.ts';import m from './docs/yeoni-phase12/gemini-candidate/alignment/timeline.json';const manifest=parseLipSyncManifest(m);window.expected=t=>({viseme:visemeAt(manifest,t),mouth:mouthAt(manifest,t)});`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'});
 await page.addScriptTag({content:probe.outputFiles[0].text});
 await test('both appearances play candidate to completion using its new timeline and smoothing',async()=>{
  for(const skin of ['cat','human']){
   await button(skin==='cat'?'고양이형':'인간형').click();await ready(skin);await button('처음으로').click();
   await page.evaluate(()=>{
    window.clockSamples=[];window.frameCaptures={};
    window.sampleTimer=setInterval(()=>{
     const c=document.querySelector('canvas'),a=document.querySelector('audio');
     if(!c||!a||a.paused||a.seeking||a.readyState<2||c.dataset.running!=='true')return;
     const t=Number(c.dataset.speechTimeMs), expected=window.expected(t),mouth=JSON.parse(c.dataset.mouthPose);
     window.clockSamples.push({t,media:a.currentTime*1000,actual:c.dataset.viseme,expected:expected.viseme,mouth,expectedMouth:expected.mouth});
     if(mouth.from===mouth.to&&!window.frameCaptures[mouth.to])window.frameCaptures[mouth.to]={t,src:c.toDataURL('image/png')};
    },20);
   });
   await play();await state('ended');await rest();
   const data=await page.evaluate(()=>{clearInterval(window.sampleTimer);return {samples:window.clockSamples,frames:window.frameCaptures};});
   assert.ok(data.samples.length>100);
   for(const s of data.samples){assert.equal(s.actual,s.expected);assert.deepEqual(s.mouth,s.expectedMouth);assert.ok(Math.abs(s.media-s.t)<150);}
   clocks.push({skin,samples:data.samples});
   for(const [shape,frame] of Object.entries(data.frames)){writeFileSync(`${out}/${skin}-${shape}.png`,Buffer.from(frame.src.split(',')[1],'base64'));captures.push({skin,shape,t:frame.t});}
   for(const shape of ['rest','a','i','u','o','closed'])assert.ok(data.frames[shape],`${skin}: missing ${shape}`);
   await page.screenshot({path:`${out}/${skin}-390.png`,fullPage:true});
  }
 });
 await test('appearance switches mid-speech keep the same media element, source and advancing clock',async()=>{
  await button('처음으로').click();await play();
  await page.evaluate(()=>{window.savedAudio=document.querySelector('audio');window.savedSrc=window.savedAudio.currentSrc;});
  for(const [skin,name] of [['cat','고양이형'],['human','인간형']]){
   const before=await page.locator('audio').evaluate(a=>a.currentTime);
   await button(name).click();await ready(skin);
   assert.ok(await page.evaluate(t=>{const a=document.querySelector('audio');return a===window.savedAudio&&a.currentSrc===window.savedSrc&&!a.paused&&a.currentTime>=t;},before));
  }
  await button('일시정지').click();await rest();
 });
 await test('changing between original Korean and candidate Japanese resets safely without changing Korean bytes',async()=>{
  await button('저장된 연이 음성 불러오기').click();await state('ready');
  assert.equal(await digest(),'f598b457e49734e75a83a04e57b28f47f7a8d98ceb1aff1549942a5264b9ef2d');
  assert.ok(await page.locator('audio').evaluate(a=>a.paused&&a.currentTime===0));
  await play();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.2);
  await loadJapanese();await rest();assert.equal(await digest(),manifest.audioSha256);
  assert.ok(await page.locator('audio').evaluate(a=>a.paused&&a.currentTime===0));
  assert.equal(await page.locator('audio').count(),1);
 });
 await test('pause, seek, rate, reset and page exit leave no stale moving mouth',async()=>{
  await page.locator('audio').evaluate(a=>{a.currentTime=2.65;a.playbackRate=.75;});
  await play();await button('일시정지').click();await state('paused');await rest();
  assert.equal(await page.locator('audio').evaluate(a=>a.playbackRate),.75);
  await button('처음으로').click();assert.equal(await page.locator('audio').evaluate(a=>a.currentTime),0);
  await play();await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await state('paused');await rest();
  await button('화면 나가기').click();assert.equal(await page.locator('canvas').count(),0);
  await button('돌아오기').click();await ready('cat');assert.ok(await page.locator('audio').evaluate(a=>a.paused));
 });
 await test('old Japanese timeline is rejected for candidate bytes, then embedded candidate recovers',async()=>{
  await page.locator('.checks summary').click();
  await page.locator('input[type=file]').nth(0).setInputFiles(source);
  await page.locator('input[type=file]').nth(1).setInputFiles('docs/yeoni-phase12/alignment/timeline.json');
  await button('선택한 파일 확인').click();await state('error');
  assert.match(await page.locator('[data-speech-state]').textContent(),/일치하지/);
  assert.ok(await button('재생').isDisabled());
  await loadJapanese();await play();await button('일시정지').click();
 });
 await test('reload and mobile/desktop layouts preserve offline operation and explicit play',async()=>{
  await page.reload();await ready('cat');await state('empty');await loadJapanese();
  assert.ok(await page.locator('audio').evaluate(a=>a.paused));
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 });
}finally{
 writeFileSync(`${out}/clock-samples.json`,JSON.stringify(clocks,null,2)+'\n');
 writeFileSync(`${out}/captures.json`,JSON.stringify(captures,null,2)+'\n');
 writeFileSync(`${out}/results.json`,JSON.stringify({browser:'chromium',version:browser.version(),results,errors,external,providerCalls:0,alignmentAccuracyHumanApproved:false,physicalIPhoneVerified:false,maxClockDifferenceMs:clocks.length?Math.max(...clocks.flatMap(c=>c.samples.map(s=>Math.abs(s.media-s.t)))):null},null,2)+'\n');
 await browser.close();
}
