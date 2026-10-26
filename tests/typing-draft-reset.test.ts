import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../app/growth/typing/page.tsx',import.meta.url),'utf8');
const file=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let reset='';function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='reset'&&node.initializer)reset=node.initializer.getText(file);ts.forEachChild(node,visit);}visit(file);assert.ok(reset);
function run(options:{typed?:string;saved?:boolean;saving?:boolean;pending?:boolean;accept?:boolean}={}){
 const changes:unknown[]=[],prompts:string[]=[];const context={passageIndex:0,typed:options.typed??'synthetic draft',saved:options.saved??false,saving:options.saving??false,pending:{current:options.pending?{id:'synthetic'}:null},window:{confirm:(message:string)=>{prompts.push(message);return options.accept??false;}},setPassageIndex:(v:unknown)=>changes.push(['passage',v]),setTyped:(v:unknown)=>changes.push(['typed',v]),setStartedAt:(v:unknown)=>changes.push(['started',v]),setSaved:(v:unknown)=>changes.push(['saved',v]),setLocked:(v:unknown)=>changes.push(['locked',v]),growth:{setNotice:(v:unknown)=>changes.push(['notice',v])}};
 vm.runInNewContext(`(${reset})(1)`,context);return{changes,prompts,pending:context.pending.current};
}
test('actual reset handler preserves all draft/passage/timing/notice state when confirmation is cancelled',()=>{const r=run();assert.equal(r.prompts.length,1);assert.deepEqual(r.changes,[]);});
test('actual reset handler clears only after acceptance; empty/saved input needs no warning; pending save cannot be discarded',()=>{
 const accepted=run({accept:true});assert.equal(accepted.prompts.length,1);assert.deepEqual(accepted.changes,[['passage',1],['typed',''],['started',null],['saved',false],['locked',false],['notice','']]);
 for(const options of [{typed:''},{saved:true}]){const r=run(options);assert.equal(r.prompts.length,0);assert.equal(r.changes.length,6);}
 for(const options of [{saving:true},{pending:true}]){const r=run({...options,accept:true});assert.equal(r.prompts.length,0);assert.deepEqual(r.changes,[]);if(options.pending)assert.ok(r.pending);}
});
