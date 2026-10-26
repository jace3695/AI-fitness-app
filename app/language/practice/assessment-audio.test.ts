import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAssessmentWav, prepareAssessmentWav, buildAssessmentEnvelope, type AssessmentDecodedAudio } from './assessment-audio.ts';
const decoded=(rate=44100,seconds=1,channels=1):AssessmentDecodedAudio=>{const values=Array.from({length:channels},()=>Float32Array.from({length:rate*seconds},(_,i)=>.3*Math.sin(2*Math.PI*220*i/rate)));return{sampleRate:rate,duration:seconds,length:values[0].length,numberOfChannels:channels,getChannelData:i=>values[i]};};
const input=new Blob(['synthetic container'],{type:'audio/webm'});
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve};};
test('44.1k stereo sine becomes canonical mono PCM16 16k WAV with bounded duration and preserved basic tone',async()=>{
 const wav=await encodeAssessmentWav(decoded(44100,1,2),new AbortController().signal);assert.equal(wav.type,'audio/wav');assert.equal(wav.size,32044);const data=new DataView(await wav.arrayBuffer());assert.equal(data.getUint16(22,true),1);assert.equal(data.getUint32(24,true),16000);assert.equal(data.getUint16(34,true),16);assert.equal(data.getUint32(40,true),32000);let crossings=0;for(let i=1;i<16000;i++)if(data.getInt16(44+2*(i-1),true)<0&&data.getInt16(44+2*i,true)>=0)crossings++;assert.ok(crossings>=219&&crossings<=221);
});
test('8k upsample, silence and opposite stereo mix produce valid waveform without a score',async()=>{
 const low=await encodeAssessmentWav(decoded(8000),new AbortController().signal);assert.equal(low.size,32044);const a=new Float32Array(16000).fill(.5),b=new Float32Array(16000).fill(-.5);const wav=await encodeAssessmentWav({...decoded(16000),numberOfChannels:2,getChannelData:i=>i?a:b},new AbortController().signal);const bytes=new Uint8Array(await wav.arrayBuffer());assert.ok(bytes.subarray(44).every(x=>x===0));
});
test('30s limit is exact; overlong, mismatched, multichannel, clipped and nonfinite input fail closed',async()=>{
 assert.equal((await encodeAssessmentWav(decoded(16000,30),new AbortController().signal)).size,960044);
 for(const audio of [{...decoded(),duration:31},{...decoded(),duration:.5},{...decoded(),numberOfChannels:3},{...decoded(),sampleRate:192000},{...decoded(),getChannelData:()=>new Float32Array(1)},{...decoded(16000),getChannelData:()=>new Float32Array(16000).fill(NaN)},{...decoded(16000),getChannelData:()=>new Float32Array(16000).fill(2)}])await assert.rejects(encodeAssessmentWav(audio,new AbortController().signal));
});
test('long conversion yields to event loop and abort stops without producing a blob',async()=>{
 const ctrl=new AbortController();const pending=encodeAssessmentWav(decoded(96000,30),ctrl.signal);await new Promise(r=>setTimeout(r,0));ctrl.abort();await assert.rejects(pending);
});
test('invalid Blob rejected before decoder construction and successful native seam closes once',async()=>{
 let created=0,closed=0;for(const blob of [new Blob([],{type:'audio/webm'}),new Blob(['x'],{type:'text/plain'}),new Blob([new Uint8Array(5*1024*1024+1)],{type:'audio/wav'})])await assert.rejects(prepareAssessmentWav(blob,new AbortController().signal,()=>{created++;throw Error()}));assert.equal(created,0);
 const wav=await prepareAssessmentWav(input,new AbortController().signal,()=>({decodeAudioData:async()=>decoded(),close:async()=>{closed++}}));assert.equal(wav.size,32044);assert.equal(closed,1);
});
test('decoder failure, explicit cancel and noncooperative late decode release context and skip sample work',async()=>{
 let closed=0;await assert.rejects(prepareAssessmentWav(input,new AbortController().signal,()=>({decodeAudioData:async()=>{throw Error('decode')},close:async()=>{closed++}})));assert.equal(closed,1);
 const wait=deferred<AssessmentDecodedAudio>();const ctrl=new AbortController();let inspected=0;const pending=prepareAssessmentWav(input,ctrl.signal,()=>({decodeAudioData:()=>wait.promise,close:async()=>{closed++}}));await new Promise(r=>setImmediate(r));ctrl.abort();await assert.rejects(pending);wait.resolve({...decoded(),getChannelData:()=>{inspected++;return new Float32Array(44100)}});await new Promise(r=>setImmediate(r));assert.equal(inspected,0);assert.equal(closed,2);
});
test('15s decoder timeout returns even if native close never resolves',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let close=0;const pending=prepareAssessmentWav(input,new AbortController().signal,()=>({decodeAudioData:()=>new Promise(()=>{}),close:()=>{close++;return new Promise(()=>{})}}));await Promise.resolve();t.mock.timers.tick(15000);await assert.rejects(pending);assert.equal(close,1);
});
test('explicit consent and current reference required; review envelope contains no owner/history or score',async()=>{
 const wav=await encodeAssessmentWav(decoded(16000),new AbortController().signal);await assert.rejects(buildAssessmentEnvelope(wav,'reference','r1',false,new AbortController().signal));await assert.rejects(buildAssessmentEnvelope(wav,' ','r1',true,new AbortController().signal));const body=await buildAssessmentEnvelope(wav,'reference','r1',true,new AbortController().signal);assert.deepEqual(Object.keys(body).sort(),['audioBase64','audioMime','consent','language','referenceText','requestId']);assert.equal(body.consent.requestId,body.requestId);assert.equal(body.consent.policyVersion,'azure-ja-accuracy-fluency-v1');assert.equal(Buffer.from(body.audioBase64,'base64').length,wav.size);
});
