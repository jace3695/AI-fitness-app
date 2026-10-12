import { expect, type Page } from '@playwright/test';
import type { FreeDraft } from '../../lib/free-handwriting-draft';
import { drawVisibleCanvasStroke } from './handwriting-canvas';

export type FreeCanvasCheckpoint = Pick<FreeDraft, 'owner' | 'attemptId' | 'resetMarker' | 'revision' | 'historyIndex' | 'guideIndex' | 'guideText' | 'inkColor'> & {
  pending: boolean;
  frames: { raster: Pick<FreeDraft['frames'][number]['raster'], 'width' | 'height' | 'sha256'>; evidence: FreeDraft['frames'][number]['evidence'] }[];
};
const canvas = (page: Page) => page.getByLabel('손글씨 연습장', { exact: true });
export const freeCanvasPixels = (page: Page) => canvas(page).evaluate(node => (node as HTMLCanvasElement).toDataURL('image/png'));

/** Read only the initialized owner slot; never seed, repair or rewrite a draft. */
export async function readFreeCanvasCheckpoint(page: Page, owner: string): Promise<FreeCanvasCheckpoint | null> {
  return page.evaluate(id => new Promise<FreeCanvasCheckpoint | null>((resolve, reject) => {
    const open = indexedDB.open('yeoni-free-handwriting', 1);
    open.onupgradeneeded = () => { open.transaction?.abort(); };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(Error('free_canvas_checkpoint_blocked'));
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('slots')) { db.close(); resolve(null); return; }
      const tx = db.transaction('slots'), read = tx.objectStore('slots').get(`${id}:free-handwriting-v1`);
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      tx.oncomplete = () => {
        db.close();
        try {
          const record = read.result as FreeDraft | undefined;
          if (record?.state !== 'active' || record.owner !== id || record.kind !== 'free-handwriting-v1') { resolve(null); return; }
          resolve({ owner: record.owner, attemptId: record.attemptId, resetMarker: record.resetMarker, revision: record.revision,
            historyIndex: record.historyIndex, guideIndex: record.guideIndex, guideText: record.guideText, inkColor: record.inkColor, pending: !!record.pending,
            frames: record.frames.map(frame => ({ raster: { width: frame.raster.width, height: frame.raster.height, sha256: frame.raster.sha256 }, evidence: frame.evidence })) });
        } catch (error) { reject(error); }
      };
    };
  }), owner);
}

export async function waitForEmptyFreeCanvas(page: Page, owner: string): Promise<FreeCanvasCheckpoint> {
  await expect(canvas(page)).toBeVisible();
  await expect(page.getByRole('button', { name: '다른 문장', exact: true })).toBeEnabled();
  let checkpoint: FreeCanvasCheckpoint | null = null;
  await expect.poll(async () => {
    checkpoint = await readFreeCanvasCheckpoint(page, owner);
    return !!checkpoint && !checkpoint.pending && checkpoint.historyIndex === 0 && checkpoint.frames.length === 1 && checkpoint.frames[0].evidence.strokes === 0;
  }, { message: 'The initialized empty owner draft must be durable before the first real pointer stroke.' }).toBe(true);
  return checkpoint!;
}

export function oneFreeStrokeAfter(before: FreeCanvasCheckpoint, after: FreeCanvasCheckpoint | null): boolean {
  if (!after || before.pending || after.pending || after.revision <= before.revision) return false;
  const identity = ({ revision: _revision, historyIndex: _index, frames: _frames, ...value }: FreeCanvasCheckpoint) => value;
  if (JSON.stringify(identity(before)) !== JSON.stringify(identity(after))) return false;
  const prior = before.frames.slice(0, before.historyIndex + 1), previous = prior.at(-1), last = after.frames.at(-1);
  return !!previous && !!last && after.historyIndex === before.historyIndex + 1 && after.frames.length === prior.length + 1
    && JSON.stringify(after.frames.slice(0, -1)) === JSON.stringify(prior)
    && last.evidence.strokes === previous.evidence.strokes + 1 && last.raster.sha256 !== previous.raster.sha256;
}

/** Exactly one real gesture; polling observes its checkpoint and never redraws. */
export async function drawCheckpointedFreeCanvasStroke(page: Page, before: FreeCanvasCheckpoint, offset = 0) {
  expect(await readFreeCanvasCheckpoint(page, before.owner), 'The same complete history must still be current before pointer input.').toEqual(before);
  const pixels = await freeCanvasPixels(page);
  await drawVisibleCanvasStroke(page, canvas(page), offset);
  let checkpoint: FreeCanvasCheckpoint | null = null;
  await expect.poll(async () => {
    checkpoint = await readFreeCanvasCheckpoint(page, before.owner);
    return oneFreeStrokeAfter(before, checkpoint);
  }, { message: 'The single real gesture must append one durable frame to the same owner, attempt and reset generation.' }).toBe(true);
  const image = await freeCanvasPixels(page); expect(image).not.toBe(pixels);
  return { checkpoint: checkpoint!, image };
}
