import type { DeadBugVariant, deadBugReviewPose } from '../../app/lib/deadBugReviewMotion.ts';
import type { RollerStageId, rollerPose } from '../../app/lib/rollerMotion.ts';

/** Developer-owned illustration contract. Test-only: never a personal exercise prescription. */
export const pendingMotionCriteria = {
  authority: {
    purpose: 'illustration-acceptance-only',
    personalSuitability: 'not-assessed',
    personalRange: null,
    loadTimeRepetitions: null,
    browserRequiredToDefineCriteria: false,
    appActivation: 'motion-dispatcher-unchanged',
    sources: [
      'app/data/exerciseGuides.ts',
      'docs/exercise-motion/BATCH12.md',
      'docs/exercise-motion/BATCH22.md',
      'docs/exercise-motion/BATCH23.md',
      'docs/exercise-motion/NEXT-SCOPE-REVIEW.md',
    ],
  },
  deadBug: {
    scope: 'review-and-opt-in-information',
    proposedExplanationBaseline: 'opposite-limbs',
    variants: ['opposite-limbs', 'arms-only'],
    checkpoints: [
      { progress: 0, phase: 'neutral', active: 0 },
      { progress: 0.25, phase: 'right-arm-left-leg', active: 1 },
      { progress: 0.5, phase: 'neutral', active: 0 },
      { progress: 0.75, phase: 'left-arm-right-leg', active: -1 },
      { progress: 1, phase: 'neutral', active: 0 },
    ],
    clinicalInputs: ['allowed-variant', 'preparation-tolerance', 'stop-criteria-and-range'],
  },
  slider: {
    scope: 'static-preparation-only',
    contacts: ['hands-to-handles', 'knees-to-floor', 'wheel-to-floor'],
    forbidden: ['rollout', 'playback', 'progression-prescription'],
    clinicalInputs: ['personal-suitability'],
    equipmentInputs: ['product-condition', 'stable-floor-and-grip'],
  },
  recovery: {
    scope: 'partial-nine-stage-routine',
    order: ['calf-left', 'calf-right', 'quad-left', 'quad-right', 'outer-left', 'outer-right', 'glute-left', 'glute-right', 'upper-back'],
    moving: ['calf-left', 'calf-right', 'quad-left', 'quad-right', 'glute-left', 'glute-right', 'upper-back'],
    held: ['outer-left', 'outer-right'],
    unresolved: ['target-soft-tissue', 'excluded-region', 'support-variant-and-contact-path'],
    complete: false,
  },
} as const;

type Point = { x: number; y: number; z: number };
type Point2 = { x: number; y: number };
type DeadBugPose = ReturnType<typeof deadBugReviewPose>;
type RollerPose = ReturnType<typeof rollerPose>;
export type SliderPose = Record<'shoulder' | 'hip' | 'head' | 'elbow' | 'hand' | 'knee' | 'ankle' | 'toe' | 'wheel', Point2> & {
  wheelRadius: number; floor: number;
};
type Stage = { id: string; isStatic?: boolean };

// Floating point tolerance in illustration coordinates, not a physical or clinical tolerance.
const epsilon = 1e-7;
const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const same = (a: Point, b: Point) => close(distance(a, b), 0);
const finite = (p: Point) => [p.x, p.y, p.z].every(Number.isFinite);
const arms = ['left', 'right'] as const;
const legs = ['leftLeg', 'rightLeg'] as const;
const sameArm = (a: DeadBugPose['left'], b: DeadBugPose['left']) => same(a.shoulder, b.shoulder) && same(a.elbow, b.elbow) && same(a.hand, b.hand);
const sameLeg = (a: DeadBugPose['leftLeg'], b: DeadBugPose['leftLeg']) => same(a.hip, b.hip) && same(a.knee, b.knee) && same(a.foot, b.foot);

