import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as service from '../lib/free-japanese-conversation.ts';
import {getConversation,requestFor} from '../app/language/practice/conversation.ts';
const input={message:'合成',situation:'일상',history:[],freeDataUseAcknowledged:true as const};
const env={GEMINI_FREE_API_KEY:'synthetic-only',GEMINI_FREE_TIER_CONFIRMED:'true'};
const body={candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({reply:'合成',replyReading:'合成',correction:'合成',explanation:'synthetic'})}]}}]};
function route(auth:()=>Promise<unknown>,fetcher:typeof fetch){
 const source=readFileSync(new URL('../app/api/language/practice/route.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports:any={};const deps:Record<string,unknown>={'@/lib/supabase-server':{createServerSupabaseClient:async()=>({auth:{getUser:auth}})},'@/lib/free-japanese-conversation':service};
 vm.runInNewContext('(function(exports,require){'+code+'})',{Response,process:{env},fetch:fetcher})(exports,(name:string)=>{assert.ok(name in deps);return deps[name];});return exports.POST as (r:Request)=>Promise<Response>;
}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const user={data:{user:{id:'synthetic'}},error:null};
test('route: cancellation observed during auth prevents real provider helper dispatch',async()=>{
 const auth=deferred<typeof user>();let calls=0;const controller=new AbortController();
 const run=route(()=>auth.promise,async()=>{calls++;throw Error('unexpected network');});
 const request=new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(input),signal:controller.signal});
 const result=run(request);controller.abort();auth.resolve(user);const response=await result;
 assert.notEqual(response.status,200);assert.equal(calls,0);
});
test('route: cancellation during incoming body reading prevents provider dispatch',async()=>{
 const text=deferred<string>();let calls=0;const controller=new AbortController();const run=route(async()=>user,async()=>{calls++;throw Error('unexpected network');});
 const request=new Request('https://synthetic.invalid',{method:'POST',body:'{}',signal:controller.signal});Object.defineProperty(request,'text',{value:()=>text.promise});
 const result=run(request);await new Promise(r=>setImmediate(r));controller.abort();text.resolve(JSON.stringify(input));
 assert.notEqual((await result).status,200);assert.equal(calls,0);
});
for(const phase of ['fetch','body'] as const)for(const cause of ['client','deadline'] as const){
 test(`provider ${phase}: ${cause} reaches combined signal, one dispatch, no success`,async(t)=>{
  const deadline=new AbortController(),client=new AbortController();let requestedMs=0;let calls=0;let captured:AbortSignal|undefined;
  t.mock.method(AbortSignal,'timeout',(ms:number)=>{requestedMs=ms;return deadline.signal;});
  const wait=(signal:AbortSignal)=>new Promise<never>((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  const pending=service.generateFreeJapanese(input,env,async(_url,init)=>{
   calls++;captured=init!.signal as AbortSignal;
   if(phase==='fetch')return await wait(captured);
   return Object.assign(new Response('{}'),{json:()=>wait(captured!)});
  },client.signal);
  await new Promise(r=>setImmediate(r));assert.equal(requestedMs,18000);assert.equal(captured?.aborted,false);
  const rejected=assert.rejects(pending,e=>e instanceof service.FreeJapaneseError&&e.status===(cause==='deadline'?504:503));
  if(cause==='deadline')deadline.abort(new DOMException('synthetic deadline','TimeoutError'));else client.abort();
  await rejected;assert.equal(captured?.aborted,true);assert.equal(calls,1);
 });
}
test('noncooperative provider body cannot become success after observed cancellation; no termination claim',async()=>{
 const client=new AbortController(),json=deferred<unknown>();let calls=0,settled=false;
 const pending=service.generateFreeJapanese(input,env,async()=>{calls++;return Object.assign(new Response('{}'),{json:()=>json.promise});},client.signal);
 const rejected=assert.rejects(pending,e=>e instanceof service.FreeJapaneseError&&e.status===503).then(()=>{settled=true;});
 await new Promise(r=>setImmediate(r));client.abort();await new Promise(r=>setImmediate(r));assert.equal(settled,false);
 json.resolve(body);await rejected;assert.equal(calls,1);
});
test('client race removes its abort listener on success, failure and cancellation',async()=>{
 for(const outcome of ['success','failure','cancel']){
  const controller=new AbortController();let count=0;const add=controller.signal.addEventListener.bind(controller.signal),remove=controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener=((...args:Parameters<typeof add>)=>{if(args[0]==='abort')count++;return add(...args);}) as typeof add;
  controller.signal.removeEventListener=((...args:Parameters<typeof remove>)=>{if(args[0]==='abort')count--;return remove(...args);}) as typeof remove;
  const pending=getConversation(async()=>{if(outcome==='failure')throw Error('synthetic');if(outcome==='cancel')return new Promise(()=>{});return {source:'ai',reply:'合成',replyReading:'合成',correction:'合成',explanation:'synthetic'};},requestFor([],'일상','合成'),controller.signal);
  if(outcome==='cancel')controller.abort();if(outcome==='success')await pending;else await assert.rejects(pending);assert.equal(count,0);
 }
});
