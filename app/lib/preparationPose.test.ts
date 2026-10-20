import test from 'node:test';
import assert from 'node:assert/strict';
import { assistedBarGeometry as b, preparationPoseId, preparationPoses, sliderReadyGeometry as s } from './preparationPose.ts';

test('preparation lookup is explicit and never aliases rollouts or full pullups',()=>{
  for(const id of Object.keys(preparationPoses))assert.equal(preparationPoseId(id),id);
  for(const id of [undefined,'ab-rollout','pullup','wall-pushup',''])assert.equal(preparationPoseId(id),null);
});
test('slider ready pose grounds the wheel and padded knees without a rollout endpoint',()=>{
  assert.equal(s.shoulder.y,s.hip.y);
  assert.equal(s.hand.x,s.wheel.x);assert.equal(s.hand.y,s.wheel.y);
  assert.equal(s.wheel.y+s.wheelRadius+1.5,s.floor);
  assert.equal(s.knee.y+5,s.floor);assert.equal(s.toe.y+5,s.floor);
  assert.equal(s.shoulder.x,s.hand.x);
});
test('assisted bar pose keeps both feet grounded and hands on bar',()=>{
  assert.equal(b.leftHand.y,34);assert.equal(b.rightHand.y,34);
  assert.equal(b.leftAnkle.y+5,b.floor);assert.equal(b.rightAnkle.y+5,b.floor);
  assert.equal(b.leftToe.y+5,b.floor);assert.equal(b.rightToe.y+5,b.floor);
  assert.ok(b.head.y+15<b.leftShoulder.y);
});
