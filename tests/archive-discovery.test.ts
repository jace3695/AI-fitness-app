import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as schema from '../lib/confirmed-conversation-archive.ts';

// In-memory hook harness: no DOM, browser, sockets or real authentication.
function fixture() {
  const slots: any[] = []; let position=0;
  const effects: (()=>void)[]=[];
  const listeners=new Map<string,()=>void>(); let auth: any;
  const state={calls:0, reply:{entries:[],nextCursor:null} as any, ok:true, delay:null as Promise<any>|null};
  const react={
    useState(initial:any){const i=position++;if(!(i in slots))slots[i]=initial;return [slots[i],(value:any)=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useRef(initial:any){const i=position++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useEffect(fn:()=>any,deps:any[]){const i=position++;if(!slots[i]||deps.some((x,j)=>x!==slots[i].deps[j])){slots[i]?.cleanup?.();effects.push(()=>{slots[i]={deps,cleanup:fn()};});}},
  };
  const exports:any={};
  const code=ts.transpileModule(readFileSync(new URL('../components/ConfirmedConversationArchive.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const deps:Record<string,unknown>={react,'react/jsx-runtime':jsx,'@/lib/confirmed-conversation-archive':schema,
    '@/app/lib/supabase':{supabase:{auth:{getUser:async()=>({data:{user:{id:'A'}},error:null}),onAuthStateChange:(fn:any)=>{auth=fn;return{data:{subscription:{unsubscribe(){}}}};}}}},
    '@/lib/supabase':{authenticatedFetch:async()=>{state.calls++;if(state.delay)return state.delay;return{ok:state.ok,json:async()=>state.reply};}},
  };
  vm.runInNewContext('(function(exports,require){'+code+'})',{AbortController,URLSearchParams,clearTimeout,crypto,window:{setTimeout,addEventListener:(k:string,v:()=>void)=>listeners.set(k,v),removeEventListener:(k:string)=>listeners.delete(k)}})(exports,(name:string)=>{if(!(name in deps))throw Error(name);return deps[name];});
  const render=()=>{position=0;const tree=exports.default({ownerId:'A',kind:'body-dialogue',candidate:null});while(effects.length)effects.shift()!();return tree;};
  return{state,render,switchAccount:()=>auth('SIGNED_IN',{user:{id:'B'}})};
}
function nodes(tree:any):any[]{if(!tree||typeof tree!=='object')return[];return [tree,...[tree.props?.children].flat(Infinity).flatMap(nodes)];}
function label(tree:any):string{if(typeof tree==='string')return tree;if(!tree||typeof tree!=='object')return'';return [tree.props?.children].flat(Infinity).map(label).join('');}
function button(tree:any,name:string){const b=nodes(tree).find(n=>n.type==='button'&&label(n)===name);assert.ok(b,name);return b;}
async function settle(){for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));}

test('assistant archive gate uses ready owner, not a new conversation, and keys account state',()=>{
  const source=readFileSync(new URL('../app/assistant/AssistantClient.tsx',import.meta.url),'utf8');
  const line=source.split('\n').find(l=>l.includes('<ConfirmedConversationArchive'))!;
  assert.match(line,/pending.ready && pending.ownerId/);assert.doesNotMatch(line,/localBodyActive &&/);
  assert.match(line,/key=\{pending.ownerId\}/);assert.match(line,/localBodyCandidate\?\.ownerId === pending.ownerId/);
});
test('fresh mount with no question offers manual loading and cannot save or auto-fetch',()=>{
  const f=fixture(),tree=f.render();
  assert.equal(button(tree,'계정 보관본 불러오기').props.disabled,false);
  assert.equal(button(tree,'선택 내용 계정 보관').props.disabled,true);
  assert.equal(f.state.calls,0);assert.match(label(tree),/새 질문이나 연습 없이/);
});
test('duplicate load clicks issue one request and empty history is explicit',async()=>{
  const f=fixture(),tree=f.render();const load=button(tree,'계정 보관본 불러오기');
  load.props.onClick();load.props.onClick();await settle();
  assert.equal(f.state.calls,1);assert.match(label(f.render()),/보관한 내용이 없습니다/);
});
test('load error is visible and permits a deliberate retry',async()=>{
  const f=fixture();f.state.ok=false;f.state.reply={error:'합성 연결 오류'};
  button(f.render(),'계정 보관본 불러오기').props.onClick();await settle();
  const tree=f.render();assert.match(label(tree),/합성 연결 오류/);assert.equal(button(tree,'계정 보관본 불러오기').props.disabled,false);
});
test('fresh mount can retrieve an existing archive without a question or write',async()=>{
  const f=fixture();f.state.reply={entries:[{id:'00000000-0000-4000-8000-000000000124',created_at:'2026-10-22T00:00:00.000Z',snapshot:{version:1,kind:'body-dialogue',date:'2026-10-22',question:'SAVED_QUESTION',answer:'SAVED_ANSWER'}}],nextCursor:null};
  button(f.render(),'계정 보관본 불러오기').props.onClick();await settle();
  assert.match(label(f.render()),/SAVED_QUESTION/);assert.equal(f.state.calls,1);
  f.switchAccount();assert.doesNotMatch(label(f.render()),/SAVED_QUESTION/);
});
test('account change clears and rejects a late archive response',async()=>{
  const f=fixture();let resolve:any;f.state.delay=new Promise(r=>{resolve=r;});
  button(f.render(),'계정 보관본 불러오기').props.onClick();await settle();f.switchAccount();
  resolve({ok:true,json:async()=>({entries:[{id:'00000000-0000-4000-8000-000000000123',created_at:'2026-10-22T00:00:00.000Z',snapshot:{version:1,kind:'body-dialogue',date:'2026-10-22',question:'PRIVATE_OLD_OWNER',answer:'synthetic'}}],nextCursor:null})});await settle();
  const tree=f.render();assert.doesNotMatch(label(tree),/PRIVATE_OLD_OWNER/);assert.equal(button(tree,'계정 보관본 불러오기').props.disabled,true);
});
