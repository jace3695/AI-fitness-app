import test from 'node:test';
import assert from 'node:assert/strict';
import { deadBugReviewPose, type DeadBugVariant } from '../app/lib/deadBugReviewMotion.ts';
import { rollerPose, rollerRecoveryStages, rollerStages } from '../app/lib/rollerMotion.ts';
import { preparationPoseId, preparationPoses, sliderReadyGeometry } from '../app/lib/preparationPose.ts';
import {
  pendingMotionCriteria, validateDeadBugFrame, validateRecoveryStages,
  validateRollerFrame, validateSliderPreparation,
} from './helpers/pending-motion-criteria.ts';

// These functions read the real current model. No browser, patient data or production mutation.
for (const variant of pendingMotionCriteria.deadBug.variants) {
  test(`deadbug ${variant}: preparation, both sides and neutral returns follow the contract`, () => {
    const neutral = deadBugReviewPose(variant, 0);
    for (const checkpoint of pendingMotionCriteria.deadBug.checkpoints) {
      const pose = deadBugReviewPose(variant, checkpoint.progress);
      assert.equal(pose.active, checkpoint.active, checkpoint.phase);
      assert.deepEqual(validateDeadBugFrame(variant, checkpoint.progress, pose, neutral), [], checkpoint.phase);
    }
    for (let frame = 0; frame <= 400; frame++) {
      const progress = frame / 400;
      assert.deepEqual(validateDeadBugFrame(variant, progress, deadBugReviewPose(variant, progress), neutral), [], `${variant} frame ${frame}`);
    }
  });
}

test('deadbug contract rejects same-side pairing, frozen limbs, trunk drift, stretching and silent leg motion', () => {
  const neutral = deadBugReviewPose('opposite-limbs', 0);
  const cases: { criterion: string; variant: DeadBugVariant; mutate: (pose: ReturnType<typeof deadBugReviewPose>) => void }[] = [
    { criterion: 'deadbug.nonworking-leg-fixed', variant: 'opposite-limbs', mutate: p => { p.rightLeg = structuredClone(p.leftLeg); p.leftLeg = structuredClone(neutral.leftLeg); } },
    { criterion: 'deadbug.working-arm-direction', variant: 'opposite-limbs', mutate: p => { p.right = structuredClone(neutral.right); } },
    { criterion: 'deadbug.fixed-trunk', variant: 'opposite-limbs', mutate: p => { p.hip.z += 1; } },
    { criterion: 'deadbug.rigid-arms', variant: 'opposite-limbs', mutate: p => { p.right.hand.x -= 1; } },
    { criterion: 'deadbug.arms-only-legs-fixed', variant: 'arms-only', mutate: p => { p.leftLeg = deadBugReviewPose('opposite-limbs', 0.25).leftLeg; } },
  ];
  for (const { criterion, variant, mutate } of cases) {
    const pose = structuredClone(deadBugReviewPose(variant, 0.25));
    mutate(pose);
    assert.ok(validateDeadBugFrame(variant, 0.25, pose, deadBugReviewPose(variant, 0)).includes(criterion), criterion);
  }
  assert.ok(validateDeadBugFrame('opposite-limbs', 0.5, deadBugReviewPose('opposite-limbs', 0.25), neutral).includes('deadbug.neutral-return'));
});

test('seven defined roller scenes preserve targets, supports, rolling contact and cycle return', () => {
  assert.deepEqual(rollerStages.map(stage => stage.id), [...pendingMotionCriteria.recovery.moving]);
  for (const stage of rollerStages) {
    const start = rollerPose(stage.id, 0);
    for (let frame = 0; frame <= 200; frame++) {
      const progress = frame / 200;
      assert.deepEqual(validateRollerFrame(stage.id, progress, rollerPose(stage.id, progress), start), [], `${stage.id} frame ${frame}`);
    }
    assert.deepEqual(rollerPose(stage.id, 1), start, `${stage.id} closed cycle`);
    assert.ok(rollerPose(stage.id, 0.5).travel > 0, `${stage.id} actual movement, not a renamed still`);
  }
});

