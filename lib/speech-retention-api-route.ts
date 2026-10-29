// Actual Next route candidate: no V1 fallback. Missing TTL/cleanup/review values fail closed.
import {Buffer} from 'node:buffer';
import {createAzureAssessmentHandler,type AzureAssessmentEnvironment} from './azure-pronunciation-server.ts';
import {createSpeechRetentionUsageLedger} from './speech-retention-usage.ts';
import type {SpeechApiClient} from './speech-api-usage.ts';
import {parseRetentionDescriptor,parseRetentionDisclosure,UNCONFIGURED_RETENTION} from '../app/language/practice/assessment-retention.ts';
import {speechRetentionPolicyHash} from './speech-retention-proof.ts';
type AuthClient=SpeechApiClient&{auth:{getUser():PromiseLike<{data:{user:{id:string}|null};error:unknown}>}};
export function readSpeechRetentionApiConfig(env:AzureAssessmentEnvironment){
 const unavailable=()=>{throw Error('Speech API unavailable');};
 if(env.YEONI_SPEECH_API_BOUNDARY_REVIEWED!=='trial-retention-api-boundary-v2'||env.YEONI_SPEECH_API_SCHEMA!=='yeoni_speech_retention_candidate'||env.NEXT_PUBLIC_SUPABASE_URL!=='https://piqqukiiacncfbztktga.supabase.co')unavailable();
 let policy=UNCONFIGURED_RETENTION;
 try{const raw=env.YEONI_SPEECH_RETENTION_POLICY_JSON;if(!raw||raw.length>4096)unavailable();policy=parseRetentionDescriptor(JSON.parse(raw!));}catch{unavailable();}
 if(!policy)unavailable();
 const retention=parseRetentionDisclosure({...policy!,policyHash:speechRetentionPolicyHash(policy!)});
 const publicKey=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||env.NEXT_PUBLIC_SUPABASE_ANON_KEY||'';
 if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey)){
  try{const parts=publicKey.split('.');if(parts.length!==3||JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')).role!=='anon')unavailable();}catch{unavailable();}
 }
 const keyId=env.YEONI_SPEECH_PROOF_KEY_ID||'',encoded=env.YEONI_SPEECH_PROOF_KEY_BASE64||'';
 if(!/^[a-z0-9_-]{1,40}$/.test(keyId)||encoded.length>88||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))unavailable();
 const key=Buffer.from(encoded,'base64');if(key.toString('base64')!==encoded||key.length<32||key.length>64){key.fill(0);unavailable();}
 return{keyId,key,boundaryReviewed:true,policy:policy!,retention};
}
/** Per-request client uses the existing caller JWT (never service_role). Config
 * review attestation is not evidence of live settings; missing values fail closed.
 * No retries, cookie/session persistence changes, or direct DB fallback.
 */
export function createSpeechRetentionApiAssessmentRoute(deps:Readonly<{env:AzureAssessmentEnvironment;createClient:()=>Promise<AuthClient>;request:typeof fetch}>){
 return async(request:Request)=>{
  let config:ReturnType<typeof readSpeechRetentionApiConfig>;
  try{config=readSpeechRetentionApiConfig(deps.env);}catch{return Response.json({code:'unavailable',error:'발음 채점은 아직 준비 중이에요. 음성을 보내지 않았어요.'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
  let client:AuthClient|undefined;
  try{return await createAzureAssessmentHandler({env:deps.env,retention:config.retention,
   usageForOwner:owner=>{if(!client)throw Error('Speech API unavailable');return createSpeechRetentionUsageLedger(owner,client,config);},
   authenticate:async signal=>{signal.throwIfAborted();client??=await deps.createClient();signal.throwIfAborted();const result=await client.auth.getUser();signal.throwIfAborted();return result.error?null:result.data.user?.id??null;},request:deps.request,
  })(request);}finally{config.key.fill(0);}
 };
}
