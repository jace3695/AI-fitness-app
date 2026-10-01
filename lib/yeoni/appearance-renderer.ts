import type { CharacterRenderer } from './character-controller';

export type CharacterAppearance = 'cat' | 'human';
export type AppearanceState = Readonly<{
  appearance: CharacterAppearance | null;
  requested: CharacterAppearance;
  status: 'loading' | 'ready' | 'error';
}>;
export type AppearanceFactory = (appearance: CharacterAppearance, canvas: HTMLCanvasElement,
  ready: () => void, fail: () => void) => CharacterRenderer;
export type AppearanceRenderer = CharacterRenderer & { setAppearance(value: CharacterAppearance): void };

/** Asset preparation has no Controller, media clock or animation loop.
 * Private canvases let failed/superseded loads be discarded without clearing the visible frame. */
export function createAppearanceRenderer(surface: HTMLCanvasElement, options: {
  initial: CharacterAppearance; create: AppearanceFactory;
  ready(): void; fail(): void; invalidate(): void; onChange(state: AppearanceState): void;
}): AppearanceRenderer {
  const ctx = surface.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  type Slot = { appearance: CharacterAppearance; canvas: HTMLCanvasElement; renderer: CharacterRenderer | null; ready: boolean };
  let active: Slot | null = null, pending: Slot | null = null, disposed = false, started = false;
  let requested = options.initial;
  const notify = (status: AppearanceState['status']) => {
    if (!disposed) options.onChange({ appearance: active?.appearance ?? null, requested, status });
  };
  function reject(slot: Slot) {
    if (disposed) return;
    if (slot === pending) { pending = null; slot.renderer?.dispose(); notify('error'); }
    else if (slot === active) { notify('error'); options.fail(); }
  }
  function setAppearance(value: CharacterAppearance) {
    if (disposed || (value !== 'cat' && value !== 'human')) return;
    requested = value;
    if (pending?.appearance === value) return;
    pending?.renderer?.dispose(); pending = null;
    if (active?.appearance === value) { notify('ready'); return; }
    const slot: Slot = { appearance: value, canvas: document.createElement('canvas'), renderer: null, ready: false };
    pending = slot; notify('loading');
    // Factories may finish synchronously. Defer callbacks until their returned handle is owned.
    try {
      slot.renderer = options.create(value, slot.canvas, () => queueMicrotask(() => {
        if (disposed || slot !== pending || slot.ready) return;
        slot.ready = true;
        if (!started) { started = true; options.ready(); }
        else options.invalidate();
      }), () => queueMicrotask(() => reject(slot)));
    } catch { reject(slot); }
  }
  const lost = () => { if (!disposed) options.fail(); };
  surface.addEventListener('contextlost', lost);
  setAppearance(requested);
  return {
    setAppearance,
    render(frame, viewport) {
      if (disposed) return;
      const candidate = pending?.ready ? pending : null;
      let next = candidate ?? active;
      if (!next) return;
      try { next.renderer?.render(frame, viewport); }
      catch (error) {
        if (!candidate) throw error;
        reject(candidate); next = active;
        if (!next) return;
        next.renderer?.render(frame, viewport);
      }
      const source = next.canvas;
      if (surface.width !== source.width || surface.height !== source.height) {
        surface.width = source.width; surface.height = source.height;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, surface.width, surface.height); ctx.drawImage(source, 0, 0);
      for (const key of ['artVersion', 'eyeArtwork', 'mouthArtwork']) {
        if (source.dataset[key]) surface.dataset[key] = source.dataset[key];
        else delete surface.dataset[key];
      }
      surface.dataset.appearance = next.appearance;
      if (next === pending) {
        const previous = active; active = next; pending = null;
        previous?.renderer?.dispose(); notify('ready');
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; pending?.renderer?.dispose(); active?.renderer?.dispose(); pending = active = null;
      surface.removeEventListener('contextlost', lost);
      ctx.clearRect(0, 0, surface.width, surface.height);
    },
  };
}
