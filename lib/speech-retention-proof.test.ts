import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechRetentionProof,verifySpeechRetentionProof,speechRetentionPolicyHash} from './speech-retention-proof.ts';
import {createSpeechServerProof} from './speech-server-proof.ts';
import {createSpeechRetentionUsageLedger} from './speech-retention-usage.ts';
const key=new Uint8Array(32).fill(7);
// Synthetic policy numbers only; no real duration, review or key is provisioned.
const descriptor={metadataRetentionSeconds:120,authorizationExpiresAt:1000,reviewArtifactSHA256:'a'.repeat(64),cleanupIntervalSeconds:60,cleanupStartDelaySeconds:10,cleanupRunTimeoutSeconds:5};
const input={action:'consume' as const,keyId:'synthetic',owner:'00000000-0000-4000-8000-000000000001',requestId:'00000000-0000-4000-8000-000000000002',payloadHash:'b'.repeat(64),policyHash:speechRetentionPolicyHash(descriptor)};
test('v2 proof binds exact retention descriptor and rejects v1 cross-protocol replay',()=>{
 const proof=createSpeechRetentionProof(input,key,()=>100000);
 assert.equal(verifySpeechRetentionProof(proof,input,key,()=>101000),true);
 assert.equal(verifySpeechRetentionProof(createSpeechServerProof(input,key,()=>100000),input,key,()=>101000),false);
 for(const patch of [{policyHash:'c'.repeat(64)},{policy:'trial-metadata-policy-v1'},{version:'yeoni-speech-proof-v1'},{owner:input.requestId},{action:'finish'},{payloadHash:'c'.repeat(64)},{mac:'c'.repeat(64)},{extra:true}])assert.equal(verifySpeechRetentionProof({...proof,...patch},input,key,()=>101000),false);
 for(const now of [99000,130000])assert.equal(verifySpeechRetentionProof(proof,input,key,()=>now),false);
 assert.equal(verifySpeechRetentionProof(proof,{...input,policyHash:'c'.repeat(64)},key,()=>101000),false);
});
test('retention descriptor has no default and every decision changes its binding',()=>{
 for(const patch of [{metadataRetentionSeconds:121},{authorizationExpiresAt:1001},{reviewArtifactSHA256:'c'.repeat(64)}])assert.notEqual(speechRetentionPolicyHash({...descriptor,...patch}),input.policyHash);
 for(const seconds of [0,1,30,-1,NaN,Infinity,31.1,2147483648])assert.throws(()=>speechRetentionPolicyHash({...descriptor,metadataRetentionSeconds:seconds}),/unavailable/);
 for(const until of [-1,NaN,Infinity,10.5])assert.throws(()=>speechRetentionPolicyHash({...descriptor,authorizationExpiresAt:until}),/unavailable/);
 for(const review of ['', 'not-a-review', 'A'.repeat(64)])assert.throws(()=>speechRetentionPolicyHash({...descriptor,reviewArtifactSHA256:review}),/unavailable/);
 assert.throws(()=>createSpeechRetentionProof({...input,policyHash:''},key),/unavailable/);
});
test('v2 adapter guards owner, resource, duration, review and abort before RPC',async()=>{
 let calls=0;const client={schema:()=>({rpc:()=>{calls++;throw Error('must not dispatch');}})};
 const config={keyId:'synthetic',key,boundaryReviewed:true,policy:descriptor};
 const ledger=createSpeechRetentionUsageLedger(input.owner,client,config);
 const usage={owner:input.owner,requestId:input.requestId,fingerprint:'a'.repeat(64),durationMs:5000,resourceName:'yeoni-speech-jace',region:'koreacentral'};
 for(const patch of [{owner:input.requestId},{durationMs:5001},{durationMs:0},{durationMs:NaN},{region:'other'},{resourceName:'other'},{fingerprint:'bad'}])assert.equal(await ledger.consume({...usage,...patch},new AbortController().signal),'limit');
 const controller=new AbortController();controller.abort();await assert.rejects(ledger.consume(usage,controller.signal),/abort/i);
 const disabled=createSpeechRetentionUsageLedger(input.owner,client,{...config,boundaryReviewed:false});await assert.rejects(disabled.isReady!(new AbortController().signal),/boundary unavailable/);assert.equal(calls,0);
});
test('abort or uncertain consume response is never retried and cannot produce a settlement reservation',async()=>{
 let calls=0,resolve!:(v:{data:unknown;error:unknown})=>void;
 const client={schema:()=>({rpc:()=>{calls++;const p=new Promise<{data:unknown;error:unknown}>(r=>resolve=r);const q=Object.assign(p,{abortSignal:()=>q});return q;}})};
 const ledger=createSpeechRetentionUsageLedger(input.owner,client,{keyId:'synthetic',key,boundaryReviewed:true,policy:descriptor});
 const usage={owner:input.owner,requestId:input.requestId,fingerprint:'a'.repeat(64),durationMs:5000,resourceName:'yeoni-speech-jace',region:'koreacentral'};
 const controller=new AbortController(),pending=ledger.consume(usage,controller.signal);controller.abort();resolve({data:'accepted',error:null});await assert.rejects(pending,/abort/i);assert.equal(calls,1);
 assert.equal(await ledger.settle!({owner:input.owner,requestId:input.requestId},new AbortController().signal),false);assert.equal(calls,1);
 const lost=ledger.consume(usage,new AbortController().signal);resolve({data:null,error:{message:'synthetic loss'}});await assert.rejects(lost,/confirmation unavailable/);assert.equal(calls,2);
 assert.equal(await ledger.settle!({owner:input.owner,requestId:input.requestId},new AbortController().signal),false);assert.equal(calls,2);
});
