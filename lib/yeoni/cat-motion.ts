/** PHASE 4 only: decorative motion, deliberately independent of speech. */
export function catPose(elapsedMs: number, animated = true) {
  const t = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const blinkPhase = t % 5200;
  const blink = !animated || blinkPhase < 4100 || blinkPhase >= 4440 ? 'open'
    : blinkPhase < 4180 || blinkPhase >= 4360 ? 'half' : 'closed';
  return {
    blink,
    breath: animated ? Math.sin(t / 7000 * Math.PI * 2) * 0.008 : 0,
    tailAngle: animated ? Math.sin(t / 6200 * Math.PI * 2) * 0.055 : 0,
  } as const;
}

export function canAnimate(input: {
  enabled: boolean; ready: boolean; visible: boolean; inView: boolean;
  editing: boolean; modal: boolean; reducedMotion: boolean;
}) {
  return input.enabled && input.ready && input.visible && input.inView
    && !input.editing && !input.modal && !input.reducedMotion;
}
