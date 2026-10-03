import { createAppearanceRenderer, type AppearanceRenderer, type AppearanceState, type CharacterAppearance } from './appearance-renderer';
import { mountCharacterStage, type CharacterStage, type CharacterStageOptions } from './character-stage';
import { createCatCanvasRenderer } from './cat-renderer';
import { createHumanCanvasRenderer } from './human-renderer';
import { CAT_MOTION_ASSET } from './cat-art';

export type AppearanceStage = CharacterStage & { setAppearance(value: CharacterAppearance): void };

/** One host, Controller and idle clock for the entire lifetime of the character. */
export function mountAppearanceStage(surface: HTMLCanvasElement, options: CharacterStageOptions & {
  appearance: CharacterAppearance; catAsset?: string; humanAssets?: Record<string, string>;
  onAppearance(state: AppearanceState): void;
}): AppearanceStage {
  let renderer: AppearanceRenderer | null = null;
  const stage = mountCharacterStage(surface, { ...options, createRenderer: (ready, fail) => {
    renderer = createAppearanceRenderer(surface, {
      initial: options.appearance, ready, fail, invalidate: () => stage.redraw(), onChange: options.onAppearance,
      create: (appearance, canvas, loaded, error) => appearance === 'cat'
        ? createCatCanvasRenderer(canvas, { assetUrl: options.catAsset ?? CAT_MOTION_ASSET, speechMouth: !!options.speech, expressive: true, ready: loaded, fail: error })
        : createHumanCanvasRenderer(canvas, { assetUrls: options.humanAssets, ready: loaded, fail: error }),
    });
    return renderer;
  } });
  return { ...stage, setAppearance(value) { renderer?.setAppearance(value); } };
}
