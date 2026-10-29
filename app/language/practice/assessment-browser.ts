import {buildAssessmentEnvelope,AZURE_AUDIO_POLICY_VERSION} from './assessment-audio.ts';
import {validateAssessmentResult,type AssessmentResult,type AssessmentPolicy} from './assessment.ts';
import {validateAssessmentTrial} from './assessment-trial.ts';
import {parseRetentionDisclosure,verifyRetentionDisclosure,type RetentionDisclosure} from './assessment-retention.ts';
export type AssessmentHttp = (path:string,init:RequestInit,owner:string,signal:AbortSignal)=>Promise<Response>;
const policy:AssessmentPolicy={providerId:'azure-speech',version:AZURE_AUDIO_POLICY_VERSION,language:'ja-JP',mimeTypes:['audio/wav'],metrics:['accuracy','fluency']};

async function authorizedRequest(path:string,init:RequestInit,owner:string,signal:AbortSignal){
 signal.throwIfAborted();const {createClient}=await import('../../../lib/supabase');signal.throwIfAborted();
 const {data:{session},error}=await createClient().auth.getSession();signal.throwIfAborted();
 if(error||!session?.access_token||session.user.id!==owner)throw Error('Assessment login changed');
 const headers=new Headers(init.headers);headers.set('Authorization',`Bearer ${session.access_token}`);
 return fetch(path,{...init,headers,signal,credentials:'same-origin',cache:'no-store'});
}
async function json(response:Response,signal:AbortSignal){
 const reader=response.body?.getReader();if(!reader)throw Error('No response');let length=0;const chunks:Uint8Array[]=[];
 const cancel=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true});
 try{while(true){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done)break;length+=part.value.length;if(length>8192)throw Error('Response too large');chunks.push(part.value)}const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}
 finally{signal.removeEventListener('abort',cancel);cancel();reader.releaseLock()}
}

/** One account/component lifetime. No automatic request, retry, storage or score. */
export class AssessmentBrowserClient{
 private available=false;private pending:AbortController|null=null;private disposed=false;private used=new Set<string>();
 constructor(privateOwner:string,privateRequest:AssessmentHttp=authorizedRequest){this.owner=privateOwner;this.request=privateRequest;}
 private owner:string;private request:AssessmentHttp;
 private disclosure:RetentionDisclosure|null=null;
 retentionPolicy(){return this.disclosure;}
 cancel(){this.pending?.abort();this.pending=null;this.available=false;this.disclosure=null;}
 dispose(){this.cancel();this.disposed=true;this.used.clear();}
 private async run<T>(signal:AbortSignal,action:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  if(this.disposed||!this.owner||this.pending)throw Error('Assessment unavailable');signal.throwIfAborted();
  const job=new AbortController();this.pending=job;const cancel=()=>job.abort();signal.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,30000);let abort:()=>void=()=>{};const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(new Error('Assessment interrupted'));job.signal.addEventListener('abort',abort,{once:true})});
  try{const result=await Promise.race([action(job.signal),cancelled]);job.signal.throwIfAborted();if(this.disposed||this.pending!==job)throw Error('Assessment stale');return result;}
  finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);job.signal.removeEventListener('abort',abort);if(this.pending===job)this.pending=null;job.abort();}
 }
 async check(signal:AbortSignal):Promise<boolean>{
  this.available=false;this.disclosure=null;
  return this.run(signal,async job=>{
   const response=await this.request('/api/language/assessment',{method:'GET'},this.owner,job);job.throwIfAborted();
   if(!response.ok){void response.body?.cancel().catch(()=>{});return false}
   const data=await json(response,job);job.throwIfAborted();
   const ready=!!data&&typeof data==='object'&&!Array.isArray(data)&&Object.keys(data).sort().join(',')==='available,policyVersion,providerId,region,retention'&&(data as Record<string,unknown>).available===true&&(data as Record<string,unknown>).providerId==='azure-speech'&&(data as Record<string,unknown>).policyVersion===policy.version&&(data as Record<string,unknown>).region==='koreacentral';
   let disclosure:RetentionDisclosure|null=null;
   if(ready){try{disclosure=await verifyRetentionDisclosure((data as Record<string,unknown>).retention);}catch{return false;}}
   job.throwIfAborted();if(this.disposed||this.pending?.signal!==job)throw Error('Assessment stale');this.available=!!disclosure;this.disclosure=disclosure;return this.available;
  });
 }
 async assess(wav:Blob,text:string,requestId:string,consent:boolean,signal:AbortSignal):Promise<AssessmentResult>{
  if(!this.available||!this.disclosure||!consent||this.used.has(requestId)||this.used.size>=100)throw Error('Assessment not ready');
  const retention=parseRetentionDisclosure(this.disclosure);
  return this.run(signal,async job=>{
   // Reject out-of-scope recordings locally, before serialization or any audio POST.
   await validateAssessmentTrial(wav,text,job);job.throwIfAborted();
   const body=await buildAssessmentEnvelope(wav,text,requestId,consent,job,retention);job.throwIfAborted();parseRetentionDisclosure(retention);
   this.used.add(requestId);
   const response=await this.request('/api/language/assessment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},this.owner,job);job.throwIfAborted();
   if(!response.ok){this.available=false;void response.body?.cancel().catch(()=>{});throw Error('Assessment result unconfirmed')}
   const raw=await json(response,job);job.throwIfAborted();
   const result=validateAssessmentResult(raw,{requestId,language:'ja-JP',referenceText:text,audio:wav,durationMs:1},policy);
   if(result.metrics.length!==2)throw Error('Assessment scores missing');
   // The fixed Azure v1 endpoint returns both scores on a 0–100 scale.
   // Generic adapters may use other scales, but this client must not relabel one.
   if(result.metrics.some(metric=>metric.min!==0||metric.max!==100))throw Error('Assessment score range invalid');
   return result;
  });
 }
}
