import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../app/assistant/AssistantClient.tsx',import.meta.url),'utf8');
const start=source.indexOf('  const addEntry ='),end=source.indexOf('  const toggleItem =',start);
function deferred(){let resolve!:(v:unknown)=>void,reject!:(e:Error)=>void;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject};}
function fixture(){
 const gate=deferred(),state={title:'synthetic task',saving:false,message:'',writes:[] as unknown[],loads:0,fail:false};
 const context={title:state.title,kind:'task',entryPriority:3,entryDueDate:'2026-10-24',entryProjectId:'',entryRecurrence:'none',pending:{ready:true,ownerId:'A'},localBodyOwner:{current:'A'},chatEpoch:{current:1},entryLock:{current:null as unknown},entryDraftSignature:{current:'original'},setSaving:(v:boolean)=>state.saving=v,setMessage:(v:string)=>state.message=v,setTitle:(v:string)=>state.title=v,setEntryDueDate:()=>{},setEntryProjectId:()=>{},setEntryPriority:()=>{},setEntryRecurrence:()=>{},load:async()=>{state.loads++},supabase:{auth:{getUser:()=>gate.promise},from:()=>({insert:async(v:unknown)=>{state.writes.push(v);if(state.fail)throw Error('synthetic network rejection');return{error:null}}})}};
 const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const handler=vm.runInNewContext(code+';addEntry',context) as(e:{preventDefault():void})=>Promise<void>;
 return{context,state,gate,run:()=>handler({preventDefault(){}})};
}
test('actual manual-entry handler catches a thrown save and releases saving state',async()=>{const f=fixture();f.state.fail=true;const task=f.run();f.gate.resolve({data:{user:{id:'A'}}});await assert.doesNotReject(task);assert.equal(f.state.saving,false);assert.equal(f.state.title,'synthetic task');assert.match(f.state.message,/확인하지 못했어요/);});
test('same-turn duplicate submission dispatches only one insert',async()=>{const f=fixture();const a=f.run(),b=f.run();f.gate.resolve({data:{user:{id:'A'}}});await Promise.all([a,b]);assert.equal(f.state.writes.length,1);});
test('auth owner mismatch stops before insert',async()=>{const f=fixture();const task=f.run();f.gate.resolve({data:{user:{id:'B'}}});await task;assert.equal(f.state.writes.length,0);assert.equal(f.state.title,'synthetic task');});
test('A-B-A generation boundary ignores old completion and draft clearing',async()=>{const f=fixture();const task=f.run();f.context.chatEpoch.current+=2;f.context.entryLock.current=null;f.state.title='new account draft';f.gate.resolve({data:{user:{id:'A'}}});await task;assert.equal(f.state.writes.length,0);assert.equal(f.state.title,'new account draft');});
test('successful old submission does not clear newer input written during auth',async()=>{const f=fixture();const task=f.run();f.context.entryDraftSignature.current='new draft';f.state.title='new input';f.gate.resolve({data:{user:{id:'A'}}});await task;assert.equal(f.state.writes.length,1);assert.equal(f.state.title,'new input');assert.equal(f.state.loads,1);});
test('authentication rejection preserves input and releases the request lock',async()=>{const f=fixture();const task=f.run();f.gate.reject(Error('synthetic auth rejection'));await assert.doesNotReject(task);assert.equal(f.state.saving,false);assert.equal(f.context.entryLock.current,null);assert.equal(f.state.writes.length,0);assert.equal(f.state.title,'synthetic task');});
test('late insert completion after owner-generation change cannot clear new draft or refresh',async()=>{const f=fixture(),write=deferred();f.context.supabase.from=()=>({insert:async(v:unknown)=>{f.state.writes.push(v);await write.promise;return{error:null}}});const task=f.run();f.gate.resolve({data:{user:{id:'A'}}});await new Promise(r=>setImmediate(r));assert.equal(f.state.writes.length,1);f.context.chatEpoch.current+=2;f.context.entryLock.current=null;f.state.title='other session draft';f.state.message='new session notice';write.resolve(null);await task;assert.equal(f.state.title,'other session draft');assert.equal(f.state.message,'new session notice');assert.equal(f.state.loads,0);});
