import { canAnimate, CharacterController, EMPTY_PLAYBACK, type CharacterEmotion, type CharacterGesture, type CharacterRenderer, type SpeechSnapshot } from './character-controller';

export type CharacterStage = { setEnabled(value: boolean): void; setEmotion(value: CharacterEmotion): void; requestGesture(value: CharacterGesture): void; cancelGesture(): void; dispose(): void };
export type CharacterStageStatus = 'loading' | 'ready' | 'error';
export type CharacterStageOptions = {
  enabled: boolean; onStatus(status: CharacterStageStatus): void;
  controller?: CharacterController;
  speech?: () => SpeechSnapshot;
};

/** DOM lifecycle host. One render loop, no phoneme mapping or engine drawing calls. */
export function mountCharacterStage(surface: HTMLElement, options: CharacterStageOptions & {
  createRenderer(ready: () => void, fail: () => void): CharacterRenderer;
}): CharacterStage {
  const controller = options.controller ?? new CharacterController();
  let enabled = options.enabled;
  let ready = false;
  let failed = false;
  let disposed = false;
  let inView = false;
  let raf: number | null = null;
  let active = false;
  let elapsed = 0;
  let lastClock: number | null = null;
  let lastDraw = -Infinity;
  let draws = 0;
  let backingSize = 400;
  let renderer: CharacterRenderer | null = null;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const frame = surface.parentElement!;

  function stop() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null; lastClock = null; active = false;
    surface.dataset.running = 'false';
  }
  function fail() {
    if (disposed || failed) return;
    failed = true; ready = false; stop(); options.onStatus('error');
  }
  function draw(animated: boolean) {
    if (!ready || disposed) return;
    try {
      const speech = options.speech?.();
      controller.setSpeech(speech?.manifest ?? null);
      const pose = controller.sample(speech?.playback ?? EMPTY_PLAYBACK, elapsed, { ...policy(), enabled: animated });
      renderer?.render(pose, { size: backingSize });
      surface.dataset.viseme = pose.viseme;
      surface.dataset.speechTimeMs = String(speech?.playback.currentTimeMs ?? 0);
      surface.dataset.draws = String(++draws);
      surface.dataset.blink = pose.blink;
      surface.dataset.emotion = pose.emotion;
      surface.dataset.gesture = pose.gesture;
      surface.dataset.gestureProgress = String(pose.gestureProgress);
      surface.dataset.headTilt = String(pose.headTilt);
      surface.dataset.headNod = String(pose.headNod);
      surface.dataset.bodyLift = String(pose.bodyLift);
    } catch { fail(); }
  }
  function policy() {
    const element = document.activeElement;
    return { enabled, ready: ready && !failed, visible: !document.hidden, inView,
      editing: element instanceof HTMLElement && (element.matches('input, textarea, select') || element.isContentEditable),
      modal: !!document.querySelector('[aria-modal="true"], dialog[open]'), reducedMotion: reduced.matches };
  }
  function tick(now: number) {
    raf = null;
    if (disposed || !active) return;
    if (lastClock !== null) elapsed += Math.min(100, Math.max(0, now - lastClock));
    lastClock = now;
    if (now - lastDraw >= 1000 / 30) { draw(true); lastDraw = now; }
    if (!failed && !disposed) raf = requestAnimationFrame(tick);
  }
  function reconcile() {
    if (disposed) return;
    const next = canAnimate(policy());
    if (!next) {
      const wasActive = active;
      stop();
      controller.cancelGesture();
      if (wasActive) draw(false);
    } else if (!active) {
      active = true; lastDraw = -Infinity;
      surface.dataset.running = 'true';
      raf = requestAnimationFrame(tick);
    }
  }
  const visibility = () => reconcile();
  const focus = () => { queueMicrotask(reconcile); };
  const updateSize = () => {
    const nextSize = Math.max(1, Math.round(frame.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 2)));
    if (nextSize === backingSize) return;
    backingSize = nextSize;
    draw(active);
  };
  const resize = new ResizeObserver(updateSize);
  const intersection = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting && entry.intersectionRatio >= 0.05; reconcile();
  }, { threshold: 0.05 });
  // Needed also while paused: a closing dialog must wake the renderer without polling.
  const modal = new MutationObserver(records => {
    if (records.some(record => record.type === 'childList' || record.attributeName === 'aria-modal' || record.attributeName === 'open')) reconcile();
  });
  resize.observe(frame); intersection.observe(frame);
  modal.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-modal', 'open'] });
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('focusin', focus);
  document.addEventListener('focusout', focus);
  window.addEventListener('resize', updateSize);
  reduced.addEventListener('change', visibility);
  options.onStatus('loading');
  try {
    renderer = options.createRenderer(() => { queueMicrotask(() => {
      if (disposed || failed) return;
      updateSize(); ready = true; draw(false);
      if (!failed) { options.onStatus('ready'); reconcile(); }
    }); }, fail);
  } catch { fail(); }
  return {
    setEnabled(value) { enabled = value; reconcile(); },
    setEmotion(value) { if (disposed) return; controller.setEmotion(value); if (!active) draw(false); },
    requestGesture(value) { if (!disposed && canAnimate(policy())) controller.requestGesture(value); },
    cancelGesture() { if (disposed) return; controller.cancelGesture(); if (!active) draw(false); },
    dispose() {
      if (disposed) return;
      disposed = true; stop();
      controller.cancelGesture();
      renderer?.dispose();
      resize.disconnect(); intersection.disconnect(); modal.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', focus);
      window.removeEventListener('resize', updateSize);
      reduced.removeEventListener('change', visibility);
    },
  };
}
