import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechRetentionScheduledRunner,SPEECH_RETENTION_BEGIN_SQL,SPEECH_RETENTION_FINALIZE_SQL,
  type SpeechRetentionScheduledConfig,type SpeechRetentionScheduledExecute} from './speech-retention-scheduled.ts';

// Synthetic values only: no real retention duration, scheduler or DB installed.
const policyHash='a'.repeat(64),generation='11111111-1111-4111-8111-111111111111',token='22222222-2222-4222-8222-222222222222';
const config:SpeechRetentionScheduledConfig={policyHash,generation,intervalSeconds:10,startDelaySeconds:2,runTimeoutSeconds:3};
const row=(result:unknown)=>[{result}];
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function deferred<T=unknown>(){let resolve!:(v:T)=>void,reject!:(v:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
type Hook=(sql:string,values:readonly(string|number|boolean)[],signal:AbortSignal,good:()=>unknown)=>Promise<unknown>;
function fixture(hook?:Hook,cfg:SpeechRetentionScheduledConfig|null=config){
  let wall=100000,mono=50000,serial=0;
  const calls:{sql:string;values:readonly(string|number|boolean)[];signal:AbortSignal}[]=[];
  const timers=new Map<number,{at:number;callback:()=>void}>();
  const goodBegin=(due=100000)=>row({policyHash,generation,token,dueAtMs:due,deadlineAtMs:Math.min(wall+3000,due+5000),validUntilMs:due+15000,deletedRows:1});
  const execute:SpeechRetentionScheduledExecute=async(sql,values,signal)=>{
    calls.push({sql,values,signal});
    const good=()=>sql===SPEECH_RETENTION_BEGIN_SQL?goodBegin(values[2] as number):row({confirmed:values[4]===true,validUntilMs:values[4]===true?(values[3] as number)+15000:null});
    return hook?hook(sql,values,signal,good):good();
  };
  const deps={execute,clock:()=>({wallTimeMs:wall,monotonicTimeMs:mono}),timers:{
    setTimeout(callback:()=>void,delayMs:number){const id=++serial;timers.set(id,{at:mono+delayMs,callback});return id;},
    clearTimeout(handle:unknown){timers.delete(handle as number);},
  }};
  const runner=createSpeechRetentionScheduledRunner(cfg,deps);
  return{runner,calls,deps,goodBegin,timers:()=>timers.size,
    advance(ms:number,fire=true){wall+=ms;mono+=ms;if(fire)for(const[id,t]of[...timers])if(t.at<=mono){timers.delete(id);t.callback();}},
    jump(w:number,m=0){wall+=w;mono+=m;}};
}

test('null/invalid config or missing dependencies does no timer, driver or environment I/O',async()=>{
  assert.equal(createSpeechRetentionScheduledRunner().snapshot().state,'unconfigured');
  assert.equal((await createSpeechRetentionScheduledRunner(config).tick(100000)).state,'unconfigured');
  for(const patch of [{intervalSeconds:0},{intervalSeconds:0.5},{startDelaySeconds:-1},{runTimeoutSeconds:0},{runTimeoutSeconds:Infinity},{policyHash:'x'},{generation:generation.toUpperCase().replace('1','A')},{intervalSeconds:Number.MAX_SAFE_INTEGER}]){
    const f=fixture(undefined,{...config,...patch});assert.equal((await f.runner.tick(100000)).state,'unconfigured');assert.equal(f.calls.length,0);assert.equal(f.timers(),0);
  }
  const f=fixture(undefined,null);assert.equal((await f.runner.tick(100000)).state,'unconfigured');assert.equal(f.calls.length,0);
});
test('begin alone cannot open health; exact immutable binds then one finalize certify due-bound lease',async()=>{
  const begin=deferred(),final=deferred();
  const f=fixture(async sql=>sql===SPEECH_RETENTION_BEGIN_SQL?begin.promise:final.promise);
  assert.equal(f.calls.length,0);assert.equal(f.timers(),0);
  const pending=f.runner.tick(100000);assert.equal(f.runner.snapshot().healthy,false);assert.equal(f.calls.length,1);
  f.advance(1000);begin.resolve(f.goodBegin());await flush();assert.equal(f.calls.length,2);assert.equal(f.runner.snapshot().healthy,false);
  assert.equal(f.calls[0].sql,SPEECH_RETENTION_BEGIN_SQL);assert.deepEqual(f.calls[0].values,[policyHash,generation,100000]);
  assert.equal(f.calls[1].sql,SPEECH_RETENTION_FINALIZE_SQL);assert.deepEqual(f.calls[1].values,[policyHash,generation,token,100000,true]);
  assert.equal(Object.isFrozen(f.calls[0].values),true);assert.equal(Object.isFrozen(f.calls[1].values),true);
  assert.equal(f.calls[0].signal,f.calls[1].signal);
  f.advance(1000);final.resolve(row({confirmed:true,validUntilMs:115000}));
  const state=await pending;assert.equal(state.healthy,true);assert.equal(state.finalizeOutcome,'confirmed');assert.equal(state.completedAtMs,102000);assert.equal(state.validUntilMs,115000);
  await flush();assert.equal(f.timers(),0);f.advance(12999);assert.equal(f.runner.snapshot().healthy,true);
  f.advance(1);assert.equal(f.runner.snapshot().reason,'expired');assert.equal(f.runner.snapshot().healthy,false);
});
test('null token is a closed begin outcome with no finalize and zero-row purge is valid',async()=>{
  const f=fixture(async()=>row({policyHash,generation,token:null,dueAtMs:100000,deadlineAtMs:null,validUntilMs:null,deletedRows:0}));
  assert.equal((await f.runner.tick(100000)).reason,'begin-rejected');assert.equal(f.calls.length,1);
  const zero=fixture(async(sql,_v,_s,good)=>sql===SPEECH_RETENTION_BEGIN_SQL?row({...((good() as {result:object}[])[0].result),deletedRows:0}):good());
  assert.equal((await zero.runner.tick(100000)).healthy,true);
});
test('original Q covers begin plus finalize; a lost finalize reply is uncertain, not DB rollback',async()=>{
  const final=deferred();let dbCertified=false;
  const f=fixture(async(sql,_v,_s,good)=>{if(sql===SPEECH_RETENTION_BEGIN_SQL){f.advance(2000);return good();}dbCertified=true;return final.promise;});
  const pending=f.runner.tick(100000);await flush();assert.equal(f.calls.length,2);assert.equal(dbCertified,true);
  f.advance(1000);const state=await pending;assert.equal(state.reason,'timeout');assert.equal(state.finalizeOutcome,'unknown');assert.equal(state.healthy,false);
  assert.equal(f.calls[1].signal.aborted,true);f.advance(7000);assert.equal((await f.runner.tick(110000)).state,'busy');assert.equal(f.calls.length,2);
  final.resolve(row({confirmed:true,validUntilMs:115000}));await flush();assert.equal(f.runner.snapshot().healthy,false);assert.equal(f.runner.snapshot().finalizeOutcome,'unknown');
});
test('timeout during non-cooperative begin holds busy and never dispatches finalize after late success',async()=>{
  const begin=deferred();const f=fixture(async()=>begin.promise);const pending=f.runner.tick(100000);
  f.advance(3000);assert.equal((await pending).state,'uncertain');assert.equal(f.calls[0].signal.aborted,true);
  assert.equal((await f.runner.tick(110000)).state,'busy');begin.resolve(f.goodBegin());await flush();assert.equal(f.calls.length,1);assert.equal(f.runner.snapshot().healthy,false);
});
test('delayed timer callback cannot admit completion at Q or a stale DB deadline',async()=>{
  for(const phase of ['begin','finalize']){
    const wait=deferred();const f=fixture(async(sql,_v,_s,good)=>((phase==='begin')===(sql===SPEECH_RETENTION_BEGIN_SQL))?wait.promise:good());
    const pending=f.runner.tick(100000);await flush();f.advance(3000,false);
    wait.resolve(phase==='begin'?f.goodBegin():row({confirmed:true,validUntilMs:115000}));assert.equal((await pending).reason,'timeout');assert.equal(f.runner.snapshot().healthy,false);
    assert.equal(f.calls.length,phase==='begin'?1:2);
  }
  const f=fixture(async(sql,_v,_s,good)=>{if(sql===SPEECH_RETENTION_BEGIN_SQL){f.advance(2000);return row({policyHash,generation,token,dueAtMs:100000,deadlineAtMs:102000,validUntilMs:115000,deletedRows:1});}return good();});
  assert.equal((await f.runner.tick(100000)).reason,'timeout');assert.equal(f.calls.length,1);
});
test('late/missed/irregular/duplicate/out-of-order/early ticks may purge but finalize only false',async()=>{
  for(const [gap,due,reason]of[[2001,100000,'late-start'],[0,100001,'early-tick']]as const){
    const f=fixture();f.advance(gap);const state=await f.runner.tick(due);
    // A deliberately permissive fake DB cannot override the local schedule.
    assert.equal(state.healthy,false);assert.equal(state.reason,reason);assert.equal(f.calls[1].values[4],false);
  }
  for(const[gap,due,reason]of[[10000,100000,'duplicate-tick'],[10000,90000,'out-of-order-tick'],[20000,120000,'missed-tick'],[5000,105000,'irregular-tick']]as const){
    const f=fixture(async(sql,values,_s,good)=>sql===SPEECH_RETENTION_BEGIN_SQL?row({policyHash,generation,token,dueAtMs:values[2],deadlineAtMs:(values[2]as number)+5000,validUntilMs:(values[2]as number)+15000,deletedRows:0}):good());
    assert.equal((await f.runner.tick(100000)).healthy,true);await flush();f.advance(gap);
    const state=await f.runner.tick(due);assert.equal(state.healthy,false);
    if(due<=100000)assert.equal(state.reason,'timeout');else assert.equal(state.reason,reason);
    const last=f.calls.at(-1)!;if(last.sql===SPEECH_RETENTION_FINALIZE_SQL)assert.equal(last.values[4],false);
  }
});
test('busy during begin invalidates healthy bit, busy during finalize cannot unsend DB commit',async()=>{
  const begin=deferred();const f=fixture(async(sql,_v,_s,good)=>sql===SPEECH_RETENTION_BEGIN_SQL?begin.promise:good());
  const p=f.runner.tick(100000);assert.equal((await f.runner.tick(100000)).state,'busy');begin.resolve(f.goodBegin());
  assert.equal((await p).healthy,false);assert.equal(f.calls[1].values[4],false);
  const final=deferred();const g=fixture(async(sql,_v,_s,good)=>sql===SPEECH_RETENTION_FINALIZE_SQL?final.promise:good());
  const q=g.runner.tick(100000);await flush();assert.equal((await g.runner.tick(100000)).state,'busy');
  final.resolve(row({confirmed:true,validUntilMs:115000}));const state=await q;
  assert.equal(state.healthy,false);assert.equal(state.finalizeOutcome,'confirmed');assert.equal(state.validUntilMs,115000);
});
test('degraded runner cannot silently recover or catch up on a later successful tick',async()=>{
  const f=fixture();f.advance(2001);await f.runner.tick(100000);await flush();f.advance(7999);
  const state=await f.runner.tick(110000);assert.equal(state.healthy,false);assert.equal(state.reason,'recovery-required');assert.equal(f.calls.at(-1)!.values[4],false);
});
test('invalid due dispatches nothing, while caller/config mutation cannot rewrite fixed SQL or binds',async()=>{
  for(const due of [NaN,-1,0.5,Infinity,Number.MAX_SAFE_INTEGER]){const f=fixture();assert.equal((await f.runner.tick(due)).reason,'invalid-due');assert.equal(f.calls.length,0);}
  const mutable={...config};const f=fixture(undefined,mutable);mutable.policyHash='x';mutable.generation='x';assert.equal((await f.runner.tick(100000)).healthy,true);
  assert.deepEqual(f.calls[0].values,[policyHash,generation,100000]);
});
test('malformed begin rows/extra fields/accessors/symbols/foreign identities are sanitized with no finalize',async()=>{
  const template={policyHash,generation,token,dueAtMs:100000,deadlineAtMs:103000,validUntilMs:115000,deletedRows:1};
  const bad:unknown[]=[null,[],row(null),[{result:template,owner:'private'}],row({...template,extra:'private'}),row({...template,[Symbol('private')]:true}),
    row({...template,policyHash:'b'.repeat(64)}),row({...template,generation:'33333333-3333-4333-8333-333333333333'}),row({...template,dueAtMs:100001}),
    row({...template,token:'not-uuid'}),row({...template,deletedRows:2}),row({...template,deadlineAtMs:105001}),row({...template,validUntilMs:115001}),
    row({...template,token:null}),row({...template,deadlineAtMs:NaN}),row({...template,validUntilMs:100000}),
    row(Object.defineProperty({...template},'token',{get(){throw Error('private');}}))];
  for(const value of bad){const f=fixture(async()=>value);const state=await f.runner.tick(100000);assert.equal(state.reason,'invalid-begin');assert.equal(f.calls.length,1);assert.equal(JSON.stringify(state).includes('private'),false);}
});
test('malformed finalize or rejected execute never invents confirmation or leaks raw errors',async()=>{
  for(const value of [null,[],row({confirmed:true,validUntilMs:115001}),row({confirmed:false,validUntilMs:115000}),row({confirmed:1,validUntilMs:115000}),row({confirmed:true,validUntilMs:115000,owner:'private'})]){
    const f=fixture(async(sql,_v,_s,good)=>sql===SPEECH_RETENTION_FINALIZE_SQL?value:good());const state=await f.runner.tick(100000);
    assert.equal(state.reason,'invalid-finalize');assert.equal(state.finalizeOutcome,'unknown');assert.equal(JSON.stringify(state).includes('private'),false);
  }
  for(const failPhase of [SPEECH_RETENTION_BEGIN_SQL,SPEECH_RETENTION_FINALIZE_SQL]){
    const f=fixture(async(sql,_v,_s,good)=>{if(sql===failPhase)throw Error('private-driver-detail');return good();});const state=await f.runner.tick(100000);
    assert.equal(state.state,'uncertain');assert.equal(state.reason,failPhase===SPEECH_RETENTION_BEGIN_SQL?'begin-unconfirmed':'finalize-unconfirmed');assert.equal(JSON.stringify(state).includes('private'),false);
  }
});
test('DB denial is not health; a dishonest true reply to healthy=false is unknown not success',async()=>{
  const f=fixture(async(sql,_v,_s,good)=>sql===SPEECH_RETENTION_FINALIZE_SQL?row({confirmed:false,validUntilMs:null}):good());
  const state=await f.runner.tick(100000);assert.equal(state.reason,'finalize-rejected');assert.equal(state.finalizeOutcome,'denied');
  const g=fixture(async(sql,_v,_s,good)=>sql===SPEECH_RETENTION_FINALIZE_SQL?row({confirmed:true,validUntilMs:115000}):good());g.advance(2001);
  assert.equal((await g.runner.tick(100000)).reason,'invalid-finalize');
});
test('clock jump during begin never sends healthy=true; jump after finalize dispatch never restores local health',async()=>{
  for(const[wall,mono]of[[-1000,0],[1000,0],[0,-1000]]as const){
    const begin=deferred();const f=fixture(async(sql,_v,_s,good)=>sql===SPEECH_RETENTION_BEGIN_SQL?begin.promise:good());
    const p=f.runner.tick(100000);f.jump(wall,mono);begin.resolve(row({policyHash,generation,token,dueAtMs:100000,deadlineAtMs:103000,validUntilMs:115000,deletedRows:1}));
    assert.equal((await p).healthy,false);assert.equal(f.calls[1].values[4],false);
  }
  const final=deferred();const f=fixture(async(sql,_v,_s,good)=>sql===SPEECH_RETENTION_FINALIZE_SQL?final.promise:good());const p=f.runner.tick(100000);await flush();
  f.jump(1000);final.resolve(row({confirmed:true,validUntilMs:115000}));const state=await p;assert.equal(state.healthy,false);assert.equal(state.finalizeOutcome,'confirmed');
});
test('dispose resolves wait but cannot claim SQL rollback, and prohibits future work',async()=>{
  const final=deferred();const f=fixture(async(sql,_v,_s,good)=>sql===SPEECH_RETENTION_FINALIZE_SQL?final.promise:good());const p=f.runner.tick(100000);await flush();
  f.runner.dispose();const state=await p;assert.equal(state.state,'disposed');assert.equal(state.finalizeOutcome,'unknown');assert.equal(f.timers(),0);
  final.resolve(row({confirmed:true,validUntilMs:115000}));await flush();assert.equal((await f.runner.tick(110000)).state,'disposed');assert.equal(f.calls.length,2);
});
test('broken clock/timer or synchronous timeout is sanitized before any SQL dispatch',async()=>{
  for(const mode of ['clock','invalid-clock','timer','sync-timeout']){
    let calls=0;const runner=createSpeechRetentionScheduledRunner(config,{
      execute:async()=>{calls++;throw Error('private');},
      clock:()=>{if(mode==='clock')throw Error('private');return{wallTimeMs:100000,monotonicTimeMs:mode==='invalid-clock'?NaN:50000};},
      timers:{setTimeout(callback){if(mode==='timer')throw Error('private');callback();return 1;},clearTimeout(){}},
    });const state=await runner.tick(100000);assert.equal(state.healthy,false);assert.equal(calls,0);assert.equal(JSON.stringify(state).includes('private'),false);
  }
});
test('provider/trial flags and owner/content/score fields are absent from runner and public state',async()=>{
  const f=fixture();const state=await f.runner.tick(100000);assert.equal(state.healthy,true);
  assert.deepEqual(Object.keys(state).sort(),['completedAtMs','dueAtMs','finalizeOutcome','healthy','reason','state','validUntilMs']);
  assert.equal(f.calls.length,2);assert.equal(f.calls.some(v=>v.values.some(x=>typeof x==='string'&&x.includes('private'))),false);
});
