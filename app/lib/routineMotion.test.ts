import test from 'node:test';
import assert from 'node:assert/strict';
import {routinePose,warmupStages,routineMotionId,type RoutinePoint} from './routineMotion.ts';
const d=(a:RoutinePoint,b:RoutinePoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('warmup covers all six guide groups, with both ankles separated and no duplicate stage IDs',()=>{
 assert.equal(warmupStages.length,7);assert.equal(new Set(warmupStages.map(s=>s.id)).size,7);
 assert.deepEqual(warmupStages.map(s=>s.id),['neck-turn','shoulder-roll','hip-shift','small-knee-bend','ankle-left','ankle-right','march']);
 assert.equal(routineMotionId('basic-warmup'),'basic-warmup');assert.equal(routineMotionId('basic-cooldown'),null);
});
test('each new warmup scene preserves limb lengths and its grounded supports across a closed cycle',()=>{
 for(const stage of warmupStages){
  if(stage.id==='march')continue;
  const a=routinePose(stage.id,0);
  for(let i=0;i<=200;i++){
   const p=routinePose(stage.id,i/200);
   for(const k of ['left','right'] as const){
    assert.ok(Math.abs(d(p[k].shoulder,p[k].elbow)-35)<1e-8);assert.ok(Math.abs(d(p[k].elbow,p[k].hand)-32)<1e-8);
    if(p.supported)assert.deepEqual(p[k].hand,a[k].hand);
   }
   for(const k of ['leftLeg','rightLeg'] as const){
    assert.ok(Math.abs(d(p[k].hip,p[k].knee)-55)<1e-8);assert.ok(Math.abs(d(p[k].knee,p[k].foot)-55)<1e-8);
    assert.ok(Math.abs(d(p[k].foot,p[k].toe)-18)<1e-8);assert.deepEqual(p[k].foot,a[k].foot);
    if(!p[k].moving)assert.deepEqual(p[k].toe,a[k].toe);
    assert.ok(p[k].toe.z>=5);
   }
  }
  assert.deepEqual(routinePose(stage.id,1),a);assert.deepEqual(routinePose(stage.id,NaN),a);
 }
});
test('distinct warmup movements cannot be substituted by renamed static poses',()=>{
 assert.ok(routinePose('neck-turn',.25).headYaw>0);assert.ok(routinePose('neck-turn',.75).headYaw<0);
 assert.ok(routinePose('hip-shift',.25).hip.x>0);assert.ok(routinePose('hip-shift',.75).hip.x<0);
 assert.ok(routinePose('small-knee-bend',.5).hip.z<routinePose('small-knee-bend',0).hip.z);
 assert.notDeepEqual(routinePose('ankle-left',.25).leftLeg.toe,routinePose('ankle-left',0).leftLeg.toe);
 assert.deepEqual(routinePose('ankle-left',.25).rightLeg.toe,routinePose('ankle-left',0).rightLeg.toe);
});
