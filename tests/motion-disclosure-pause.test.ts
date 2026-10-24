import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../hooks/useMotionDisclosurePause.ts',import.meta.url),'utf8');
class Detail extends EventTarget { open=true; parentElement: Detail | null=null; }
function fixture(){
 const outer=new Detail(),inner=new Detail();inner.parentElement=outer;
 const values:boolean[]=[];let cleanup=()=>{};
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{exports,require:()=>({useEffect:(effect:()=>()=>void)=>{cleanup=effect();}}),HTMLDetailsElement:Detail});
 (exports.useMotionDisclosurePause as (ref:unknown,set:(v:boolean)=>void)=>void)({current:{parentElement:inner}},v=>values.push(v));
 return{inner,outer,values,cleanup};
}
test('actual hook pauses for either enclosing disclosure and does not resume on open',()=>{const f=fixture();f.inner.open=false;f.inner.dispatchEvent(new Event('toggle'));assert.deepEqual(f.values,[false]);f.inner.open=true;f.inner.dispatchEvent(new Event('toggle'));assert.deepEqual(f.values,[false]);f.outer.open=false;f.outer.dispatchEvent(new Event('toggle'));assert.deepEqual(f.values,[false,false]);});
test('actual hook removes both listeners on cleanup',()=>{const f=fixture();f.cleanup();f.inner.open=false;f.outer.open=false;f.inner.dispatchEvent(new Event('toggle'));f.outer.dispatchEvent(new Event('toggle'));assert.deepEqual(f.values,[]);});
