// V2 retention adapter: source-wired through the candidate route; not deployed.
// This module creates no environment lookup, scheduler or service_role client.
// A caller-provided review flag/hash is NOT evidence of deployment authorization.
import {createHash,randomUUID} from 'node:crypto';
import {createSpeechRetentionProof,speechRetentionPolicyHash,type SpeechRetentionProofInput} from './speech-retention-proof.ts';
import type {AssessmentUsageLedger} from './azure-pronunciation-server.ts';
import type {RetentionDescriptor} from '../app/language/practice/assessment-retention.ts';
import type {SpeechApiClient} from './speech-api-usage.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function createSpeechRetentionUsageLedger(owner:string,client:SpeechApiClient,config:Readonly<{keyId:string;key:Uint8Array;boundaryReviewed:boolean;policy:RetentionDescriptor}>):AssessmentUsageLedger{
 const reservations=new Map<string,string>();
 const policyHash=speechRetentionPolicyHash(config.policy);
 const hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
 async function rpc(action:SpeechRetentionProofInput['action'],requestId:string,payloadHash:string,args:Record<string,string|number>,signal:AbortSignal){
  signal.throwIfAborted();
  if(!config.boundaryReviewed||!uuid.test(owner)||!uuid.test(requestId))throw Error('Usage boundary unavailable');
  const proof=createSpeechRetentionProof({action,keyId:config.keyId,owner,requestId,payloadHash,policyHash},config.key);
  const result=await client.schema('yeoni_speech_retention_candidate').rpc(action,{...args,p_policy_hash:policyHash,p_request_id:requestId,p_issued_at:proof.issuedAt,p_expires_at:proof.expiresAt,p_key_id:proof.keyId,p_mac:proof.mac}).abortSignal(signal);
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
