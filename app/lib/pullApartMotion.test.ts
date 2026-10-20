import test from 'node:test';
import assert from 'node:assert/strict';
import {pullApartPose,pullApartMotionId,projectPullPoint,type PullPoint} from './pullApartMotion.ts';
const d=(a:PullPoint,b:PullPoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('pull-apart preserves each segment and fixed slight elbow bend while both arms move about shoulders',()=>{
  const a=pullApartPose(0);let previous=d(a.left.hand,a.right.hand);
  for(let i=0;i<=400;i++){
    const p=pullApartPose(i/400);
    for(const key of ['head','hip','leftFoot','rightFoot'] as const) assert.deepEqual(p[key],a[key]);
    for(const side of ['left','right'] as const){
      const arm=p[side];assert.deepEqual(arm.shoulder,a[side].shoulder);
      assert.ok(Math.abs(d(arm.shoulder,arm.elbow)-38)<1e-8);
      assert.ok(Math.abs(d(arm.elbow,arm.hand)-32)<1e-8);
      assert.ok(Math.abs(d(arm.shoulder,arm.hand)-d(a[side].shoulder,a[side].hand))<1e-8);
      assert.equal(arm.hand.z,154);assert.ok(arm.hand.y>25,'band remains in front of torso');
      for(const view of ['front','top'] as const) for(const v of Object.values(arm)){
        const q=projectPullPoint(v,view);assert.ok(q.x>10&&q.x<290&&q.y>10&&q.y<260);
      }
    }
    assert.equal(p.left.hand.x,-p.right.hand.x);assert.equal(p.left.hand.y,p.right.hand.y);
    const width=d(p.left.hand,p.right.hand);assert.ok(i<=200?width>=previous-1e-8:width<=previous+1e-8);previous=width;
  }
});
test('pull-apart is shoulder abduction with moving elbows, not fixed-elbow external rotation',()=>{
  const a=pullApartPose(0),b=pullApartPose(.5);
  assert.ok(b.right.elbow.x>a.right.elbow.x+25&&b.right.elbow.y<a.right.elbow.y-20);
  assert.ok(b.right.hand.x>a.right.hand.x+55);
  assert.deepEqual(pullApartPose(1),a);
  for(const p of [NaN,Infinity,-1,2]) assert.deepEqual(pullApartPose(p),a);
  assert.equal(pullApartMotionId('band-pull-apart'),'band-pull-apart');
  assert.equal(pullApartMotionId('band-external-rotation-at-side'),null);
});