test('roller contract rejects loss of contact, slipping supports, wrong targets and an inert pseudo-animation', () => {
  const id = 'calf-left';
  const start = rollerPose(id, 0);
  const cases: { criterion: string; mutate: (pose: ReturnType<typeof rollerPose>) => void }[] = [
    { criterion: 'roller.floor-contact', mutate: p => { p.roller.z += 1; } },
    { criterion: 'roller.body-contact', mutate: p => { p.contact.x += 1; } },
    { criterion: 'roller.hands-supported', mutate: p => { p.left.hand.x += 1; } },
    { criterion: 'roller.feet-supported', mutate: p => { p.rightLeg.foot.x += 1; } },
    { criterion: 'roller.support-leg-identity', mutate: p => { p.rightLeg.grounded = false; } },
    { criterion: 'roller.region-and-side', mutate: p => { p.side = 1; } },
    { criterion: 'roller.target-marker-contact', mutate: p => { p.contact.x = p.leftLeg.knee.x; } },
    { criterion: 'roller.contact-side', mutate: p => { p.contact.y = p.rightLeg.hip.y; } },
    { criterion: 'roller.rolling-relation', mutate: p => { p.roller.angle = 0; } },
    { criterion: 'roller.actual-travel', mutate: p => { p.roller.x += 1; p.contact.x += 1; } },
  ];
  for (const { criterion, mutate } of cases) {
    const pose = structuredClone(rollerPose(id, 0.5));
    mutate(pose);
    assert.ok(validateRollerFrame(id, 0.5, pose, start).includes(criterion), criterion);
  }
  assert.ok(validateRollerFrame(id, 0.5, start, start).includes('roller.visible-excursion'));
  const glute = structuredClone(rollerPose('glute-right', 0.5));
  glute.rightLeg.foot = { ...glute.rightLeg.foot, z: glute.rightLeg.foot.z + 1 };
  assert.ok(validateRollerFrame('glute-right', 0.5, glute, rollerPose('glute-right', 0)).includes('roller.glute-foot-knee-contact'));
  const quad = structuredClone(rollerPose('quad-left', 0.5));
  quad.left.elbow.z += 1;
  assert.ok(validateRollerFrame('quad-left', 0.5, quad, rollerPose('quad-left', 0)).includes('roller.forearms-supported'));
  const upper = structuredClone(rollerPose('upper-back', 0.5));
  upper.right.hand.x += 1;
  assert.ok(validateRollerFrame('upper-back', 0.5, upper, rollerPose('upper-back', 0)).includes('roller.hands-follow-head'));
});

test('nine recovery stages keep the unresolved outer-thigh pair held, rather than silently completing or replacing it', () => {
  assert.deepEqual(validateRecoveryStages(rollerRecoveryStages), []);
  const enabled = rollerRecoveryStages.map(stage => ({ ...stage, isStatic: false }));
  assert.ok(validateRecoveryStages(enabled).includes('recovery.held-scenes-not-playable'));
  const omitted = rollerRecoveryStages.filter(stage => !stage.id.startsWith('outer-'));
  assert.ok(validateRecoveryStages(omitted).includes('recovery.exact-order'));
  const replaced = rollerRecoveryStages.map(stage => stage.id === 'outer-left' ? { ...stage, id: 'it-band-left' } : stage);
  assert.ok(validateRecoveryStages(replaced).includes('recovery.exact-order'));
  const inert = rollerRecoveryStages.map(stage => stage.id === 'calf-left' ? { ...stage, isStatic: true } : stage);
  assert.ok(validateRecoveryStages(inert).includes('recovery.defined-scenes-moving'));
});

test('AB contract accepts only the grounded static preparation, not rollout geometry or a rollout alias', () => {
  assert.deepEqual(validateSliderPreparation(sliderReadyGeometry), []);
  assert.equal(preparationPoseId('ab-slider-ready-position'), 'ab-slider-ready-position');
  assert.equal(preparationPoseId('ab-rollout'), null);
  assert.match(preparationPoses['ab-slider-ready-position'].scope, /정지 준비 자세/);
  const rolled = structuredClone(sliderReadyGeometry) as Parameters<typeof validateSliderPreparation>[0];
  rolled.hand.x += 20; rolled.wheel.x += 20;
  assert.ok(validateSliderPreparation(rolled).includes('slider.preparation-not-rollout'));
  const floating = structuredClone(sliderReadyGeometry) as Parameters<typeof validateSliderPreparation>[0];
  floating.wheel.y -= 1;
  assert.ok(validateSliderPreparation(floating).includes('slider.wheel-floor-contact'));
  const unsupported = structuredClone(sliderReadyGeometry) as Parameters<typeof validateSliderPreparation>[0];
  unsupported.knee.y -= 1;
  assert.ok(validateSliderPreparation(unsupported).includes('slider.knee-foot-support'));
  const arched = structuredClone(sliderReadyGeometry) as Parameters<typeof validateSliderPreparation>[0];
  arched.hip.y += 1;
  assert.ok(validateSliderPreparation(arched).includes('slider.neutral-trunk-illustration'));
});
