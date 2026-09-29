import { canAnimate, catPose } from './cat-motion';

export type CatRenderer = { setEnabled(value: boolean): void; dispose(): void };
export type CatRendererStatus = 'loading' | 'ready' | 'error';

/** Owns one canvas, one image, and at most one animation-frame callback. No audio/network APIs. */
export function mountCatRenderer(canvas: HTMLCanvasElement, options: {
  enabled: boolean; assetUrl: string; onStatus(status: CatRendererStatus): void;
}): CatRenderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    options.onStatus('error');
    return { setEnabled() {}, dispose() {} };
  }
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
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const image = new Image();
  const frame = canvas.parentElement!;

  function stop() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null; lastClock = null; active = false;
    canvas.dataset.running = 'false';
  }
  function fail() {
    if (disposed || failed) return;
    failed = true; ready = false; stop(); options.onStatus('error');
  }
  function part(s: number[], d: number[]) {
    ctx!.drawImage(image, s[0], s[1], s[2], s[3], d[0], d[1], d[2], d[3]);
  }
  function draw(animated: boolean) {
    if (!ready || disposed) return;
    try {
      const size = backingSize;
      if (canvas.width !== size || canvas.height !== size) { canvas.width = size; canvas.height = size; }
      ctx!.setTransform(size / 400, 0, 0, size / 400, 0, 0);
      ctx!.clearRect(0, 0, 400, 400);
      const pose = catPose(elapsed, animated);
      ctx!.save();
      ctx!.translate(170, 340); ctx!.scale(1 + pose.breath * 0.4, 1 + pose.breath); ctx!.translate(-170, -340);
      // Tail is behind the complete body; its base remains occluded throughout the motion.
      ctx!.save(); ctx!.translate(262, 291); ctx!.rotate(pose.tailAngle); ctx!.translate(-262, -291);
      part([800, 820, 425, 400], [240, 178, 128, 121]);
      ctx!.restore();
      part([0, 0, 660, 805], [35, 18, 264, 322]);
      if (pose.blink === 'closed') part([135, 1000, 395, 90], [89, 148, 153, 35]);
      else {
        const height = pose.blink === 'half' ? 25 : 54;
        part([790, 355, 325, 135], [90, 159 - height / 2, 151, height]);
      }
      ctx!.restore();
      // Read-only diagnostics for the isolated browser lab; no React state per frame.
      canvas.dataset.draws = String(++draws);
      canvas.dataset.blink = pose.blink;
    } catch { fail(); }
  }
  function eligible() {
    const element = document.activeElement;
    return canAnimate({ enabled, ready: ready && !failed, visible: !document.hidden, inView,
      editing: element instanceof HTMLElement && (element.matches('input, textarea, select') || element.isContentEditable),
      modal: !!document.querySelector('[aria-modal="true"], dialog[open]'), reducedMotion: reduced.matches });
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
    const next = eligible();
    if (!next) {
      const wasActive = active;
      stop();
      if (wasActive) draw(false);
    } else if (!active) {
      active = true; lastDraw = -Infinity;
      canvas.dataset.running = 'true';
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
  canvas.addEventListener('contextlost', fail);
  image.onload = () => {
    if (disposed) return;
    if (image.naturalWidth !== 1254 || image.naturalHeight !== 1254) { fail(); return; }
    // Seed dimensions before the first paint; a late initial ResizeObserver
    // notification must not repaint an unchanged, paused canvas (WebKit).
    updateSize(); ready = true; draw(false);
    if (!failed) { options.onStatus('ready'); reconcile(); }
  };
  image.onerror = fail;
  options.onStatus('loading'); image.src = options.assetUrl;
  return {
    setEnabled(value) { enabled = value; reconcile(); },
    dispose() {
      if (disposed) return;
      disposed = true; stop();
      image.onload = null; image.onerror = null; image.removeAttribute('src');
      resize.disconnect(); intersection.disconnect(); modal.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', focus);
      window.removeEventListener('resize', updateSize);
      reduced.removeEventListener('change', visibility);
      canvas.removeEventListener('contextlost', fail);
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
