import test from 'node:test';
import assert from 'node:assert/strict';
import {assistedBarPose as pose,assistedBarMotionId,type BarPoint} from './assistedBarMotion.ts';
const d=(a:BarPoint,b:BarPoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('assisted bar keeps both grips and feet fixed with constant arm, leg and trunk lengths',()=>{
 const a=pose(0);
 for(let i=0;i<=400;i++){
  const p=pose(i/400);
  for(const k of ['left','right'] as const){assert.deepEqual(p[k],a[k]);assert.ok(Math.abs(d(p[k].shoulder,p[k].elbow)-35)<1e-8);assert.ok(Math.abs(d(p[k].elbow,p[k].hand)-35)<1e-8);}
  for(const k of ['leftLeg','rightLeg'] as const){
   assert.deepEqual(p[k].foot,a[k].foot);assert.deepEqual(p[k].toe,a[k].toe);
   assert.ok(Math.abs(d(p[k].hip,p[k].knee)-55)<1e-8);assert.ok(Math.abs(d(p[k].knee,p[k].foot)-55)<1e-8);
   assert.equal(p[k].foot.z,5);assert.ok(p[k].knee.y>0);
  }
  assert.ok(Math.abs(d(p.neck,p.hip)-70)<1e-8);assert.ok(Math.abs(d(p.head,p.neck)-27)<1e-8);assert.ok(p.rise<=3);
 }
});
test('foot-assisted preparation increases ear-to-shoulder separation without turning into a pullup',()=>{
 const a=pose(0),b=pose(.5);
 assert.equal(b.head.z-b.right.shoulder.z,30);assert.equal(a.head.z-a.right.shoulder.z,27);
 assert.ok(b.rightLeg.knee.y<a.rightLeg.knee.y);
 assert.deepEqual(pose(1),a);assert.deepEqual(pose(NaN),a);
 assert.equal(assistedBarMotionId('pullup-basic-posture'),'pullup-basic-posture');assert.equal(assistedBarMotionId('pullup'),null);
});
