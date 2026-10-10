import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alignmentConfiguration, savedAlignmentConfiguration, alignGeneratedReply, validateReplyAlignment } from './speech-alignment.ts';
import { readerSnapshot, ReaderSpeechChannel } from './reader-speech.ts';
import { parseLipSyncManifest } from './lip-sync.ts';
import { ZephyrAudioCache } from '../zephyr-playback.ts';
const bytes = Uint8Array.from(readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3')).buffer;
const manifest = parseLipSyncManifest(JSON.parse(readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json','utf8')));
const config = { endpoint: 'https://alignment.invalid/align', token: 'x'.repeat(32) };
test('alignment requires explicit switch, HTTPS and private server credential', () => {
  assert.equal(alignmentConfiguration({}), null);
  assert.equal(alignmentConfiguration({YEONI_REPLY_ALIGNMENT_ENABLED:'1',YEONI_ALIGNMENT_URL:'http://alignment.invalid',YEONI_ALIGNMENT_TOKEN:'x'.repeat(32)}),null);
  assert.equal(alignmentConfiguration({YEONI_REPLY_ALIGNMENT_ENABLED:'1',YEONI_ALIGNMENT_URL:config.endpoint,YEONI_ALIGNMENT_TOKEN:'short'}),null);
  assert.deepEqual(alignmentConfiguration({YEONI_REPLY_ALIGNMENT_ENABLED:'1',YEONI_ALIGNMENT_URL:config.endpoint,YEONI_ALIGNMENT_TOKEN:config.token}),config);
  assert.deepEqual(alignmentConfiguration({YEONI_REPLY_ALIGNMENT_ENABLED:'1',YEONI_ALIGNMENT_INTERNAL_URL:'https://private.invalid/service/worker',YEONI_ALIGNMENT_TOKEN:config.token}),{...config,endpoint:'https://private.invalid/service/worker/align'});
  assert.equal(alignmentConfiguration({YEONI_REPLY_ALIGNMENT_ENABLED:'1',YEONI_ALIGNMENT_INTERNAL_URL:'https://private.invalid/?token=unsafe',YEONI_ALIGNMENT_URL:config.endpoint,YEONI_ALIGNMENT_TOKEN:config.token}),null);
});
test('exact saved recording validates; swapped audio, text, source and unknown phones reject', async () => {
  await validateReplyAlignment(bytes,manifest.spokenText,manifest);
  await assert.rejects(validateReplyAlignment(bytes,'다른 답변',manifest));
  await assert.rejects(validateReplyAlignment(new Uint8Array([1]).buffer,manifest.spokenText,manifest));
  await assert.rejects(validateReplyAlignment(bytes,manifest.spokenText,{...manifest,alignment:'synthetic-clock-test'}));
  await assert.rejects(validateReplyAlignment(bytes,manifest.spokenText,{...manifest,cues:[{startMs:0,endMs:10,phone:'spn'}]}));
});
test('alignment uses one bounded request and fails to audio-only without retries', async () => {
  let calls=0;
  const request: typeof fetch=async (_url,init) => { calls++; assert.equal(init?.redirect,'error'); return Response.json(manifest); };
  assert.deepEqual(await alignGeneratedReply(Buffer.from(bytes).toString('base64'),manifest.spokenText,config,request),manifest);
  assert.equal(calls,1);
  const failed: typeof fetch=async()=>{calls++; throw new Error('offline')};
  assert.equal(await alignGeneratedReply(Buffer.from(bytes).toString('base64'),manifest.spokenText,config,failed),null);
  assert.equal(calls,2);
});
test('actual audio clock governs both renderers; pause, hidden, buffering, seek and mismatch close mouth',()=>{
  const media={currentTime:1.2,duration:manifest.durationMs/1000,paused:false,ended:false,seeking:false,readyState:4,error:null,currentSrc:'blob:one'};
  assert.equal(readerSnapshot(media,manifest,'blob:one',false).playback.currentTimeMs,1200);
  assert.equal(readerSnapshot(media,manifest,'blob:one',false).playback.state,'playing');
  for(const [change,expected] of [[{paused:true},'paused'],[{readyState:1},'waiting'],[{seeking:true},'seeking'],[{ended:true},'ended']] as const) {
    assert.equal(readerSnapshot({...media,...change},manifest,'blob:one',false).playback.state,expected);
  }
  assert.equal(readerSnapshot(media,manifest,'blob:one',true).playback.state,'paused');
  assert.equal(readerSnapshot({...media,duration:90},manifest,'blob:one',false).manifest,null);
  assert.equal(readerSnapshot(media,manifest,'blob:two',false).manifest,null);
  const channel=new ReaderSpeechChannel();const sample=()=>readerSnapshot(media,manifest,'blob:one',false);
  channel.attach('old',sample);channel.attach('new',sample);channel.release('old');assert.ok(channel.snapshot());channel.release('new');assert.equal(channel.snapshot(),null);
});
test('invalid optional alignment preserves generated audio and cached replay never resynthesizes',async()=>{
  const rows=new Map<string,string>();let posts=0;
  const cache=new ZephyrAudioCache();
  const deps={includeAlignment:true,storage:{getItem:(k:string)=>rows.get(k)??null,setItem:(k:string,v:string)=>{rows.set(k,v)}},request:async(init:RequestInit)=>{
    const common={enabled:true,voice:manifest.voice,useDeviceVoice:false,remainingCharacters:1000};
    if(init.method==='GET')return Response.json(common);
    posts++;const body=JSON.parse(init.body as string);assert.equal(body.includeAlignment,true);
    return Response.json({...common,requestId:body.requestId,audioContent:Buffer.from(bytes).toString('base64'),alignment:{...manifest,spokenText:'mismatch'}});
  }};
  const result=await cache.get('owner',manifest.spokenText,deps);assert.equal(result.alignment,undefined);assert.ok(result.audioContent);
  await cache.get('owner',manifest.spokenText,deps);assert.equal(posts,1);
});

test('saved review requires exact Preview branch and internal binding without enabling general TTS', () => {
  const env = {VERCEL_ENV:'preview', VERCEL_GIT_COMMIT_REF:'agent/yeoni-cat-animation-poc', YEONI_ALIGNMENT_INTERNAL_URL:'https://private.invalid/alignment', YEONI_ALIGNMENT_TOKEN:config.token};
  assert.equal(alignmentConfiguration(env), null);
  assert.equal(savedAlignmentConfiguration(env)?.endpoint, 'https://private.invalid/alignment/align');
  assert.equal(savedAlignmentConfiguration({...env, VERCEL_ENV:'production'}),null);
  assert.equal(savedAlignmentConfiguration({...env, VERCEL_GIT_COMMIT_REF:'main'}),null);
  assert.equal(savedAlignmentConfiguration({...env, YEONI_ALIGNMENT_INTERNAL_URL:undefined, YEONI_ALIGNMENT_URL:config.endpoint}),null);
  assert.equal(savedAlignmentConfiguration({...env, YEONI_ALIGNMENT_INTERNAL_URL:'http://private.invalid'}),null);
  assert.equal(savedAlignmentConfiguration({...env, YEONI_ALIGNMENT_TOKEN:'short'}),null);
  assert.equal(alignmentConfiguration(env),null);
});
