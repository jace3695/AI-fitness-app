import { build } from './browser-qa/node_modules/esbuild/lib/main.js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const bundle = await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{useWorkoutVoice}from'./app/components/useWorkoutVoice';import{claimSpeechFocus,stopAllSpeech}from'./lib/yeoni/speech-focus';
function App(){const v=useWorkoutVoice(true);window.qa={v,claimSpeechFocus,stopAllSpeech};return <><audio ref={v.audio}/><button onClick={()=>v.speak('합성 안내')}>말하기</button><p role="status">{v.announcement}</p></>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'auth',namespace:'fixture'}));
 b.onResolve({filter:/^@\/lib\/zephyr-playback$/},()=>({path:'voice',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='auth'?`export const createClient=()=>({auth:{getSession:async()=>({data:{session:{user:{id:'A'},access_token:'synthetic'}}}),onAuthStateChange(fn){queueMicrotask(()=>fn('INITIAL_SESSION',{user:{id:'A'}}));return {data:{subscription:{unsubscribe(){}}}}}}});`:`export const prepareZephyrSpeech=text=>({text});export class ZephyrAudioCache{clear(){}get(){return new Promise(resolve=>{window.releaseVoice=()=>resolve({audioContent:'synthetic'})})}}` }));
}}]});
const server=createServer((_q,r)=>{r.setHeader('Content-Type','text/html');r.end('<div id="root"></div><script>'+bundle.outputFiles[0].text+'</script>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():(external.push(r.request().url()),r.abort()));
await page.addInitScript(()=>{window.played=[];HTMLMediaElement.prototype.play=function(){window.played.push(this.src);return Promise.resolve()};HTMLMediaElement.prototype.pause=function(){};HTMLMediaElement.prototype.load=function(){};});
try{
 await page.goto(origin);await page.getByRole('button').click();await expect.poll(()=>page.evaluate(()=>!!window.releaseVoice)).toBe(true);
 await page.evaluate(()=>{window.qa.claimSpeechFocus('other');window.releaseVoice()});await expect(page.getByRole('status')).toHaveText('');
 assert.equal(await page.evaluate(()=>window.played.some(s=>s.includes('mpeg'))),false);
 await page.evaluate(()=>{window.releaseVoice=null});await page.getByRole('button').click();await expect.poll(()=>page.evaluate(()=>!!window.releaseVoice)).toBe(true);
 await page.evaluate(()=>window.releaseVoice());await page.waitForTimeout(100);console.log(await page.evaluate(()=>({played:window.played,notice:window.qa.v.notice,announcement:window.qa.v.announcement,src:document.querySelector('audio').getAttribute('src'),visibility:document.visibilityState})));await expect.poll(()=>page.evaluate(()=>window.played.filter(s=>s.includes('mpeg')).length)).toBe(1);
 await page.evaluate(()=>window.qa.stopAllSpeech());await expect(page.getByRole('status')).toHaveText('');assert.equal(await page.locator('audio').getAttribute('src'),null);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({passed:3,checks:['competing focus invalidates pending workout audio','new workout cue can claim focus and play synthetic bytes','global stop clears workout source and announcement'],errors,external,scope:'actual hook; synthetic auth/cache/media; no TTS or SQL'}));
}finally{await browser.close();await new Promise(r=>server.close(r))}
