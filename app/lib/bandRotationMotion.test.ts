import test from 'node:test';
import assert from 'node:assert/strict';
import {bandRotationPose,bandRotationMotionId,projectRotationPoint,type RotationPoint} from './bandRotationMotion.ts';
const d=(a:RotationPoint,b:RotationPoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('external rotation fixes upper arm and trunk, rotates a constant forearm at 90 degrees',()=>{
  const initial=bandRotationPose(0);let last=d(initial.hand,initial.anchor);
  for(let i=0;i<=400;i++){
    const p=bandRotationPose(i/400);
    for(const key of Object.keys(p) as (keyof typeof p)[]) if(key!=='hand') assert.deepEqual(p[key],initial[key]);
    assert.ok(Math.abs(d(p.elbow,p.hand)-40)<1e-8);
    assert.equal(d(p.shoulder,p.elbow),42);
    assert.equal(p.hand.z,p.elbow.z); // forearm perpendicular to the vertical upper arm
    assert.ok(p.hand.y>=24 && p.hand.x>=p.elbow.x);
    const band=d(p.hand,p.anchor);
    assert.ok(i<=200?band>=last-1e-8:band<=last+1e-8);last=band;
    for(const view of ['front','top'] as const) for(const point of [p.elbow,p.hand,p.anchor]){
      const q=projectRotationPoint(point,view);assert.ok(q.x>10&&q.x<290&&q.y>10&&q.y<260);
    }
  }
});
test('top projection exposes constant radius hidden by frontal foreshortening; endpoints and ID are exact',()=>{
  const a=bandRotationPose(0),b=bandRotationPose(.5);
  assert.equal(projectRotationPoint(a.hand,'front').x,projectRotationPoint(a.elbow,'front').x);
  assert.ok(projectRotationPoint(a.hand,'top').y>projectRotationPoint(a.elbow,'top').y+40);
  assert.ok(b.hand.x>a.hand.x+30&&b.hand.y<a.hand.y-10);
  assert.deepEqual(bandRotationPose(1),a);
  for(const p of [NaN,Infinity,-1,2]) assert.deepEqual(bandRotationPose(p),a);
  assert.equal(bandRotationMotionId('band-external-rotation-at-side'),'band-external-rotation-at-side');
  assert.equal(bandRotationMotionId('band-row'),null);
});
