import test from 'node:test';
import assert from 'node:assert/strict';
import {catCowPose as pose,catCowPhase,catCowMotionId} from './catCowMotion.ts';
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('cat cow preserves every spinal segment, limb supports and head distance throughout both arcs',()=>{
 const a=pose(0);
 for(let i=0;i<=400;i++){
  const p=pose(i/400);
  for(const k of ['hand','knee','ankle','toe'] as const)assert.deepEqual(p[k],a[k]);
  for(let j=1;j<p.spine.length;j++)near(Math.hypot(p.spine[j].x-p.spine[j-1].x,p.spine[j].y-p.spine[j-1].y),10);
  near(Math.hypot(p.hip.x-p.knee.x,p.hip.y-p.knee.y),65);
  near(Math.hypot(p.shoulder.x-p.hand.x,p.shoulder.y-p.hand.y),65);
  near(Math.hypot(p.head.x-p.shoulder.x,p.head.y-p.shoulder.y),25);
  near(p.shoulder.y,p.hip.y);assert.ok(Math.abs(p.angle)<=.32);
 }
});
test('cat cow has distinct opposite curvatures with neutral resets and exact lookup',()=>{
 const neutral=pose(0),cow=pose(.25),cat=pose(.75);
 assert.ok(cow.spine[4].y>cow.hip.y);assert.ok(cat.spine[4].y<cat.hip.y);
 near(pose(.5).hip.x,neutral.hip.x);assert.deepEqual(pose(1),neutral);assert.deepEqual(pose(NaN),neutral);
 assert.ok(catCowPhase(.1).includes('들이쉬'));assert.ok(catCowPhase(.6).includes('내쉬'));
 assert.equal(catCowPhase(.25),'가슴을 가볍게 연 자세');assert.equal(catCowPhase(.75),'등을 둥글게 한 자세');assert.equal(catCowPhase(.5),'중립 준비 자세');
 assert.equal(catCowMotionId('cat-cow'),'cat-cow');assert.equal(catCowMotionId('bird-dog'),null);
});
