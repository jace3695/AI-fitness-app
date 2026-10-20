import test from 'node:test';
import assert from 'node:assert/strict';
import {supportedRowPose as pose,supportedRowMotionId,projectSupportedRow,type RowPoint} from './supportedRowMotion.ts';
const distance=(a:RowPoint,b:RowPoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('supported row fixes hand, both feet and torso while preserving working arm and legs',()=>{
 const start=pose(0);
 for(let i=0;i<=400;i++){
  const p=pose(i/400);
  for(const k of ['supportHand','supportShoulder','leftAnkle','rightAnkle','leftToe','rightToe','hip','neck','head'] as const)assert.deepEqual(p[k],start[k]);
  near(distance(p.shoulder,p.elbow),40);near(distance(p.elbow,p.hand),35);
  for(const [hip,knee,ankle] of [[p.leftHip,p.leftKnee,p.leftAnkle],[p.rightHip,p.rightKnee,p.rightAnkle]]){
   near(distance(hip,knee),55);near(distance(knee,ankle),55);assert.ok(knee.z>5);
  }
  assert.equal(p.hand.y,20);assert.equal(p.elbow.y,20);assert.ok(p.hand.y>p.table[2].y+10);
  assert.equal(p.hand.x,p.elbow.x);assert.ok(p.hand.z>60);
  for(const point of [p.head,p.hand,p.elbow,p.supportHand,p.leftToe,p.rightToe]){
   for(const view of ['oblique','top'] as const){const q=projectSupportedRow(point,view);assert.ok(q.x>0&&q.x<300&&q.y>0&&q.y<270);}
  }
 }
});
test('supported row moves upper arm backward, lifts load, and closes without a body swing',()=>{
 const a=pose(0),b=pose(.5);
 assert.ok(b.elbow.x<a.elbow.x-35);assert.ok(b.hand.z>a.hand.z+30);
 assert.deepEqual(pose(1),a);assert.deepEqual(pose(NaN),a);assert.deepEqual(pose(-1),a);
 assert.equal(supportedRowMotionId('one-arm-dumbbell-row-supported'),'one-arm-dumbbell-row-supported');
 assert.equal(supportedRowMotionId('band-row'),null);
});
