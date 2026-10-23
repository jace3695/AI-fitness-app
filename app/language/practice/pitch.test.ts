import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPitch, framePitch, readPitch, type PitchDecoder } from './pitch.ts';
const sine=(hz:number,seconds=.12,rate=8000)=>Float32Array.from({length:Math.floor(rate*seconds)},(_,i)=>.3*Math.sin(2*Math.PI*hz*i/rate));
test('synthetic pitches across display range and sample rates are recovered without a score', async()=>{
 for(const rate of [8000,44100,48000]) for(const hz of [80,120,220,440,550]) {
  const points=await extractPitch(sine(hz,.3,rate),rate,new AbortController().signal);
  assert.ok(points.length>0);for(const p of points){assert.ok(p.hz!==null);assert.ok(Math.abs(p.hz!-hz)<3, String(p.hz));}
 }
});
test('silence, low level, DC, nonfinite and deterministic noise are not plotted',()=>{
 let seed=17;const noise=Float32Array.from({length:480},()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32-.5});
 for(const frame of [new Float32Array(480),new Float32Array(480).fill(.3),sine(220).map(x=>x*.001),noise,new Float32Array(480).fill(NaN)])assert.equal(framePitch(frame,8000),null);
});
test('rising synthetic voice and silent gaps retain time and gaps',async()=>{
 const input=new Float32Array(8000*.6);input.set(sine(120,.24));input.set(sine(300,.24),2880);
 const points=await extractPitch(input,8000,new AbortController().signal);
 assert.ok(points.some(p=>p.hz===null));assert.ok(points[0].hz!<points.at(-1)!.hz!);assert.ok(points.at(-1)!.seconds>points[0].seconds);
});
test('invalid duration and cancellation stop local extraction',async()=>{
 await assert.rejects(extractPitch(new Float32Array(8000*32),8000,new AbortController().signal));
 const c=new AbortController();c.abort();await assert.rejects(extractPitch(sine(220),8000,c.signal),{name:'AbortError'});
 const d=new AbortController();const task=extractPitch(sine(220,10),8000,d.signal);d.abort();await assert.rejects(task,{name:'AbortError'});
});
test('decoder closes on success and decode errors',async()=>{
 for(const fail of [false,true]){let closed=0;const decoder:PitchDecoder={decodeAudioData:async()=>{if(fail)throw Error('codec');return {duration:.12,sampleRate:8000,getChannelData:()=>sine(220)}},close:async()=>{closed++}};
 const result=readPitch(new Blob(['synthetic']),new AbortController().signal,()=>decoder);
 if(fail)await assert.rejects(result);else assert.ok((await result).length);assert.equal(closed,1);}
});
test('cancel pending decode closes context and late completion cannot return results',async()=>{
 let finish!:(value: {duration:number;sampleRate:number;getChannelData:()=>Float32Array})=>void;let closed=0,reads=0;
 const c=new AbortController();const task=readPitch(new Blob(['synthetic']),c.signal,()=>({decodeAudioData:()=>new Promise(resolve=>{finish=resolve}),close:async()=>{closed++}}));
 await new Promise(resolve=>setTimeout(resolve,0));c.abort();await assert.rejects(task,{name:'AbortError'});assert.equal(closed,1);
 finish({duration:.12,sampleRate:8000,getChannelData:()=>{reads++;return sine(220)}});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(reads,0);
});


test('out-of-range high tones do not appear as false lower octaves',()=>{
 for(const hz of [700,1000,1500]) assert.equal(framePitch(sine(hz,.06),8000),null, String(hz));
});
test('cancellation is not held hostage by a stalled decoder close',async()=>{
 const c=new AbortController();let closeRequested=0;
 const task=readPitch(new Blob(['synthetic']),c.signal,()=>({decodeAudioData:()=>new Promise(()=>{}),close:()=>{closeRequested++;return new Promise(()=>{});}}));
 c.abort();
 const result=await Promise.race([task.then(()=> 'unexpected',()=> 'cancelled'),new Promise(resolve=>setTimeout(()=>resolve('stalled'),50))]);
 assert.equal(result,'cancelled');assert.equal(closeRequested,1);
});


test('long high-rate preprocessing yields before PCM access so cancellation stays responsive',async()=>{
 const signal=new AbortController(); const pcm=new Float32Array(192000*30);
 const pending=extractPitch(pcm,192000,signal.signal);
 signal.abort();await assert.rejects(pending,{name:'AbortError'});
});
test('oversized blob is rejected before allocating decoder and invalid decoded duration before PCM access',async()=>{
 let created=0;
 await assert.rejects(readPitch(new Blob([new Uint8Array(5*1024*1024+1)]),new AbortController().signal,()=>{created++;throw Error('must not create')}));assert.equal(created,0);
 for(const duration of [-1,NaN,32]){let read=0,closed=0;await assert.rejects(readPitch(new Blob(['synthetic']),new AbortController().signal,()=>({decodeAudioData:async()=>({duration,sampleRate:8000,getChannelData:()=>{read++;return sine(220)}}),close:async()=>{closed++}})));assert.equal(read,0);assert.equal(closed,1);}
});
