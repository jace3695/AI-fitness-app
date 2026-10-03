import { chromium, webkit } from 'playwright';
import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const kind = process.env.YEONI_BROWSER || 'chromium';
const out = `docs/yeoni-phase12/evidence/real-${kind}`; mkdirSync(out, { recursive: true });
const browser = await ({chromium, webkit})[kind].launch({headless:true, ...(process.env.YEONI_CHROMIUM && kind === 'chromium' ? {executablePath:process.env.YEONI_CHROMIUM}:{}), ...(kind==='chromium'?{args:['--no-sandbox','--disable-dev-shm-usage']}: {})});
const context = await browser.newContext({viewport:{width:390,height:844}});
const page = await context.newPage(), errors=[], external=[], results=[];
page.on('pageerror', e=>errors.push(e.message));
await context.route('**/*', r=>/^(file:|data:|blob:)/.test(r.request().url())?r.continue():(external.push(r.request().url()),r.abort()));
const button = name=>page.getByRole('button',{name,exact:true});
const state = s=>page.waitForFunction(s=>document.querySelector('[data-speech-state]')?.dataset.speechState===s,s);
const ready = skin=>page.waitForFunction(s=>document.querySelector('[data-appearance-status]')?.dataset.appearanceStatus==='ready' && document.querySelector('canvas')?.dataset.appearance===s,skin);
async function test(name, fn){await fn();results.push({name,passed:true});console.log('PASS',name);}
try {
 await page.goto(pathToFileURL(resolve('docs/yeoni-phase12/Yeoni_Japanese_Real_Speech_Preview.html')).href);await ready('cat');
 await test('real Japanese file loads with verified manifest, no autoplay',async()=>{await button('일본어 실제 음성 불러오기').click();await state('ready');assert.match(await page.locator('.sample-badge').textContent(),/일본어.*자동 정렬/);const a=await page.locator('audio').evaluate(a=>({duration:a.duration,paused:a.paused}));assert.ok(Math.abs(a.duration-4.056)<.1);assert.ok(a.paused);});
 const probe = await build({stdin:{contents: `import {parseLipSyncManifest,visemeAt} from './lib/yeoni/lip-sync.ts';import m from './docs/yeoni-phase12/alignment/timeline.json';const manifest=parseLipSyncManifest(m);window.expectedViseme=t=>visemeAt(manifest,t);`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'});
 await page.addScriptTag({content:probe.outputFiles[0].text});
 await page.evaluate(()=>{window.clockSamples=[];window.sampleTimer=setInterval(()=>{const c=document.querySelector('canvas'),a=document.querySelector('audio');if(c&&a&&!a.paused&&!a.seeking){const t=Number(c.dataset.speechTimeMs);window.clockSamples.push({t,media:a.currentTime*1000,actual:c.dataset.viseme,expected:window.expectedViseme(t)});}},20);});
 await test('normal playback switches appearance without replacing or restarting audio',async()=>{await page.evaluate(()=>{window.savedAudio=document.querySelector('audio');window.savedSrc=window.savedAudio.currentSrc;});await button('재생').click();await state('playing');await button('인간형').click();await ready('human');assert.ok(await page.evaluate(()=>document.querySelector('audio')===window.savedAudio && window.savedAudio.currentSrc===window.savedSrc && !window.savedAudio.paused && window.savedAudio.currentTime>0));await state('ended');assert.equal(await page.locator('canvas').getAttribute('data-viseme'),'rest');});
 await test('rendered Japanese frames follow the measured timeline and media clock',async()=>{const samples=await page.evaluate(()=>{clearInterval(window.sampleTimer);return window.clockSamples;});assert.ok(samples.length>50);for(const s of samples){assert.equal(s.actual,s.expected);assert.ok(Math.abs(s.media-s.t)<150);}writeFileSync(`${out}/clock-samples.json`,JSON.stringify(samples,null,2));});
 await test('both appearances render measured vowel, silence and bilabial intervals',async()=>{for(const skin of ['cat','human']){await button(skin==='cat'?'고양이형':'인간형').click();await ready(skin);for(const [t,v] of [[.57,'a'],[.9,'rest'],[1.4,'o'],[3.25,'closed']]){await page.locator('audio').evaluate((a,t)=>{a.pause();a.currentTime=t;},t);await page.waitForFunction(t=>Math.abs(Number(document.querySelector('canvas')?.dataset.speechTimeMs)-t*1000)<20,t);/* paused intentionally closes the mouth */await button('재생').click();await page.waitForFunction(v=>document.querySelector('canvas')?.dataset.viseme===v,v,{timeout:1500});await button('일시정지').click();}await page.screenshot({path:`${out}/${skin}-390.png`,fullPage:true});}});
 await test('pause, stop and rate change retain one audio and neutral mouth',async()=>{await button('처음으로').click();await page.locator('audio').evaluate(a=>{a.playbackRate=.75;});await button('재생').click();await state('playing');await button('일시정지').click();await state('paused');await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.viseme==='rest');assert.equal(await page.locator('audio').count(),1);await button('처음으로').click();assert.equal(await page.locator('audio').evaluate(a=>a.currentTime),0);});
 await test('reload clears playback and allows reloading embedded audio without network',async()=>{await page.reload();await ready('cat');await state('empty');await button('일본어 실제 음성 불러오기').click();await state('ready');assert.ok(await page.locator('audio').evaluate(a=>a.paused));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);});
} finally {writeFileSync(`${out}/results.json`,JSON.stringify({browser:kind,version:browser.version(),results,errors,external,alignmentReview:'not human approved'},null,2)+'\n');await browser.close();}
