import test from 'node:test';import assert from 'node:assert/strict';
import {pallofPose,pallofMotionId,projectPallofPoint,type PallofPoint} from './pallofMotion.ts';
const d=(a:PallofPoint,b:PallofPoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('Pallof arms preserve lengths with central forward travel and fixed trunk, feet and side anchor',()=>{
  const a=pallofPose(0);
  for(let i=0;i<=400;i++){
    const p=pallofPose(i/400);
    for(const key of ['head','hip','leftFoot','rightFoot','anchor'] as const)assert.deepEqual(p[key],a[key]);
    assert.equal(p.grip.x,0);assert.equal(p.grip.z,135);assert.ok(p.grip.y>=22&&p.grip.y<=52);
    for(const side of ['left','right'] as const){
      const arm=p[side];assert.deepEqual(arm.shoulder,a[side].shoulder);
      assert.ok(Math.abs(d(arm.shoulder,arm.elbow)-38)<1e-8);
      assert.ok(Math.abs(d(arm.elbow,arm.hand)-32)<1e-8);
      assert.ok(d(arm.shoulder,arm.hand)<70,'elbows never lock straight');
      assert.equal(arm.hand.y,p.grip.y);assert.equal(arm.hand.z,p.grip.z);
      for(const point of Object.values(arm))for(const view of ['front','top'] as const){
        const q=projectPallofPoint(point,view);assert.ok(q.x>10&&q.x<290&&q.y>10&&q.y<260);
      }
    }
    assert.ok(Math.abs(p.left.elbow.x+p.right.elbow.x)<1e-8);
    assert.ok(p.anchor.x<p.grip.x-100,'lateral resistance does not become a frontal row');
  }
});
test('forward press differs from lateral pull-apart, closes cycle and rejects other IDs',()=>{
  const a=pallofPose(0),b=pallofPose(.5);
  assert.equal(b.grip.y-a.grip.y,30);assert.equal(d(a.left.hand,a.right.hand),d(b.left.hand,b.right.hand));
  assert.deepEqual(pallofPose(1),a);
  for(const p of [NaN,Infinity,-1,2])assert.deepEqual(pallofPose(p),a);
  assert.equal(pallofMotionId('band-pallof-press'),'band-pallof-press');assert.equal(pallofMotionId('band-row'),null);
});
