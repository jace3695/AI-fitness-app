import test from 'node:test';
import assert from 'node:assert/strict';
import {pelvicTiltPose as pose,pelvicTiltMotionId} from './pelvicTiltMotion.ts';
test('pelvic tilt maintains ellipse floor contact, fixed head and feet, and leg lengths',()=>{
 const a=pose(0);
 for(let i=0;i<=400;i++){
  const p=pose(i/400);
  for(const k of ['head','shoulder','foot','toe','backEnd'] as const)assert.deepEqual(p[k],a[k]);
  assert.ok(Math.abs(p.center.y+p.radiusY+1-195)<1e-9);
  assert.equal(p.shoulder.y+7,195);assert.equal(p.head.y+13,195);assert.equal(p.foot.y+5,195);
  assert.ok(Math.abs(Math.hypot(p.knee.x-p.hip.x,p.knee.y-p.hip.y)-55)<1e-8);
  assert.ok(Math.abs(Math.hypot(p.knee.x-p.foot.x,p.knee.y-p.foot.y)-55)<1e-8);
  assert.ok(Math.hypot(p.hip.x-a.hip.x,p.hip.y-a.hip.y)<2);
  assert.ok(p.angle>=-.12&&p.angle<=0);
  const middleY=(p.shoulder.y+2*p.backControl.y+p.backEnd.y)/4;
  assert.ok(middleY+3<195);
 }
});
test('tilt moves anterior marker toward head and reduces surface gap without raising pelvis',()=>{
 const a=pose(0),b=pose(.5);
 assert.ok(b.marker.x<a.marker.x);assert.ok(b.marker.y<a.marker.y);
 assert.ok(b.backControl.y>a.backControl.y);
 assert.ok(Math.abs(a.center.y-b.center.y)<.2);
 assert.deepEqual(pose(1),a);assert.deepEqual(pose(NaN),a);
 assert.equal(pelvicTiltMotionId('pelvic-tilt'),'pelvic-tilt');assert.equal(pelvicTiltMotionId('bridge'),null);
});
