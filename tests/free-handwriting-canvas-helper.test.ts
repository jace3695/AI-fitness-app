import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import type { FreeCanvasCheckpoint } from './e2e/free-handwriting-canvas';

const owner = 'synthetic-owner';
function record(strokes = 0) {
  return { owner, state: 'active', kind: 'free-handwriting-v1', attemptId: 'synthetic-attempt', resetMarker: null, revision: strokes + 1,
    historyIndex: strokes, guideIndex: 0, guideText: 'synthetic guide', inkColor: '#242231', pending: null,
    frames: Array.from({ length: strokes + 1 }, (_, index) => ({ raster: { width: 2, height: 2, sha256: String(index).repeat(64), pixels: new Uint8ClampedArray(16) }, evidence: { strokes: index, activeMs: index * 25, pressureRange: null } })) };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function harness() {
  const events: string[] = [];
  const state = { record: record() as unknown, reads: [] as unknown[], ready: null as ReturnType<typeof deferred> | null,
    missingDatabase: false, databaseCreated: false, upgradeAborted: false, readError: null as Error | null, draws: 0,
    afterDraw: record(1) as unknown, drawError: null as Error | null, image: 'blank', changePixels: true };
  type Request = { result?: unknown; error?: Error; transaction?: { abort(): void }; onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void };
  const indexedDB = { open(name: string, version: number) {
    assert.equal(name, 'yeoni-free-handwriting'); assert.equal(version, 1); events.push('open');
    const open: Request = {};
    const db = { objectStoreNames: { contains: (store: string) => store === 'slots' }, close() { events.push('close'); },
      transaction(store: string, mode?: string) {
        assert.equal(store, 'slots'); assert.equal(mode, undefined, 'The reader must use a read-only transaction');
        const tx = { error: state.readError, oncomplete: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined, onabort: undefined as (() => void) | undefined,
          objectStore(name: string) { assert.equal(name, 'slots'); return { get(key: string) {
            assert.equal(key, `${owner}:free-handwriting-v1`); events.push('read');
            return { result: state.reads.length ? state.reads.shift() : state.record };
          } }; } };
        queueMicrotask(() => { if (tx.error) tx.onerror?.(); else tx.oncomplete?.(); }); return tx;
      } };
    queueMicrotask(() => {
      if (state.missingDatabase) {
        open.transaction = { abort() { state.upgradeAborted = true; } }; open.onupgradeneeded?.();
        if (state.upgradeAborted) { open.error = new Error('upgrade aborted'); open.onerror?.(); return; }
        state.databaseCreated = true;
      }
      open.result = db; open.onsuccess?.();
    });
    return open;
  } };
  const canvas = { async evaluate(fn: (node: unknown) => unknown) { return fn({ toDataURL: (mime: string) => { assert.equal(mime, 'image/png'); return state.image; } }); } };
  const page = {
    getByLabel(name: string, options: { exact: boolean }) { assert.equal(name, '손글씨 연습장'); assert.equal(options.exact, true); return canvas; },
    getByRole(role: string, options: { name: string; exact: boolean }) { assert.equal(role, 'button'); assert.equal(options.name, '다른 문장'); assert.equal(options.exact, true); return 'ready-control'; },
    evaluate(fn: (id: string) => unknown, id: string) { return fn(id); },
  };
  const expect = Object.assign((value: unknown) => ({
    async toBeVisible() { assert.equal(value, canvas); events.push('visible'); },
    async toBeEnabled() { assert.equal(value, 'ready-control'); events.push('ready-wait'); await state.ready?.promise; events.push('ready'); },
    toEqual(expected: unknown) { assert.equal(JSON.stringify(value), JSON.stringify(expected)); },
    not: { toBe(expected: unknown) { assert.notEqual(value, expected); } },
  }), { poll(read: () => Promise<unknown>) { return { async toBe(expected: unknown) {
    for (let i = 0; i < 4; i++) if (await read() === expected) return;
    assert.fail('The required durable checkpoint did not occur');
  } }; } });
  const drawVisibleCanvasStroke = async (candidate: unknown, locator: unknown, offset: number) => {
    assert.equal(candidate, page); assert.equal(locator, canvas); assert.equal(offset, 20); events.push('real-gesture'); state.draws++;
    if (state.drawError) throw state.drawError;
    state.reads = [state.record, state.afterDraw]; state.record = state.afterDraw;
    if (state.changePixels) state.image = 'one-stroke';
  };
  const source = ts.transpileModule(readFileSync(new URL('./e2e/free-handwriting-canvas.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {} as typeof import('./e2e/free-handwriting-canvas');
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { indexedDB, Error })(exports, (name: string) => {
    if (name === '@playwright/test') return { expect };
    assert.equal(name, './handwriting-canvas'); return { drawVisibleCanvasStroke };
  });
  return { state, events, api: exports, page: page as unknown as Parameters<typeof exports.readFreeCanvasCheckpoint>[0] };
}

test('readiness waits for editable UI and the initial durable frame before returning a checkpoint', async () => {
  const qa = harness(), gate = deferred(); qa.state.ready = gate; qa.state.reads = [null, record()];
  const ready = qa.api.waitForEmptyFreeCanvas(qa.page, owner); await Promise.resolve(); await Promise.resolve();
  assert.equal(qa.events.includes('open'), false); assert.equal(qa.state.draws, 0);
  gate.resolve(); const checkpoint = await ready;
  assert.equal(checkpoint.historyIndex, 0); assert.equal(checkpoint.frames.length, 1); assert.equal(qa.events.filter(x => x === 'read').length, 2);
  assert.equal(qa.state.draws, 0);
});
test('checkpoint reader aborts missing database creation and never creates a store', async () => {
  const qa = harness(); qa.state.missingDatabase = true;
  await assert.rejects(qa.api.readFreeCanvasCheckpoint(qa.page, owner), /upgrade aborted/);
  assert.equal(qa.state.upgradeAborted, true); assert.equal(qa.state.databaseCreated, false); assert.equal(qa.events.includes('read'), false);
});
test('read errors and malformed frame projection reject rather than yielding an empty success', async () => {
  const qa = harness(), failure = new Error('synthetic read failure'); qa.state.readError = failure;
  await assert.rejects(qa.api.readFreeCanvasCheckpoint(qa.page, owner), error => error === failure);
  qa.state.readError = null; qa.state.record = { ...record(), frames: [null] };
  await assert.rejects(qa.api.readFreeCanvasCheckpoint(qa.page, owner));
  qa.state.record = { ...record(), owner: 'different-owner' }; assert.equal(await qa.api.readFreeCanvasCheckpoint(qa.page, owner), null);
});
test('one real gesture waits for its exact appended durable frame and changed pixels without redrawing', async () => {
  const qa = harness(), before = await qa.api.readFreeCanvasCheckpoint(qa.page, owner);
  const after = await qa.api.drawCheckpointedFreeCanvasStroke(qa.page, before!, 20);
  assert.equal(qa.state.draws, 1); assert.equal(after.checkpoint.frames[1].evidence.strokes, 1); assert.equal(after.image, 'one-stroke');
  assert.equal(qa.events.filter(x => x === 'read').length, 4);
});
test('missing or changed pre-gesture checkpoint cannot cause a drawing action', async () => {
  for (const change of [null, { ...record(), attemptId: 'another-attempt' }, { ...record(), resetMarker: 'new-reset' }, { ...record(), revision: 9 }]) {
    const qa = harness(), before = await qa.api.readFreeCanvasCheckpoint(qa.page, owner); qa.state.record = change;
    await assert.rejects(qa.api.drawCheckpointedFreeCanvasStroke(qa.page, before!, 20)); assert.equal(qa.state.draws, 0);
  }
});
test('changed owner, attempt, reset, prior history or missing checkpoint cannot satisfy a gesture', async () => {
  const changedHistory = record(1); changedHistory.frames[0].raster.sha256 = 'changed-history';
  for (const change of [null, { ...record(1), owner: 'other-owner' }, { ...record(1), attemptId: 'other-attempt' }, { ...record(1), resetMarker: 'new-reset' }, changedHistory]) {
    const qa = harness(), before = await qa.api.readFreeCanvasCheckpoint(qa.page, owner); qa.state.afterDraw = change;
    await assert.rejects(qa.api.drawCheckpointedFreeCanvasStroke(qa.page, before!, 20)); assert.equal(qa.state.draws, 1);
  }
});
test('unchanged pixels and native gesture failure remain failures and never trigger a retry', async () => {
  const qa = harness(), before = await qa.api.readFreeCanvasCheckpoint(qa.page, owner); qa.state.changePixels = false;
  await assert.rejects(qa.api.drawCheckpointedFreeCanvasStroke(qa.page, before!, 20)); assert.equal(qa.state.draws, 1);
  const other = harness(), starting = await other.api.readFreeCanvasCheckpoint(other.page, owner), failure = new Error('hit-test failure'); other.state.drawError = failure;
  await assert.rejects(other.api.drawCheckpointedFreeCanvasStroke(other.page, starting!, 20), error => error === failure); assert.equal(other.state.draws, 1);
});
test('stroke predicate rejects a rewritten prior evidence frame and unchanged raster hash', async () => {
  const qa = harness(), before = await qa.api.readFreeCanvasCheckpoint(qa.page, owner); qa.state.record = record(1);
  const after = await qa.api.readFreeCanvasCheckpoint(qa.page, owner) as FreeCanvasCheckpoint;
  assert.equal(qa.api.oneFreeStrokeAfter(before!, after), true);
  const changed = structuredClone(after); changed.frames[0].evidence.activeMs = 999;
  assert.equal(qa.api.oneFreeStrokeAfter(before!, changed), false);
  after.frames[1].raster.sha256 = before!.frames[0].raster.sha256;
  assert.equal(qa.api.oneFreeStrokeAfter(before!, after), false);
});
