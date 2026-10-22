import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
const source=readFileSync(new URL('../components/AssistantPromptExamples.tsx',import.meta.url),'utf8');
const exports: any={};
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext('(function(exports,require){'+code+'})')(exports,(name:string)=>{assert.equal(name,'react/jsx-runtime');return jsx;});
function nodes(t:any):any[]{if(!t||typeof t!=='object')return [];return [t,...[t.props?.children].flat(Infinity).flatMap(nodes)];}
test('examples start collapsed, keep five choices, and choose text only',()=>{
 const picked:string[]=[];const tree=exports.default({disabled:false,hasDraft:false,onSelect:(s:string)=>picked.push(s)});
 assert.equal(tree.type,'details');assert.equal(tree.props.open,undefined);const buttons=nodes(tree).filter(n=>n.type==='button');assert.equal(buttons.length,5);
 buttons[0].props.onClick();assert.deepEqual(picked,['내 기록을 보고 오늘 할 일을 조언해줘']);assert.ok(buttons.every(b=>b.props.type==='button'));
});
test('busy or existing draft blocks even direct handler calls',()=>{
 for(const props of [{disabled:true,hasDraft:false},{disabled:false,hasDraft:true}]){let calls=0;const tree=exports.default({...props,onSelect:()=>calls++});for(const b of nodes(tree).filter(n=>n.type==='button')){assert.equal(b.props.disabled,true);b.props.onClick();}assert.equal(calls,0);}
});
test('home and assistant integration fills/focuses input instead of sending example',()=>{
 const client=readFileSync(new URL('../app/assistant/AssistantClient.tsx',import.meta.url),'utf8');const line=client.split(/\r?\n/).find(l=>l.includes('<AssistantPromptExamples'))!;
 assert.ok(client.indexOf('<AssistantPromptExamples') > client.indexOf('</form>'));
 assert.ok(client.indexOf('<AssistantPromptExamples') < client.indexOf('<div ref={chatBoxRef}'));
 assert.ok(line);assert.ok(line.includes('setChatInput(sample)'));assert.ok(line.includes("?.focus()"));assert.ok(!line.includes('sendChat('));assert.ok(line.includes('hasDraft={!!chatInput.trim()}'));
 const home=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');assert.ok(home.includes('<AssistantPage />'));
});
