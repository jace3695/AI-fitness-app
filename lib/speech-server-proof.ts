// Local protocol candidate. No env/key lookup, key generation, persistence or transport.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';

export const SPEECH_PROOF_VERSION='yeoni-speech-proof-v1';
export const SPEECH_PROOF_POLICY='trial-metadata-policy-v1';
export const SPEECH_PROOF_SECONDS=30;
export type SpeechProofInput=Readonly<{
  action:'ready'|'consume'|'finish';keyId:string;owner:string;requestId:string;payloadHash:string;
}>;
export type SpeechServerProof=SpeechProofInput&Readonly<{
  version:typeof SPEECH_PROOF_VERSION;policy:typeof SPEECH_PROOF_POLICY;issuedAt:number;expiresAt:number;mac:string;
}>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest=/^[0-9a-f]{64}$/;
function inputValid(input:SpeechProofInput){
  return !!input&&typeof input==='object'&&typeof input.action==='string'&&typeof input.keyId==='string'&&typeof input.owner==='string'&&typeof input.requestId==='string'&&typeof input.payloadHash==='string'&&['ready','consume','finish'].includes(input.action)&&/^[a-z0-9_-]{1,40}$/.test(input.keyId)&&uuid.test(input.owner)&&uuid.test(input.requestId)&&digest.test(input.payloadHash);
}
function keyValid(key:Uint8Array){return key instanceof Uint8Array&&key.byteLength>=32&&key.byteLength<=64;}
function timestamp(value:number){return Number.isSafeInteger(value)&&value>=0;}
/** Every field is restricted to newline-free ASCII; numbers are canonical decimal integers. */
function message(proof:Omit<SpeechServerProof,'mac'>){
  return [proof.version,proof.keyId,proof.action,proof.owner,proof.requestId,proof.payloadHash,String(proof.issuedAt),String(proof.expiresAt),proof.policy].join('\n');
}
export function createSpeechServerProof(input:SpeechProofInput,key:Uint8Array,now:()=>number=Date.now):SpeechServerProof{
  if(!inputValid(input)||!keyValid(key))throw Error('Speech proof unavailable');
  const issuedAt=Math.floor(now()/1000);
  if(!timestamp(issuedAt)||!timestamp(issuedAt+SPEECH_PROOF_SECONDS))throw Error('Speech proof unavailable');
  const proof={action:input.action,keyId:input.keyId,owner:input.owner,requestId:input.requestId,payloadHash:input.payloadHash,version:SPEECH_PROOF_VERSION,policy:SPEECH_PROOF_POLICY,issuedAt,expiresAt:issuedAt+SPEECH_PROOF_SECONDS} as const;
  return {...proof,mac:createHmac('sha256',key).update(message(proof),'utf8').digest('hex')};
}
/** Authentication only: the consuming RPC must recompute payloadHash from ALL typed
 * arguments and atomically reject replay using the durable trial ledger. This function
 * intentionally neither reserves quota nor promises a one-time/physical request stop.
 */
export function verifySpeechServerProof(value:unknown,expected:SpeechProofInput,key:Uint8Array,now:()=>number=Date.now):value is SpeechServerProof{
  if(!value||typeof value!=='object'||Array.isArray(value)||!keyValid(key)||!inputValid(expected))return false;
  const proof=value as SpeechServerProof;
  const fields=['action','keyId','owner','requestId','payloadHash','version','policy','issuedAt','expiresAt','mac'];
  if(Object.keys(proof).length!==fields.length||!fields.every(k=>Object.hasOwn(proof,k))||!inputValid(proof)||proof.version!==SPEECH_PROOF_VERSION||proof.policy!==SPEECH_PROOF_POLICY||typeof proof.mac!=='string'||!digest.test(proof.mac)||!timestamp(proof.issuedAt)||!timestamp(proof.expiresAt))return false;
  const seconds=Math.floor(now()/1000);if(!timestamp(seconds)||proof.issuedAt>seconds||proof.expiresAt<=seconds||proof.expiresAt<=proof.issuedAt||proof.expiresAt-proof.issuedAt>SPEECH_PROOF_SECONDS)return false;
  if(proof.action!==expected.action||proof.keyId!==expected.keyId||proof.owner!==expected.owner||proof.requestId!==expected.requestId||proof.payloadHash!==expected.payloadHash)return false;
  return timingSafeEqual(createHmac('sha256',key).update(message(proof),'utf8').digest(),Buffer.from(proof.mac,'hex'));
}
