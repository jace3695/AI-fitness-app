import test from 'node:test';import assert from 'node:assert/strict';
import {loopWalkPose,loopWalkMotionId,loopWalkPhase,type WalkPoint} from './loopWalkMotion.ts';
const d=(a:WalkPoint,b:WalkPoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
for(const id of ['loopband-sidewalk','loopband-monster-walk'] as const){
  test(`${id} preserves legs, toe alignment and one grounded foot across four steps`,()=>{
    for(let stage=0;stage<4;stage++){
      const start=loopWalkPose(id,stage/4);
      for(let i=1;i<=100;i++){
        const p=loopWalkPose(id,(stage+i/101)/4),support=p.moving==='left'?'right':'left';
        assert.deepEqual(p[support].ankle,start[support].ankle);
        assert.equal(p[support].ankle.z,6);assert.ok(p.moving==='left'||p.moving==='right');assert.ok(p[p.moving].ankle.z>6);
        assert.equal(p.hip.z,108);assert.equal(p.shoulder.z,184);
        assert.ok(p.right.ankle.x-p.left.ankle.x>=48);
        for(const leg of [p.left,p.right]){
          assert.ok(Math.abs(d(leg.hip,leg.knee)-60)<1e-8);assert.ok(Math.abs(d(leg.knee,leg.ankle)-58)<1e-8);
          assert.equal(leg.knee.x,leg.toe.x);assert.equal(leg.ankle.z,leg.toe.z);
          assert.ok(leg.band.z>leg.knee.z+8,'loop stays above knee joint');
        }
      }
    }
    const start=loopWalkPose(id,0),end=loopWalkPose(id,1);
    assert.deepEqual(end.left,start.left);assert.deepEqual(end.right,start.right);assert.deepEqual(end.hip,start.hip);
    for(const p of [NaN,Infinity,-1])assert.deepEqual(loopWalkPose(id,p),start);
    assert.equal(loopWalkMotionId(id),id);assert.ok(loopWalkPhase(id,.125).length>5);
    for(const boundary of [.25,.5,.75]){
      const before=loopWalkPose(id,boundary-1e-7),after=loopWalkPose(id,boundary+1e-7);
      assert.ok(d(before.left.ankle,after.left.ankle)<1e-5&&d(before.right.ankle,after.right.ankle)<1e-5);
    }
  });
}
test('lateral walk and monster walk have different footprints, not renamed trajectories',()=>{
  const side=loopWalkPose('loopband-sidewalk',.5),monster=loopWalkPose('loopband-monster-walk',.5);
  assert.equal(side.hip.x,26);assert.equal(side.hip.y,0);
  assert.equal(monster.hip.x,0);assert.equal(monster.hip.y,24);
  assert.equal(loopWalkMotionId('indoor-walk'),null);
});
