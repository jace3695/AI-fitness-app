import test from 'node:test';
import assert from 'node:assert/strict';
import {latPulldownPose as pose,latPulldownMotionId} from './latPulldownMotion.ts';
const distance=(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number})=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('lat pulldown preserves arm lengths and supports, keeping both bands in front of head',()=>{
 const a=pose(0);
 for(let i=0;i<=400;i++){
  const p=pose(i/400);
  for(const k of ['hip','head','anchor','leftFoot','rightFoot','leftKnee','rightKnee'] as const)assert.deepEqual(p[k],a[k]);
  for(const arm of [p.left,p.right]){
   assert.ok(Math.abs(distance(arm.shoulder,arm.elbow)-38)<1e-8);
   assert.ok(Math.abs(distance(arm.elbow,arm.hand)-40)<1e-8);
   assert.ok(arm.hand.z>arm.elbow.z);assert.ok(arm.hand.y>=30);
   for(let j=0;j<=20;j++){const t=j/20;const bandY=arm.hand.y+(p.anchor.y-arm.hand.y)*t;assert.ok(bandY>14+8);}
  }
  assert.equal(p.left.hand.x,-p.right.hand.x);assert.equal(p.left.hand.z,p.right.hand.z);
 }
});
test('lat pulldown lowers elbows and lengthens band with a closed cycle and exact ID',()=>{
 const a=pose(0),b=pose(.5);
 assert.ok(a.left.elbow.z-b.left.elbow.z>60);
 assert.ok(distance(b.anchor,b.left.hand)>distance(a.anchor,a.left.hand)+35);
 assert.deepEqual(pose(1),a);assert.deepEqual(pose(NaN),a);
 assert.equal(latPulldownMotionId('longband-lat-pulldown'),'longband-lat-pulldown');
 assert.equal(latPulldownMotionId('band-row'),null);
});
