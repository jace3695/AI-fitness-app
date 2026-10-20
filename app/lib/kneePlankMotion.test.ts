import test from 'node:test';
import assert from 'node:assert/strict';
import {kneePlankPose as pose,kneePlankMotionId,type KneePlankPoint} from './kneePlankMotion.ts';
const d=(a:KneePlankPoint,b:KneePlankPoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('knee side plank fixes supports and preserves torso and limb segments without floating knees',()=>{
 const a=pose(0);
 for(let i=0;i<=400;i++){
  const p=pose(i/400);
  for(const k of ['elbow','hand','knee','ankle','toe','upperKnee','upperAnkle'] as const)assert.deepEqual(p[k],a[k]);
  near(d(p.elbow,p.shoulder),45);near(d(p.shoulder,p.hip),80);near(d(p.hip,p.knee),65);
  near(d(p.upperHip,p.upperKnee),65);near(d(p.knee,p.ankle),45);
  near(d(p.shoulder,p.head),24);near(d(p.shoulder,p.freeElbow),45);near(d(p.freeElbow,p.hip),40);
  assert.ok(p.hip.z>5);assert.ok(Math.abs(p.shoulder.x-p.elbow.x)<4.5);
  assert.equal(p.knee.y,0);assert.equal(p.ankle.y,-45);
 }
});
test('plank lift aligns shoulder hip and knee at peak and returns to lower supported pose',()=>{
 const a=pose(0),b=pose(.5);
 assert.ok(b.hip.z>a.hip.z+15);
 near(d(b.shoulder,b.knee),d(b.shoulder,b.hip)+d(b.hip,b.knee));
 near(b.elbow.x,b.shoulder.x);assert.deepEqual(pose(1),a);assert.deepEqual(pose(NaN),a);
 assert.equal(kneePlankMotionId('knee-side-plank'),'knee-side-plank');assert.equal(kneePlankMotionId('side-plank'),null);
});
