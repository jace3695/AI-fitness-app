import assert from 'node:assert/strict';
import test from 'node:test';
import { alternatingExercisePose, alternatingPhase, alternatingMotionId } from './alternatingExerciseMotion.ts';
const distance = (a: {x:number;y:number}, b: {x:number;y:number}) => Math.hypot(a.x-b.x,a.y-b.y);
const near = (a:number,b:number) => assert.ok(Math.abs(a-b)<1e-8);
test('march alternates feet, never lifts both and preserves leg lengths', () => {
  for(let i=0;i<=400;i++) {
    const p=alternatingExercisePose('indoor-walk',i/400);
    near(distance(p.hip,p.knee),52); near(distance(p.knee,p.ankle),52);
    near(distance(p.farHip,p.farKnee),52); near(distance(p.farKnee,p.farAnkle),52);
    assert.ok(p.ankle.y===272 || p.farAnkle.y===272);
    assert.ok(p.toe.y<=272 && p.farToe.y<=272);
    near(distance(p.shoulder,p.elbow),34); near(distance(p.elbow,p.hand),28);
  }
  const right=alternatingExercisePose('indoor-walk',.25),left=alternatingExercisePose('indoor-walk',.75);
  assert.ok(right.ankle.y<right.farAnkle.y); assert.ok(left.farAnkle.y<left.ankle.y);
  assert.ok(right.elbow.x<right.shoulder.x && right.farElbow.x>right.farShoulder.x);
});
test('bird dog alternates contralateral pairs, arm starts before leg, supporting hand/knee stay grounded',()=>{
  const start=alternatingExercisePose('bird-dog',0);
  for(let i=0;i<=400;i++) {
    const t=i/400,p=alternatingExercisePose('bird-dog',t);
    for(const key of ['head','hip','farHip','shoulder','farShoulder'] as const) assert.deepEqual(p[key],start[key]);
    for(const side of [['shoulder','elbow','hand'],['farShoulder','farElbow','farHand']] as const) {
      near(distance(p[side[0]],p[side[1]]),26); near(distance(p[side[1]],p[side[2]]),26);
    }
    near(distance(p.hip,p.knee),52);near(distance(p.knee,p.ankle),38);
    near(distance(p.farHip,p.farKnee),52);near(distance(p.farKnee,p.farAnkle),38);
    if(t<.5){assert.deepEqual(p.farHand,start.farHand);assert.deepEqual(p.knee,start.knee);}
    else {assert.deepEqual(p.hand,start.hand);assert.deepEqual(p.farKnee,start.farKnee);}
    assert.ok(p.hand.y>=145 && p.farHand.y>=145 && p.ankle.y>=145 && p.farAnkle.y>=145);
  }
  const early=alternatingExercisePose('bird-dog',.05);
  assert.notDeepEqual(early.hand,start.hand);assert.deepEqual(early.farKnee,start.farKnee);
  const peak=alternatingExercisePose('bird-dog',.25);
  near(peak.hand.y,145);near(peak.farAnkle.y,145);
});
test('alternating cycles return to start between sides, label both sides, clamp malformed values',()=>{
  for(const id of ['bird-dog','indoor-walk'] as const) {
    for(const t of [.5,1,-1,NaN,Infinity])assert.deepEqual(alternatingExercisePose(id,t),alternatingExercisePose(id,0));
    for(let i=0;i<=400;i++)for(const p of Object.values(alternatingExercisePose(id,i/400)))assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=8&&p.x<265&&p.y>30&&p.y<=272);
  }
  assert.match(alternatingPhase('bird-dog',.25),/오른팔·왼다리/);assert.match(alternatingPhase('bird-dog',.75),/왼팔·오른다리/);
  assert.equal(alternatingMotionId('hip-bridge'),null);
});