/** Check visible sequencing/rigid geometry, never whether a person's lumbar spine is stable. */
export function validateDeadBugFrame(variant: DeadBugVariant, progress: number, pose: DeadBugPose, neutral: DeadBugPose): string[] {
  const failures: string[] = [];
  const check = (condition: boolean, criterion: string) => { if (!condition) failures.push(criterion); };
  check(Number.isFinite(progress) && progress >= 0 && progress <= 1, 'deadbug.progress-domain');
  for (const key of ['head', 'shoulder', 'hip'] as const) check(same(pose[key], neutral[key]), 'deadbug.fixed-trunk');
  for (const key of arms) {
    const a = pose[key], b = neutral[key];
    check([a.shoulder, a.elbow, a.hand].every(finite), 'deadbug.finite-points');
    check(close(distance(a.shoulder, a.elbow), distance(b.shoulder, b.elbow)) && close(distance(a.elbow, a.hand), distance(b.elbow, b.hand)), 'deadbug.rigid-arms');
    check(close(b.shoulder.x, b.hand.x) && close(b.shoulder.y, b.hand.y) && b.hand.z > b.shoulder.z, 'deadbug.arms-up-preparation');
    check(a.hand.z > 0, 'deadbug.no-floor-penetration');
  }
  for (const key of legs) {
    const a = pose[key], b = neutral[key];
    check([a.hip, a.knee, a.foot].every(finite), 'deadbug.finite-points');
    check(close(distance(a.hip, a.knee), distance(b.hip, b.knee)) && close(distance(a.knee, a.foot), distance(b.knee, b.foot)), 'deadbug.rigid-legs');
    // Existing guide's raised-thigh/right-angle knee illustration, not a patient ROM target.
    check(close(b.hip.x, b.knee.x) && close(b.hip.y, b.knee.y) && b.knee.z > b.hip.z && close(b.knee.z, b.foot.z), 'deadbug.tabletop-preparation');
    check(a.foot.z > 0, 'deadbug.no-floor-penetration');
  }
  const atNeutral = progress === 0 || progress === 0.5 || progress === 1;
  const active = atNeutral ? 0 : progress < 0.5 ? 1 : -1;
  check(pose.active === active, 'deadbug.phase-label');
  if (atNeutral) {
    check(arms.every(key => sameArm(pose[key], neutral[key])) && legs.every(key => sameLeg(pose[key], neutral[key])), 'deadbug.neutral-return');
  } else {
    const workingArm = active === 1 ? 'right' : 'left';
    const restingArm = active === 1 ? 'left' : 'right';
    const workingLeg = active === 1 ? 'leftLeg' : 'rightLeg';
    const restingLeg = active === 1 ? 'rightLeg' : 'leftLeg';
    check(sameArm(pose[restingArm], neutral[restingArm]), 'deadbug.nonworking-arm-fixed');
    check(pose[workingArm].hand.x < neutral[workingArm].hand.x - epsilon, 'deadbug.working-arm-direction');
    if (variant === 'opposite-limbs') {
      check(sameLeg(pose[restingLeg], neutral[restingLeg]), 'deadbug.nonworking-leg-fixed');
      check(pose[workingLeg].foot.x > neutral[workingLeg].foot.x + epsilon, 'deadbug.contralateral-leg-direction');
    }
  }
  if (variant === 'arms-only') check(legs.every(key => sameLeg(pose[key], neutral[key])), 'deadbug.arms-only-legs-fixed');
  return [...new Set(failures)];
}

/** The renderer's green marker bounds, in schematic units; not anatomical safe-distance limits. */
export function rollerDrawingTarget(pose: RollerPose): { from: number; to: number; surfaceHeight: number } {
  const selected = pose.side === -1 ? pose.leftLeg : pose.rightLeg;
  switch (pose.region) {
    case 'calf': return { from: selected.knee.x + 15, to: selected.foot.x - 15, surfaceHeight: selected.knee.z - pose.skin };
    case 'quad': return { from: selected.hip.x + 15, to: selected.knee.x - 15, surfaceHeight: selected.hip.z - pose.skin };
    case 'glute': return { from: selected.hip.x - 18, to: selected.hip.x + 18, surfaceHeight: selected.hip.z - pose.skin };
    case 'upper-back': return { from: pose.shoulder.x + 5, to: pose.shoulder.x + 30, surfaceHeight: pose.shoulder.z - pose.skin };
  }
}

