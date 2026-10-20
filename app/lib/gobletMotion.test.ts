import test from 'node:test';import assert from 'node:assert/strict';
import {gobletPose,gobletMotionId,projectGobletPoint,type GobletPoint} from './gobletMotion.ts';
const d=(a:GobletPoint,b:GobletPoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('goblet squat preserves limbs, fixed feet, vertical load and both hand contacts',()=>{
  const a=gobletPose(0);
  for(let i=0;i<=400;i++){
    const p=gobletPose(i/400);
    for(const side of ['leftLeg','rightLeg'] as const){
      const leg=p[side];assert.deepEqual(leg.ankle,a[side].ankle);assert.deepEqual(leg.toe,a[side].toe);
      assert.ok(Math.abs(d(leg.hip,leg.knee)-60)<1e-8);assert.ok(Math.abs(d(leg.knee,leg.ankle)-58)<1e-8);
      assert.ok(Math.abs((leg.knee.x-leg.ankle.x)*18-(leg.toe.x-leg.ankle.x)*leg.knee.y)<1e-8,'knee tracks slightly outward toe direction');
    }
    assert.ok(Math.abs(d(p.hip,p.shoulder)-78)<1e-8);assert.ok(Math.abs(d(p.shoulder,p.head)-24)<1e-8);
    assert.equal(p.weightTop.x,p.weightBottom.x);assert.equal(p.weightTop.y,p.weightBottom.y);assert.equal(p.weightTop.z-p.weightBottom.z,22);
    for(const arm of [p.leftArm,p.rightArm]){
      assert.ok(Math.abs(d(arm.shoulder,arm.elbow)-35)<1e-8);assert.ok(Math.abs(d(arm.elbow,arm.hand)-32)<1e-8);
      assert.equal(arm.hand.y,p.weightTop.y);assert.ok(Math.abs(arm.hand.z-(p.weightTop.z-4))<1e-8);
      assert.ok(arm.elbow.z>p.rightLeg.knee.z+30,'elbows do not collide with knees in this range');
    }
    for(const view of ['front','side'] as const)for(const point of [p.head,p.hip,p.weightTop,p.weightBottom]){
      const q=projectGobletPoint(point,view);assert.ok(q.x>15&&q.x<285&&q.y>15&&q.y<250);
    }
  }
});
test('goblet shows hip descent/backward travel with a chest-held load and closed cycle',()=>{
  const a=gobletPose(0),b=gobletPose(.5);
  assert.ok(b.hip.z<a.hip.z-50&&b.hip.y<a.hip.y-30);assert.ok(b.weightTop.z<a.weightTop.z-50);
  assert.deepEqual(gobletPose(1),a);for(const p of [NaN,Infinity,-1,2])assert.deepEqual(gobletPose(p),a);
  assert.equal(gobletMotionId('dumbbell-goblet-squat'),'dumbbell-goblet-squat');assert.equal(gobletMotionId('bodyweight-squat'),null);
});
