import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UNCONFIGURED_RETENTION,parseRetentionDescriptor,parseRetentionDisclosure,verifyRetentionDisclosure,cleanupDelaySeconds} from './assessment-retention.ts';
import {speechRetentionPolicyHash} from '../../../lib/speech-retention-proof.ts';
const policy=()=>({metadataRetentionSeconds:120,authorizationExpiresAt:Math.floor(Date.now()/1000)+3600,reviewArtifactSHA256:'b'.repeat(64),cleanupIntervalSeconds:60,cleanupStartDelaySeconds:10,cleanupRunTimeoutSeconds:5});
test('no retention default exists and incomplete cleanup policy fails closed',()=>{
 assert.equal(UNCONFIGURED_RETENTION,null);assert.throws(()=>parseRetentionDescriptor(null));
 const p=policy();for(const key of Object.keys(p)){const missing={...p} as Record<string,unknown>;delete missing[key];assert.throws(()=>parseRetentionDescriptor(missing));}
 for(const patch of [{metadataRetentionSeconds:null},{cleanupIntervalSeconds:0},{cleanupStartDelaySeconds:-1},{cleanupRunTimeoutSeconds:0},{extra:true}])assert.throws(()=>parseRetentionDescriptor({...p,...patch}));
 assert.equal(cleanupDelaySeconds(p),75);
});
test('public disclosure cryptographically binds the exact TTL and conditional cleanup settings',async()=>{
 const p=policy(),d={...p,policyHash:speechRetentionPolicyHash(p)};assert.deepEqual(await verifyRetentionDisclosure(d),d);
 for(const patch of [{metadataRetentionSeconds:121},{cleanupIntervalSeconds:61},{cleanupStartDelaySeconds:11},{cleanupRunTimeoutSeconds:6},{reviewArtifactSHA256:'c'.repeat(64)},{policyHash:'0'.repeat(64)}])await assert.rejects(verifyRetentionDisclosure({...d,...patch}));
 assert.throws(()=>parseRetentionDisclosure({...d,authorizationExpiresAt:Math.floor(Date.now()/1000)+30}));assert.throws(()=>parseRetentionDisclosure({...d,owner:'not-public'}));
});
test('disclosure expiry is rechecked after asynchronous digest, including the exact dispatch-window boundary',async()=>{
 const p={...policy(),authorizationExpiresAt:1000},d={...p,policyHash:speechRetentionPolicyHash(p)};
 let calls=0;
 await assert.rejects(verifyRetentionDisclosure(d,()=>++calls===1?969000:970000),/expired/);
 assert.equal(calls,2);
 calls=0;
 assert.deepEqual(await verifyRetentionDisclosure(d,()=>++calls===1?969000:969999),d);
 assert.equal(calls,2);
});