export function validateRollerFrame(id: RollerStageId, progress: number, pose: RollerPose, start: RollerPose): string[] {
  const failures: string[] = [];
  const check = (condition: boolean, criterion: string) => { if (!condition) failures.push(criterion); };
  const expectedRegion = id.startsWith('calf') ? 'calf' : id.startsWith('quad') ? 'quad' : id.startsWith('glute') ? 'glute' : 'upper-back';
  const expectedSide = id.endsWith('left') ? -1 : 1;
  check(pose.region === expectedRegion && pose.side === expectedSide, 'roller.region-and-side');
  check(Number.isFinite(progress) && progress >= 0 && progress <= 1, 'roller.progress-domain');
  check(close(distance(pose.hip, pose.shoulder), distance(start.hip, start.shoulder)) && close(distance(pose.shoulder, pose.head), distance(start.shoulder, start.head)), 'roller.rigid-trunk');
  for (const key of arms) {
    const a = pose[key], b = start[key];
    check([a.shoulder, a.elbow, a.hand].every(finite), 'roller.finite-points');
    check(close(distance(a.shoulder, a.elbow), distance(b.shoulder, b.elbow)) && close(distance(a.elbow, a.hand), distance(b.elbow, b.hand)), 'roller.rigid-arms');
    if (expectedRegion !== 'upper-back') check(same(a.hand, b.hand), 'roller.hands-supported');
    if (expectedRegion === 'quad') check(same(a.elbow, b.elbow) && close(a.elbow.z, a.hand.z), 'roller.forearms-supported');
    if (expectedRegion === 'upper-back') {
      const offset = { x: a.hand.x - pose.head.x, y: a.hand.y - pose.head.y, z: a.hand.z - pose.head.z };
      const original = { x: b.hand.x - start.head.x, y: b.hand.y - start.head.y, z: b.hand.z - start.head.z };
      check(same(offset, original), 'roller.hands-follow-head');
    }
  }
  for (const key of legs) {
    const a = pose[key], b = start[key];
    const shouldSupport = expectedRegion === 'upper-back' || (expectedSide === -1 ? key === 'rightLeg' : key === 'leftLeg');
    check([a.hip, a.knee, a.foot].every(finite), 'roller.finite-points');
    check(close(distance(a.hip, a.knee), distance(b.hip, b.knee)) && close(distance(a.knee, a.foot), distance(b.knee, b.foot)), 'roller.rigid-legs');
    check(a.grounded === shouldSupport, 'roller.support-leg-identity');
    if (shouldSupport) check(same(a.foot, b.foot) && close(a.foot.z, pose.skin), 'roller.feet-supported');
  }
  if (expectedRegion === 'glute') {
    const working = expectedSide === -1 ? pose.leftLeg : pose.rightLeg;
    const support = expectedSide === -1 ? pose.rightLeg : pose.leftLeg;
    check(same(working.foot, support.knee), 'roller.glute-foot-knee-contact');
  }
  check(pose.roller.radius > 0 && close(pose.roller.z - pose.roller.radius, 0), 'roller.floor-contact');
  check(close(pose.contact.x, pose.roller.x) && close(pose.contact.z, pose.roller.z + pose.roller.radius), 'roller.body-contact');
  const zone = rollerDrawingTarget(pose);
  const working = expectedSide === -1 ? pose.leftLeg : pose.rightLeg;
  check(close(pose.contact.y, expectedRegion === 'upper-back' ? pose.hip.y : working.hip.y), 'roller.contact-side');
  check(pose.contact.x >= zone.from - epsilon && pose.contact.x <= zone.to + epsilon && close(pose.contact.z, zone.surfaceHeight), 'roller.target-marker-contact');
  check(Math.abs(pose.contact.y - pose.roller.y) <= pose.roller.halfWidth, 'roller.contact-within-width');
  check(close(pose.roller.angle * pose.roller.radius, -pose.shift) && close(pose.travel, 2 * pose.shift), 'roller.rolling-relation');
  check(close(pose.roller.x - start.roller.x, pose.shift) && close(pose.hip.x - start.hip.x, pose.travel), 'roller.actual-travel');
  if (progress > 0 && progress < 1) check(pose.shift > epsilon && pose.travel > epsilon, 'roller.visible-excursion');
  if (progress === 0 || progress === 1) {
    check(same(pose.hip, start.hip) && same(pose.shoulder, start.shoulder) && same(pose.head, start.head) && arms.every(key => sameArm(pose[key], start[key])) && legs.every(key => sameLeg(pose[key], start[key])) && close(pose.roller.x, start.roller.x) && close(pose.roller.angle, start.roller.angle), 'roller.cycle-return');
  }
  return [...new Set(failures)];
}

/** Painted stroke extents are part of this SVG's contact model, not equipment measurements. */
export function validateSliderPreparation(pose: SliderPose): string[] {
  const failures: string[] = [];
  const check = (condition: boolean, criterion: string) => { if (!condition) failures.push(criterion); };
  const points = [pose.shoulder, pose.hip, pose.head, pose.elbow, pose.hand, pose.knee, pose.ankle, pose.toe, pose.wheel];
  check(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)), 'slider.finite-points');
  check(close(pose.shoulder.y, pose.hip.y) && close(pose.head.y, pose.shoulder.y), 'slider.neutral-trunk-illustration');
  check(close(pose.hand.x, pose.wheel.x) && close(pose.hand.y, pose.wheel.y), 'slider.hand-handle-contact');
  check(close(pose.shoulder.x, pose.hand.x) && close(pose.hip.x, pose.knee.x), 'slider.preparation-not-rollout');
  check(pose.wheelRadius > 0 && close(pose.wheel.y + pose.wheelRadius + 1.5, pose.floor), 'slider.wheel-floor-contact');
  check(close(pose.knee.y + 5, pose.floor) && close(pose.toe.y + 5, pose.floor), 'slider.knee-foot-support');
  return failures;
}

/** Do not let a held scene silently become a complete or differently named routine. */
export function validateRecoveryStages(stages: readonly Stage[]): string[] {
  const failures: string[] = [];
  if (JSON.stringify(stages.map(stage => stage.id)) !== JSON.stringify(pendingMotionCriteria.recovery.order)) failures.push('recovery.exact-order');
  for (const id of pendingMotionCriteria.recovery.held) {
    if (stages.find(stage => stage.id === id)?.isStatic !== true) failures.push('recovery.held-scenes-not-playable');
  }
  for (const id of pendingMotionCriteria.recovery.moving) {
    const stage = stages.find(stage => stage.id === id);
    if (!stage || stage.isStatic === true) failures.push('recovery.defined-scenes-moving');
  }
  return [...new Set(failures)];
}
