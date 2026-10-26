// Server-only prototype: callers inject a reviewed, user-JWT Data API client.
// No environment/credential lookup or live route wiring. No service_role client.
import {createHash,randomUUID} from 'node:crypto';
import {createSpeechServerProof,type SpeechProofInput} from './speech-server-proof.ts';
import type {AssessmentUsageLedger} from './azure-pronunciation-server.ts';
type Query=PromiseLike<{data:unknown;error:unknown}>&{abortSignal(signal:AbortSignal):Query};
export type SpeechApiClient={schema(name:string):{rpc(name:string,args:Record<string,string|number>):Query}};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function createSpeechApiUsageLedger(owner:string,client:SpeechApiClient,config:Readonly<{keyId:string;key:Uint8Array;boundaryReviewed:boolean}>):AssessmentUsageLedger{
 const reservations=new Map<string,string>();
 const hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
 async function rpc(action:SpeechProofInput['action'],requestId:string,payloadHash:string,args:Record<string,string|number>,signal:AbortSignal){
  signal.throwIfAborted();
  if(!config.boundaryReviewed||!uuid.test(owner)||!uuid.test(requestId))throw Error('Usage boundary unavailable');
  const proof=createSpeechServerProof({action,keyId:config.keyId,owner,requestId,payloadHash},config.key);
  const result=await client.schema('yeoni_speech_proof_candidate').rpc(action,{...args,p_request_id:requestId,p_issued_at:proof.issuedAt,p_expires_at:proof.expiresAt,p_key_id:proof.keyId,p_mac:proof.mac}).abortSignal(signal);
  signal.throwIfAborted();if(result.error)throw Error('Usage confirmation unavailable');return result.data;
 }
 return {durable:true,isReady:async signal=>(await rpc('ready',randomUUID(),hash('ready'),{},signal))===true,
 consume:async(input,signal)=>{
  signal.throwIfAborted();if(input.owner!==owner||input.resourceName!=='yeoni-speech-jace'||input.region!=='koreacentral'||!Number.isFinite(input.durationMs)||input.durationMs<=0||input.durationMs>5000||! /^[a-f0-9]{64}$/.test(input.fingerprint))return 'limit';
  const duration=Math.ceil(input.durationMs),fingerprint=hash(['trial-v1',String(duration),'こんにちは。',input.fingerprint].join('\n'));
  const result=await rpc('consume',input.requestId,fingerprint,{p_duration:duration,p_text:'こんにちは。',p_audio_hash:input.fingerprint},signal);
  if(!['accepted','duplicate','limit','denied'].includes(result as string))throw Error('Usage confirmation unavailable');
  if(result==='accepted')reservations.set(input.requestId,fingerprint);
  return result==='denied'?'limit':result as 'accepted'|'duplicate'|'limit';
 },settle:async(input,signal)=>{
  signal.throwIfAborted();if(input.owner!==owner)return false;const fingerprint=reservations.get(input.requestId);if(!fingerprint)return false;
  const done=(await rpc('finish',input.requestId,fingerprint,{p_payload_hash:fingerprint},signal))===true;
  if(done)reservations.delete(input.requestId);return done;
 }};
}
