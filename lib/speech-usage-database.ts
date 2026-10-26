// Server-only. Importing/constructing this adapter never connects; only an explicit query does.
import postgres from 'postgres';
import {createHash,X509Certificate} from 'node:crypto';

type Env=Readonly<Record<string,string|undefined>>;
type Rows=readonly {result:unknown}[];
export type SpeechDatabaseDriver={unsafe(text:string,values:(string|number)[],options:{prepare:false}):PromiseLike<Rows>;end(options:{timeout:number}):Promise<void>};
export type SpeechDatabaseOptions=postgres.Options<Record<string,never>>&{max_pipeline:number};
export type SpeechDatabaseFactory=(options:SpeechDatabaseOptions)=>SpeechDatabaseDriver;
export type SpeechDatabasePool={driver?:SpeechDatabaseDriver;signature?:string;busy:boolean;retiring:boolean};
export const createSpeechDatabasePool=():SpeechDatabasePool=>({busy:false,retiring:false});
const shared=createSpeechDatabasePool();
const project='https://piqqukiiacncfbztktga.supabase.co';
const username='yeoni_speech_usage_login.piqqukiiacncfbztktga';
const statements:Record<string,{text:string;keys:string[]}>= {
 is_yeoni_speech_usage_ready:{text:'select yeoni_speech_usage.ready($1::uuid,$2::text,$3::text) as result',keys:['p_owner_id','p_resource_name','p_region']},
 consume_yeoni_speech_usage:{text:'select yeoni_speech_usage.consume($1::uuid,$2::text,$3::text,$4::integer,$5::text,$6::text,$7::text) as result',keys:['p_owner_id','p_request_id','p_fingerprint','p_duration_ms','p_resource_name','p_region','p_lease_token']},
 finish_yeoni_speech_usage:{text:'select yeoni_speech_usage.finish($1::uuid,$2::text,$3::text) as result',keys:['p_owner_id','p_request_id','p_lease_token']},
};
function configuration(env:Env,now:number){
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!=='agent/fitness-record-priority'||env.NEXT_PUBLIC_SUPABASE_URL!==project)throw Error('Usage database unavailable');
 const value=env.YEONI_SPEECH_USAGE_DATABASE_URL,host=env.YEONI_SPEECH_USAGE_POOLER_HOST,ca=env.YEONI_SPEECH_USAGE_CA_CERT;
 if(!value||value.length>4096||!host||!/^aws-\d+-ap-northeast-2\.pooler\.supabase\.com$/.test(host)||!ca||ca.length>16384)throw Error('Usage database unavailable');
 let url:URL;try{url=new URL(value);}catch{throw Error('Usage database unavailable');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!==host||url.port!=='6543'||url.pathname!=='/postgres'||url.search||url.hash||decodeURIComponent(url.username)!==username||!url.password)throw Error('Usage database unavailable');
 const password=decodeURIComponent(url.password);if(password.length<16||password.length>512||/[\0\r\n]/.test(password))throw Error('Usage database unavailable');
 const certificate=new X509Certificate(ca);
 if(!certificate.ca||Date.parse(certificate.validFrom)>now||Date.parse(certificate.validTo)<=now)throw Error('Usage database unavailable');
 const options:SpeechDatabaseOptions={host,port:6543,database:'postgres',username,password,ssl:{rejectUnauthorized:true,servername:host,ca},max:1,max_pipeline:1,prepare:false,connect_timeout:5,idle_timeout:20,max_lifetime:300,fetch_types:false,debug:false,onnotice:()=>{},connection:{application_name:'yeoni-speech-trial',statement_timeout:5000,lock_timeout:2000,idle_in_transaction_session_timeout:5000}};
 return{options,signature:createHash('sha256').update(value).update('\0').update(ca).digest('hex')};
}
const factory:SpeechDatabaseFactory=options=>{
 const sql=postgres(options);
 return{unsafe:async(text,values,queryOptions)=>await sql.unsafe<{result:unknown}[]>(text,values,queryOptions),end:options=>sql.end(options)};
};

export function createSpeechUsageDatabaseClient(env:Env,dependencies:{pool?:SpeechDatabasePool;factory?:SpeechDatabaseFactory;now?:()=>number}={}){
 const pool=dependencies.pool??shared,create=dependencies.factory??factory,now=dependencies.now??Date.now;
 configuration(env,now()); // Missing settings fail before authentication or lazy connection creation.
 return{rpc(name:string,params:Record<string,string|number>){
  let signal:AbortSignal|undefined,promise:Promise<{data:unknown;error:unknown}>|undefined;
  const run=async()=>{
   let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
   let actual:Promise<Rows>|undefined,driver:SpeechDatabaseDriver|undefined;
   const retire=()=>{if(!driver||pool.retiring)return;pool.retiring=true;
    // Do not call query.cancel(): Postgres.js documents a race with the next query.
    // Only this adapter owns this one-job pool. Keep it unavailable until BOTH work
    // and end settle; neither cancellation nor disconnect proves DB rollback.
    let closing:Promise<void>;try{closing=Promise.resolve(driver.end({timeout:1}));}catch{closing=Promise.reject(Error('close failed'));}
    void Promise.allSettled([actual??Promise.resolve(),closing]).then(results=>{
     if(results[1].status==='fulfilled'&&pool.driver===driver){pool.driver=undefined;pool.signature=undefined;pool.busy=false;pool.retiring=false;}
    });
   };
   try{
    if(!signal)throw Error();signal.throwIfAborted();const cfg=configuration(env,now()),statement=statements[name];
    if(!statement||Object.keys(params).length!==statement.keys.length||!statement.keys.every(k=>Object.hasOwn(params,k)))throw Error();
    if(pool.busy||pool.retiring)throw Error();
    if(pool.driver&&pool.signature!==cfg.signature){driver=pool.driver;retire();throw Error();}
    if(!pool.driver){pool.driver=create(cfg.options);pool.signature=cfg.signature;}
    driver=pool.driver;pool.busy=true;
    // Fixed SQL only; caller values are parameters, never concatenated identifiers.
    actual=Promise.resolve(driver.unsafe(statement.text,statement.keys.map(key=>params[key]),{prepare:false}));
    const stopped=new Promise<never>((_,reject)=>{abort=()=>{retire();reject(Error('interrupted'));};signal!.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,5000);if(signal!.aborted)abort();});
    const rows=await Promise.race([actual,stopped]);signal.throwIfAborted();
    if(!Array.isArray(rows)||rows.length!==1||!Object.hasOwn(rows[0],'result'))throw Error();
    const data=rows[0].result;
    if(name==='consume_yeoni_speech_usage'?!['accepted','duplicate','limit','busy'].includes(data as string):typeof data!=='boolean')throw Error();
    return{data,error:null};
   }catch{if(driver)retire();return{data:null,error:{message:'Usage database unavailable'}};}
   finally{if(timer)clearTimeout(timer);if(abort&&signal)signal.removeEventListener('abort',abort);if(driver&&!pool.retiring)pool.busy=false;}
  };
  const query={abortSignal(value:AbortSignal){signal=value;return query;},then<TResult1={data:unknown;error:unknown},TResult2=never>(resolve?:((v:{data:unknown;error:unknown})=>TResult1|PromiseLike<TResult1>)|null,reject?:((e:unknown)=>TResult2|PromiseLike<TResult2>)|null){promise??=run();return promise.then(resolve,reject);}};
  return query;
 }};
}
