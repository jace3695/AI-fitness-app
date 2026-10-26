import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {bodyImportOwner} from '../app/lib/bodyImport.ts';
const source=readFileSync(new URL('../app/components/OaSourceCorrection.tsx',import.meta.url),'utf8');
const file=ts.createSourceFile('component.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let open='';function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='openReview')open=node.getText(file);ts.forEachChild(node,visit);}visit(file);assert.ok(open);
function run(failure:'getter'|'read'|null){
 const record=Object.freeze({muscleMass:50,memo:'synthetic memo'}),before=JSON.stringify(record);let review:unknown='previous',confirmed=true,message='previous',writes=0;
 const storage={getItem:(key:string)=>{if(failure==='read')throw new Error('synthetic sensitive diagnostic');return key==='fitness-cloud-sync-user'?'synthetic-owner':'1';},setItem:()=>{writes++;},removeItem:()=>{writes++;}};
 const context={window:{get localStorage(){if(failure==='getter')throw new Error('synthetic sensitive diagnostic');return storage;}},record,bodyImportOwner,setReview:(v:unknown)=>{review=v;},setConfirmed:(v:boolean)=>{confirmed=v;},setMessage:(v:string)=>{message=v;}};
 vm.runInNewContext(open+';openReview()',context);assert.equal(JSON.stringify(record),before);assert.equal(writes,0);return{review,confirmed,message};
}
test('actual review-entry handler catches storage getter/read denial without raw diagnostics or retained consent',()=>{for(const mode of ['getter','read'] as const){const r=run(mode);assert.equal(r.review,null);assert.equal(r.confirmed,false);assert.ok(r.message);assert.equal(r.message.includes('synthetic sensitive diagnostic'),false);}});
test('actual review-entry handler snapshots only after successful read and starts without consent',()=>{const r=run(null);assert.equal(r.confirmed,false);assert.equal(r.message,'');assert.equal((r.review as {owner:string}).owner,JSON.stringify(['synthetic-owner','1']));assert.equal((r.review as {snapshot:string}).snapshot,JSON.stringify({muscleMass:50,memo:'synthetic memo'}));});
