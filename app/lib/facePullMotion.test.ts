import test from 'node:test';
import assert from 'node:assert/strict';
import {facePullPose as pose,facePullMotionId} from './facePullMotion.ts';
const d=(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number})=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('face pull preserves both arm segments and fixed supports while maintaining face clearance',()=>{
 const start=pose(0);
 for(let i=0;i<=400;i++){
  const p=pose(i/400);
  for(const k of ['head','hip','leftFoot','rightFoot','anchor'] as const)assert.deepEqual(p[k],start[k]);
  for(const arm of [p.left,p.right]){
   assert.ok(Math.abs(d(arm.shoulder,arm.elbow)-38)<1e-8);
   assert.ok(Math.abs(d(arm.elbow,arm.hand)-40)<1e-8);
   assert.ok(Math.abs(arm.elbow.x)>22);assert.ok(arm.hand.y>=24);
   for(let j=0;j<=20;j++){const t=j/20;const v={x:arm.hand.x+(p.anchor.x-arm.hand.x)*t,y:arm.hand.y+(p.anchor.y-arm.hand.y)*t,z:arm.hand.z+(p.anchor.z-arm.hand.z)*t};assert.ok(d(v,p.head)>22);}
  }
  assert.ok(Math.abs(p.left.elbow.x+p.right.elbow.x)<1e-8);
  assert.equal(p.left.hand.y,p.right.hand.y);
 }
});
test('face pull draws hands back and apart while elbows move outward, not a renamed external rotation',()=>{
 const a=pose(0),b=pose(.5);
 assert.ok(b.right.hand.y<a.right.hand.y-40);assert.ok(b.right.hand.x>a.right.hand.x+25);
 assert.ok(b.right.elbow.x>a.right.elbow.x+20);
 assert.deepEqual(pose(1),a);assert.deepEqual(pose(NaN),a);
 assert.equal(facePullMotionId('longband-face-pull'),'longband-face-pull');
 assert.equal(facePullMotionId('band-pull-apart'),null);
});
