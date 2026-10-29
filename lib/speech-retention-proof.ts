// V2 retention proof candidate, source-wired but not deployed. No env/key lookup, persistence or transport.
// Review digests bind tested policy contents; supplying a digest is NOT approval.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {retentionPolicyMessage,type RetentionDescriptor} from '../app/language/practice/assessment-retention.ts';

export const SPEECH_RETENTION_PROOF_VERSION='yeoni-speech-retention-proof-v2';
export const SPEECH_RETENTION_PROOF_POLICY='trial-retention-policy-v2';
export const SPEECH_RETENTION_PROOF_SECONDS=30;
export type SpeechRetentionProofInput=Readonly<{
  action:'ready'|'consume'|'finish';keyId:string;owner:string;requestId:string;payloadHash:string;policyHash:string;
}>;
export type SpeechRetentionProof=SpeechRetentionProofInput&Readonly<{
  version:typeof SPEECH_RETENTION_PROOF_VERSION;policy:typeof SPEECH_RETENTION_PROOF_POLICY;issuedAt:number;expiresAt:number;mac:string;
}>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest=/^[0-9a-f]{64}$/;
function inputValid(input:SpeechRetentionProofInput){
  return !!input&&typeof input==='object'&&typeof input.action==='string'&&typeof input.keyId==='string'&&typeof input.owner==='string'&&typeof input.requestId==='string'&&typeof input.payloadHash==='string'&&typeof input.policyHash==='string'&&['ready','consume','finish'].includes(input.action)&&/^[a-z0-9_-]{1,40}$/.test(input.keyId)&&uuid.test(input.owner)&&uuid.test(input.requestId)&&digest.test(input.payloadHash)&&digest.test(input.policyHash);
}
function keyValid(key:Uint8Array){return key instanceof Uint8Array&&key.byteLength>=32&&key.byteLength<=64;}
function timestamp(value:number){return Number.isSafeInteger(value)&&value>=0;}
/** Every field is restricted to newline-free ASCII; numbers are canonical decimal integers. */
function message(proof:Omit<SpeechRetentionProof,'mac'>){
  return [proof.version,proof.keyId,proof.action,proof.owner,proof.requestId,proof.payloadHash,String(proof.issuedAt),String(proof.expiresAt),proof.policy,proof.policyHash].join('\n');
}
export function createSpeechRetentionProof(input:SpeechRetentionProofInput,key:Uint8Array,now:()=>number=Date.now):SpeechRetentionProof{
  if(!inputValid(input)||!keyValid(key))throw Error('Speech proof unavailable');
  const issuedAt=Math.floor(now()/1000);
  if(!timestamp(issuedAt)||!timestamp(issuedAt+SPEECH_RETENTION_PROOF_SECONDS))throw Error('Speech proof unavailable');
  const proof={action:input.action,keyId:input.keyId,owner:input.owner,requestId:input.requestId,payloadHash:input.payloadHash,policyHash:input.policyHash,version:SPEECH_RETENTION_PROOF_VERSION,policy:SPEECH_RETENTION_PROOF_POLICY,issuedAt,expiresAt:issuedAt+SPEECH_RETENTION_PROOF_SECONDS} as const;
  return {...proof,mac:createHmac('sha256',key).update(message(proof),'utf8').digest('hex')};
}
/** Authentication only: the consuming RPC must recompute payloadHash from ALL typed
 * arguments and atomically reject replay using the durable trial ledger. This function
 * intentionally neither reserves quota nor promises a one-time/physical request stop.
 */
export function verifySpeechRetentionProof(value:unknown,expected:SpeechRetentionProofInput,key:Uint8Array,now:()=>number=Date.now):value is SpeechRetentionProof{
  if(!value||typeof value!=='object'||Array.isArray(value)||!keyValid(key)||!inputValid(expected))return false;
  const proof=value as SpeechRetentionProof;
  const fields=['action','keyId','owner','requestId','payloadHash','policyHash','version','policy','issuedAt','expiresAt','mac'];
  if(Object.keys(proof).length!==fields.length||!fields.every(k=>Object.hasOwn(proof,k))||!inputValid(proof)||proof.version!==SPEECH_RETENTION_PROOF_VERSION||proof.policy!==SPEECH_RETENTION_PROOF_POLICY||typeof proof.mac!=='string'||!digest.test(proof.mac)||!timestamp(proof.issuedAt)||!timestamp(proof.expiresAt))return false;
  const seconds=Math.floor(now()/1000);if(!timestamp(seconds)||proof.issuedAt>seconds||proof.expiresAt<=seconds||proof.expiresAt<=proof.issuedAt||proof.expiresAt-proof.issuedAt>SPEECH_RETENTION_PROOF_SECONDS)return false;
  if(proof.action!==expected.action||proof.keyId!==expected.keyId||proof.owner!==expected.owner||proof.requestId!==expected.requestId||proof.payloadHash!==expected.payloadHash||proof.policyHash!==expected.policyHash)return false;
  return timingSafeEqual(createHmac('sha256',key).update(message(proof),'utf8').digest(),Buffer.from(proof.mac,'hex'));
}

/** Canonical policy descriptor. 30 seconds is the existing handler deadline,
 * not a retention recommendation. The actual duration/deletion SLA is UNDECIDED.
 * reviewArtifactSHA256 must identify reviewed source + deletion/operations evidence;
 * this pure helper cannot establish that such review or deployment happened. */
export function speechRetentionPolicyHash(policy:RetentionDescriptor):string{
 return createHash('sha256').update(retentionPolicyMessage(policy),'utf8').digest('hex');
}
