import test from 'node:test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../app/language/practice/Recorder.tsx',import.meta.url),'utf8');
function fixture(){
 const hooks:unknown[]=[];let cursor=0;const effects:(()=>void|(()=>void))[]=[];const listeners=new Map<string,()=>void>();
 const jobs:{signal:AbortSignal;resolve:(p:unknown)=>void}[]=[];let cleanup:(()=>void)|void; const revoked:string[]=[];
 const React={createElement:()=>null,useId:()=> 'synthetic',useState:(initial:unknown)=>{const i=cursor++;if(!(i in hooks))hooks[i]=initial;return [hooks[i],(v:unknown)=>{hooks[i]=v}]},useRef:(v:unknown)=>{const i=cursor++;if(!(i in hooks))hooks[i]={current:v};return hooks[i]},useEffect:(fn:()=>void|(()=>void))=>effects.push(fn)};
 const context={exports:{},require:(name:string)=> name==='react'?React:name==='./pitch'?{readPitch:(_b:unknown,signal:AbortSignal)=>new Promise(resolve=>jobs.push({signal,resolve}))}:{createSpeechParticipant:()=>({dispose(){},claim(){}})},AbortController,AudioContext:class{},setTimeout,clearTimeout,URL:{revokeObjectURL(url:string){revoked.push(url)}},window:{addEventListener:(n:string,f:()=>void)=>listeners.set(n,f),removeEventListener:(n:string)=>listeners.delete(n)},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},__capture:(x:unknown)=>x};
 // Expose real component closures before JSX; no browser, recording or storage.
 const instrumented=source.replace('  return <section', '  return __capture({showPitch,cancelPitch,clear,start});\n  return <section');
 const compiled=ts.transpileModule(instrumented,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
 vm.runInNewContext(compiled,context);
 const component=(context.exports as {default:(p:{text:string})=>{showPitch:()=>Promise<void>;clear:()=>void;cancelPitch:()=>void}}).default;
 const render=()=>{cursor=0;return component({text:'synthetic'});};
 render();cleanup=effects[0]();hooks[0]=new Blob(['synthetic']);const controls=render();
 return {hooks,jobs,controls,listeners,revoked,cleanup:()=>cleanup?.()};
}
test('duplicate analysis is blocked and late completion after clear or account change is ignored',async()=>{
 for(const boundary of ['clear','account','pagehide','unmount']){
 const f=fixture();const task=f.controls.showPitch();await f.controls.showPitch();assert.equal(f.jobs.length,1);
 if(boundary==='clear')f.controls.clear();else if(boundary==='account')f.listeners.get('yeoni-cloud-session-changed')!();else if(boundary==='pagehide')f.listeners.get('pagehide')!();else f.cleanup();
 assert.equal(f.jobs[0].signal.aborted,true);const before=[...f.hooks];f.jobs[0].resolve([{seconds:.1,hz:220}]);await task;assert.deepEqual(f.hooks,before);if(boundary!=='unmount')assert.equal(f.hooks[0],null);
 }
});
test('cancel and replacement result cannot be overwritten by an earlier analysis',async()=>{
 const f=fixture();const first=f.controls.showPitch();f.controls.cancelPitch();const second=f.controls.showPitch();
 f.jobs[1].resolve([{seconds:.1,hz:300}]);await second;f.jobs[0].resolve([{seconds:.1,hz:100}]);await first;
 assert.equal((f.hooks[1] as {hz:number}[])[0].hz,300);f.cleanup();
});


test('clearing recording releases its URL once and drops derived results and blob',()=>{
 const f=fixture(); const urlRef=f.hooks.find(h=>h && typeof h==='object' && 'current' in h && h.current==='') as {current:string};
 urlRef.current='blob:synthetic'; f.hooks[1]=[{seconds:.1,hz:220}];
 f.controls.clear(); f.controls.clear();
 assert.deepEqual(f.revoked,['blob:synthetic']);assert.equal(f.hooks[0],null);assert.equal(f.hooks[1],null);f.cleanup();
});


test('before recording the rendered page explains pitch observation without offering an unusable analysis action',()=>{
 const require=createRequire(import.meta.url);
 const React=require('react'), {renderToStaticMarkup}=require('react-dom/server');
 const availability={exports:{}};
 const availabilitySource=fs.readFileSync(new URL('../app/language/practice/AssessmentAvailability.tsx',import.meta.url),'utf8');
 const audio={exports:{}};
 const audioSource=fs.readFileSync(new URL('../app/language/practice/assessment-audio.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(audioSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{...audio,require,setTimeout});
 const contract={exports:{}},browser={exports:{}},trial={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/language/practice/assessment.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{...contract,require});
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/language/practice/assessment-trial.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{...trial,require});
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/language/practice/assessment-browser.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{...browser,require:(name:string)=>name==='./assessment-audio.ts'?audio.exports:name==='./assessment.ts'?contract.exports:name==='./assessment-trial.ts'?trial.exports:require(name)});
 vm.runInNewContext(ts.transpileModule(availabilitySource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{...availability,require:(name:string)=>name==='./assessment-audio'?audio.exports:name==='./assessment-browser'?browser.exports:name==='./assessment-trial'?trial.exports:name==='./assessment'?contract.exports:require(name)});
 const context={exports:{},require:(name:string)=>name==='./AssessmentAvailability'?availability.exports:name==='./pitch'?{}:name.startsWith('@/')?{}:require(name)};
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(compiled,context);
 const html=renderToStaticMarkup(React.createElement((context.exports as {default:unknown}).default,{text:'synthetic'}));
 assert.ok(html.includes('녹음 후 내 목소리 높낮이를 볼 수 있어요.'));
 assert.ok(html.includes('일본어 억양의 정답을 채점하는 기능은 아니에요.'));
 assert.ok(html.indexOf('녹음 후 내 목소리') < html.indexOf('내 발음 녹음'));
 assert.ok(!html.includes('>목소리 높낮이 보기</button>'));
 // The same rendered page contains an optional, explicitly consented external assessment.
 assert.ok(html.includes('로컬 녹음과 다시 듣기는 이 화면에서만 처리해요.'));
 assert.ok(html.includes('외부 발음 평가는 별도 승인과 연결 준비를 마친 뒤, 전송 안내에 동의하고 직접 요청할 때만 녹음과 연습 문장을 보내요.'));
 assert.ok(!html.includes('녹음은 전송·저장하지 않으며'));
 assert.ok(!html.includes('발음 평가 서비스는 아직 정하지 않았어요.'));
 assert.ok(html.includes('외부 채점은 연결 준비를 확인하고 아래 안내에 동의한 뒤 직접 요청해야 해요.'));
 assert.ok(html.includes('발음 점수 받기 · 준비 중'));
});
