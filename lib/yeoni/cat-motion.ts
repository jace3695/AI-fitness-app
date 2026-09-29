import { CharacterController, EMPTY_PLAYBACK } from './character-controller.ts';
export { canAnimate } from './character-controller.ts';
const controller = new CharacterController();
/** Compatibility for PHASE 4 motion consumers; common controller owns the pose. */
export function catPose(elapsedMs: number, animated = true) {
  const frame = controller.sample(EMPTY_PLAYBACK, elapsedMs, { enabled: animated, ready: true,
    visible: true, inView: true, editing: false, modal: false, reducedMotion: false });
  return { blink: frame.blink, breath: frame.breath, tailAngle: frame.sway * .055 } as const;
}
