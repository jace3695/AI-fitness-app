// Component regression with simulated media/auth, not a real browser or provider test.
// npm install --prefix /tmp/yeoni-phase16-unit --no-audit --no-fund jsdom@26.1.0
import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MessageChannel } from 'node:worker_threads';
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.YEONI_UNIT_JSDOM || '/tmp/yeoni-phase16-unit/node_modules/jsdom');
const manifest=JSON.parse(readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json','utf8'));
const audio = { ko: readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3').toString('base64'), ja: '' };
const entry = `import React,{act} from 'react';import{createRoot}from'react-dom/client';
import Reader from './components/ZephyrReadButton';import Panel from './components/yeoni/ReplyCharacterPanel';
import{savedReplyClips,REPLY_SAMPLES}from'./lib/yeoni/reply-samples';import{buildReplyPlan}from'./lib/yeoni/reply-plan';
import{stopAllSpeech,claimSpeechFocus}from'./lib/yeoni/speech-focus';
const root=createRoot(document.getElementById('root')),clips=savedReplyClips(${JSON.stringify(audio)}).slice(0,1);
window.qa={act,stopAllSpeech,claimSpeechFocus,duration:REPLY_SAMPLES.ko.durationMs/1000,
render:(text)=>root.render(<><Reader text={text} align/><Panel alignReplies presentation="assistant" clips={clips} incoming={{value:{reply:REPLY_SAMPLES.ko.spokenText,performance:buildReplyPlan(REPLY_SAMPLES.ko.spokenText,'unit')}}}/></>),unmount:()=>root.unmount()};`;
const bundle = await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outfile:'unit.js',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'unit-boundaries',setup(b){
  b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'auth',namespace:'unit'}));
  b.onResolve({filter:/SwitchableCharacterStage$/},()=>({path:'stage',namespace:'unit'}));
  b.onLoad({filter:/.*/,namespace:'unit'},a=>({loader:'js',contents:a.path==='stage'?'export default function Stage(props){window.qaSpeech=props.speech;return null}':`const session={user:{id:'unit-owner'},access_token:'synthetic-token'};export const createClient=()=>({auth:{onAuthStateChange(fn){queueMicrotask(()=>fn('INITIAL_SESSION',session));return{data:{subscription:{unsubscribe(){}}}}},getSession:async()=>({data:{session}})}});`}));
}}]});
const dom=new JSDOM('<div id="root"></div>',{url:'https://unit.invalid/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;
Object.defineProperty(w,'crypto',{value:webcrypto});
Object.assign(w,{TextEncoder,TextDecoder,Headers,Response,AbortSignal,IS_REACT_ACT_ENVIRONMENT:true});
const channels=[];w.MessageChannel=class extends MessageChannel {constructor(){super();channels.push(this)}};
const media=new WeakMap();const state=el=>{if(!media.has(el))media.set(el,{paused:true,plays:0});return media.get(el)};
Object.defineProperties(w.HTMLMediaElement.prototype,{
  paused:{get(){return state(this).paused}},ended:{get(){return false}},readyState:{get(){return 4}},
  currentSrc:{get(){return this.getAttribute('src')||''}},duration:{get(){return w.qa.duration}},
});
w.HTMLMediaElement.prototype.pause=function(){const s=state(this);if(!s.paused){s.paused=true;this.dispatchEvent(new w.Event('pause'))}};
w.HTMLMediaElement.prototype.play=async function(){const s=state(this);s.paused=false;s.plays++;this.dispatchEvent(new w.Event('play'));this.dispatchEvent(new w.Event('playing'))};
w.HTMLMediaElement.prototype.load=function(){if(this.src)queueMicrotask(()=>this.dispatchEvent(new w.Event('loadedmetadata')))};
w.URL.createObjectURL=()=>`blob:unit-${webcrypto.randomUUID()}`;w.URL.revokeObjectURL=()=>{};
const requests=[];let release;
w.fetch=async(_url,init)=>{requests.push(init.method);const common={enabled:true,voice:'ko-KR-Chirp3-HD-Zephyr',useDeviceVoice:false,remainingCharacters:10000};
 if(init.method==='GET')return Response.json(common);
 const body=JSON.parse(init.body);await new Promise(resolve=>{release=resolve});return Response.json({...common,requestId:body.requestId,audioContent:audio.ko,alignment:manifest});
};
w.eval(bundle.outputFiles.find(f=>f.path.endsWith('.js')).text);
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(test){for(let i=0;i<100;i++){await w.qa.act(tick);if(test())return;}throw Error('Unit condition timeout: '+w.document.body.textContent)}
const click=async button=>w.qa.act(async()=>{assert.ok(button&&!button.disabled);button.click();await tick()});
const reader=()=>w.document.querySelector('[aria-label="Zephyr 답변 읽기"] button');
const character=()=>w.document.querySelector('[aria-label="연이 대화 캐릭터"]');
const byText=text=>[...character().querySelectorAll('button')].find(b=>b.textContent===text);
await w.qa.act(async()=>{w.qa.render(manifest.spokenText);await tick()});
await until(()=>character().dataset.replyStatus==='ready'&&reader());
await click(reader());await until(()=>release);
await w.qa.act(async()=>{release();await tick()});await until(()=>reader().textContent==='읽기 중지');
const readAudio=w.document.querySelector('[aria-label="Zephyr 답변 음성"]');
readAudio.currentTime=1.2;
assert.equal(w.qaSpeech().manifest.audioSha256,manifest.audioSha256);
assert.equal(w.qaSpeech().playback.currentTimeMs,1200);
assert.equal(w.qaSpeech().playback.state,'playing');
await click(reader());assert.notEqual(w.qaSpeech().playback.state,'playing');
await click(reader());assert.equal(w.qaSpeech().playback.state,'playing');
await w.qa.act(async()=>{w.dispatchEvent(new w.Event('pagehide'));await tick()});
assert.equal(readAudio.paused,true);assert.notEqual(w.qaSpeech().playback.state,'playing');
assert.equal(requests.filter(m=>m==='POST').length,1);
await click(reader());
await w.qa.act(async()=>w.qa.unmount());assert.equal(readAudio.paused,true);
dom.window.close();channels.forEach(channel=>{channel.port1.close();channel.port2.close()});
console.log(JSON.stringify({passed:7,scope:'Actual Reader/Panel and saved Zephyr audio/alignment; simulated DOM/media/auth/provider and renderer. No new TTS, no live alignment worker.'}));
