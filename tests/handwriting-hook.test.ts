import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as drafts from '../lib/handwriting-draft.ts';
import * as saveBoundary from '../lib/handwriting-save.ts';
import * as course from '../app/data/handwritingCourse.ts';
import { handwritingVersion } from '../lib/handwriting-local-store.ts';
import { HANDWRITING_PACKAGE_FORMAT, handwritingMaterialPath } from '../app/data/handwritingMaterials.ts';
import type { GrowthRoutineRow } from '../app/data/growthPlatform.ts';
const owner = '00000000-0000-4000-8000-000000000811', other = '00000000-0000-4000-8000-000000000812';
const routine = { id: '00000000-0000-4000-8000-000000000813', user_id: owner, category: 'handwriting' } as GrowthRoutineRow;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function environment() {
  return { owner, storage: new Map<string, drafts.HandwritingRecord>(), sessions: new Map<string, unknown>(), resources: new Map<string, unknown>(), objects: new Map<string, Blob>(),
    marker: null as string | null, failMarker: false, failReads: false, progressFails: false, failCommit: false, missingRpc: false, quota: false, terminalFail: false, terminalReadbackFail: false, failMarkerAfterTerminal: false,
    payloads: [] as drafts.FrozenHandwritingSave['session'][], calls: [] as string[], beforeRpc: null as (() => void) | null,
    afterRpc: null as (() => void) | null, blockWrite: null as { arrived: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null, localQueue: Promise.resolve() };
}
class SyntheticImageData { data: Uint8ClampedArray; width: number; height: number; constructor(data: Uint8ClampedArray, width: number, height: number) { this.data = data; this.width = width; this.height = height; } }
function fixture(env = environment(), id = owner) {
  const slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  const stateChanges = new Set<() => void>();
  const events = new Map<string, Set<(...args: unknown[]) => void>>(); let cursor = 0, allowReset = false;
  const storage = {
    handwritingVersion,
    async readHandwritingRecord(candidate: string) { return drafts.parseHandwritingRecord(structuredClone(env.storage.get(candidate)), candidate); },
    async writeHandwritingRecord(record: drafts.HandwritingRecord, expected: { revision: number; attemptId: string } | null) {
      const next = { ...record, revision: (expected?.revision ?? 0) + 1 }; await drafts.parseHandwritingRecord(next, record.owner);
      const run = env.localQueue.then(async () => {
        if (env.blockWrite) { env.blockWrite.arrived.resolve(); await env.blockWrite.release.promise; }
        if (env.quota || env.terminalFail && record.state !== 'active') throw Error('quota');
        const local = env.storage.get(record.owner);
        if (expected ? local?.revision !== expected.revision || local.attemptId !== expected.attemptId : !!local) throw Error('handwriting_draft_changed');
        env.storage.set(record.owner, structuredClone(next));
        if (record.state === 'confirmed') {
          if (env.failMarkerAfterTerminal) env.failMarker = true;
          if (env.terminalReadbackFail) throw Error('readback offline');
        }
        return next;
      }); env.localQueue = run.then(() => {}, () => {}); return run;
    },
  };
  const modules = {
    react: {
      useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], (value: unknown) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; stateChanges.forEach(notify => notify()); }]; },
      useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
      useEffect(effect: () => void, deps?: unknown[]) { const slot = cursor++; const old = slots[slot] as unknown[] | undefined; if (!deps || !old || old.some((value, index) => value !== deps[index])) { slots[slot] = deps; effects.push(() => { cleanups[slot]?.(); const cleanup = effect(); if (typeof cleanup === 'function') cleanups[slot] = cleanup; }); } },
    },
    '@/app/lib/supabase': { supabase: {
      auth: { getUser: async () => ({ data: { user: { id: env.owner } }, error: null }) },
      from(table: string) {
        const filters: Record<string, string> = {};
        const execute = async () => {
          if (table === 'user_app_state') return { data: { state: { 'ai-fitness-record-reset-growth': env.marker } }, error: env.failMarker ? Error('marker offline') : null };
          if (!filters.id) return { data: [...env.sessions.values()], error: env.progressFails ? Error('progress offline') : null };
          env.calls.push(`read:${table}`);
          return { data: (table === 'growth_sessions' ? env.sessions : env.resources).get(filters.id) ?? null, error: env.failReads ? Error('offline') : null };
        };
        const query = { select() { return query; }, eq(key: string, value: string) { filters[key] = value; return query; }, contains() { return query; }, order() { return query; }, range() { return query; }, abortSignal() { return query; }, maybeSingle: execute, then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); } }; return query;
      },
      storage: { from() { return {
        download: async (path: string) => ({ data: env.objects.get(path) ?? null, error: env.objects.has(path) ? null : { code: 'NoSuchKey' } }),
        upload: async (path: string, blob: Blob, options: { upsert: boolean }) => { assert.equal(options.upsert, false); assert.ok((env.storage.get(id) as drafts.HandwritingDraft).pending); env.calls.push('upload'); env.objects.set(path, blob); return { error: null }; },
      }; } },
      rpc(name: string, args: { p_session: drafts.HandwritingSession; p_resource: drafts.HandwritingResource | null; p_expected_owner: string; p_expected_reset_marker: string | null }) {
        assert.equal(name, 'save_handwriting_attempt');
        const execute = async () => {
          assert.ok((env.storage.get(id) as drafts.HandwritingDraft).pending, 'stage before remote mutation');
          env.calls.push('rpc'); env.payloads.push(structuredClone(args.p_session)); env.beforeRpc?.();
          if (env.missingRpc) return { error: { code: 'PGRST202' } };
          if (args.p_expected_owner !== env.owner) return { error: { message: 'handwriting_owner_changed' } };
          if (args.p_expected_reset_marker !== env.marker) return { error: { message: 'handwriting_reset_changed' } };
          if (!env.failCommit) { env.sessions.set(args.p_session.id, structuredClone(args.p_session)); if (args.p_resource) env.resources.set(args.p_resource.id, structuredClone(args.p_resource)); }
          env.afterRpc?.(); return { error: env.failCommit ? Error('offline') : null };
        };
        const query = { abortSignal() { return query; }, then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); } }; return query;
      },
    } },
    '@/app/data/appRecordReset': { RECORD_RESET_EVENT: 'record-reset', RECORD_RESET_STORAGE_EVENT: 'record-reset-storage', isRecordResetRunning: () => false, resetMarkerKey: () => 'ai-fitness-record-reset-growth' },
    '@/app/data/handwritingCourse': course, '@/app/data/handwritingMaterials': { HANDWRITING_PACKAGE_FORMAT, handwritingMaterialPath }, '@/utils/dateKey': { getLocalDateKey: () => '2026-10-09' }, '@/lib/handwriting-draft': drafts, '@/lib/handwriting-local-store': storage, '@/lib/handwriting-save': saveBoundary,
  };
  const exports = {} as typeof import('../app/growth/handwriting/useHandwritingPractice');
  const source = ts.transpileModule(readFileSync(new URL('../app/growth/handwriting/useHandwritingPractice.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const eventTarget = { addEventListener(name: string, callback: (...args: unknown[]) => void) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(callback); }, removeEventListener(name: string, callback: (...args: unknown[]) => void) { events.get(name)?.delete(callback); } };
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { Error, AbortSignal, Date, crypto, performance, structuredClone, ImageData: SyntheticImageData, Uint8ClampedArray, setTimeout, clearTimeout,
    window: { ...eventTarget, confirm: () => allowReset }, document: { ...eventTarget, visibilityState: 'visible' },
  })(exports, (name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name as keyof typeof modules]; });
  const isOwnerActive = (candidate: string) => env.owner === candidate;
  const render = () => { cursor = 0; const result = exports.useHandwritingPractice(id, isOwnerActive); effects.splice(0).forEach(effect => effect()); return result; };
  render();
  return { env, render, unmount: () => cleanups.forEach(cleanup => cleanup?.()), allowReset: () => { allowReset = true; }, events,
    async ready() {
      // WebCrypto completes on a worker thread. A fixed number of event-loop
      // turns is not a readiness condition, especially beside the SQL suite.
      for (;;) {
        const changed = deferred(); stateChanges.add(changed.resolve);
        const result = render();
        if (result.ready || result.loadError) { stateChanges.delete(changed.resolve); await tick(); return render(); }
        await changed.promise; stateChanges.delete(changed.resolve);
      }
    } };
}
function attachCanvas(qa: ReturnType<typeof fixture>) {
  let pixels = new Uint8ClampedArray(16), blobCallback: ((blob: Blob | null) => void) | null = null;
  const blobStarted = deferred();
  const ctx = { getImageData: () => new SyntheticImageData(new Uint8ClampedArray(pixels), 2, 2), putImageData: (image: SyntheticImageData) => { pixels = new Uint8ClampedArray(image.data); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { pixels[0]++; } };
  const canvas = { width: 2, height: 2, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: 2, height: 2 }), setPointerCapture() {}, toBlob(callback: (blob: Blob | null) => void) { blobCallback = callback; blobStarted.resolve(); } };
  qa.render().canvasRef.current = canvas as unknown as HTMLCanvasElement;
  return { canvas, pixels: () => pixels, finishBlob: (value: Blob | null) => { assert.ok(blobCallback); blobCallback(value); },
    async waitForBlob(saving: Promise<void>) {
      await Promise.race([blobStarted.promise, saving.then(() => { assert.ok(blobCallback, `Save finished before PNG encoding began: ${qa.render().notice}`); })]);
    } };
}
async function seedScreen(env: ReturnType<typeof environment>, pending = false) {
  const d = drafts.emptyHandwritingDraft(owner, null, course.HANDWRITING_LESSONS[5]); d.mode = 'screen'; d.checks = [true, true]; d.strokes = 2; d.activeMs = 1200.5; d.reflection = '복구 화면';
  d.worksheet = { path: handwritingMaterialPath(owner, 'page-07.webp'), version: HANDWRITING_PACKAGE_FORMAT, sha256: 'a'.repeat(64) };
  d.raster = await drafts.freezeRaster(2, 2, new Uint8ClampedArray([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]));
  d.undo = [{ raster: await drafts.freezeRaster(2, 2, new Uint8ClampedArray(16)), strokes: 1, activeMs: 200 }];
  if (pending) { const png = new Blob(['synthetic PNG'], { type: 'image/png' }); d.pending = drafts.makeHandwritingSave(d, routine.id, '2026-10-09', '2026-10-09T12:00:00.000Z', crypto.randomUUID(), crypto.randomUUID(), png, await drafts.hashBytes(png)); }
  d.revision = 1; env.storage.set(owner, d); return d;
}
async function paper(qa: ReturnType<typeof fixture>) {
  await qa.ready(); const d = qa.render().draft;
  qa.render().prepareSheet('', { path: handwritingMaterialPath(owner, `page-${String(d.lesson.pdfPage).padStart(2, '0')}.webp`), version: HANDWRITING_PACKAGE_FORMAT, sha256: 'a'.repeat(64) });
  qa.render().change({ minutes: '012', checks: [true, true], reflection: '종이 복구' }); await qa.render().flush();
}
test('shipping hook restores paper raw inputs and recovered lesson wins over late progress', async t => {
  const qa = fixture(); t.after(qa.unmount); await paper(qa);
  const before = qa.env.storage.get(owner) as drafts.HandwritingDraft; qa.unmount();
  qa.env.sessions.set(crypto.randomUUID(), { status: 'completed', source: 'handwriting', metrics: { courseId: course.HANDWRITING_COURSE_ID, lessonId: before.lesson.id, lessonCompleted: true } });
  const restored = fixture(qa.env); t.after(restored.unmount); await restored.ready();
  assert.equal(restored.render().draft.minutes, '012'); assert.equal(restored.render().draft.reflection, '종이 복구'); assert.equal(restored.render().draft.lesson.id, before.lesson.id);
  assert.deepEqual(restored.render().draft.checks, [true, true]);
});
test('shipping hook restores exact pixels/evidence/undo without material fetch and never repaints with new source', async t => {
  const env = environment(), original = await seedScreen(env), qa = fixture(env); t.after(qa.unmount); const canvas = attachCanvas(qa); await qa.ready();
  assert.deepEqual(canvas.pixels(), original.raster!.pixels); assert.equal(qa.render().draft.strokes, 2); assert.equal(qa.render().sheetReady, true);
  qa.render().prepareSheet('not-needed', { ...original.worksheet!, sha256: 'b'.repeat(64) }); assert.deepEqual(canvas.pixels(), original.raster!.pixels);
  qa.render().undo(); await qa.render().flush(); assert.equal(qa.render().draft.strokes, 1); assert.equal(qa.render().draft.activeMs, 200); assert.deepEqual(canvas.pixels(), new Uint8ClampedArray(16));
});
test('pending retry ignores failed materials/progress/routine, retains exact payload and double click commits once', async t => {
  const env = environment(), initial = await seedScreen(env, true); env.progressFails = true; const qa = fixture(env); t.after(qa.unmount); attachCanvas(qa); await qa.ready();
  await Promise.all([qa.render().save(null), qa.render().save(null)]);
  assert.equal(qa.render().saved, true); assert.equal(env.payloads.length, 1); assert.deepEqual(env.payloads[0], initial.pending!.session); assert.equal(env.storage.get(owner)?.state, 'confirmed');
});
test('null toBlob preserves input with no remote mutation; owner switch during delayed encoding rejects late A', async t => {
  for (const switchOwner of [false, true]) {
    const env = environment(); await seedScreen(env); const qa = fixture(env); t.after(qa.unmount); const canvas = attachCanvas(qa); await qa.ready();
    const saving = qa.render().save(routine); await canvas.waitForBlob(saving);
    if (switchOwner) env.owner = other;
    canvas.finishBlob(switchOwner ? new Blob(['PNG'], { type: 'image/png' }) : null); await saving;
    assert.equal(env.sessions.size, 0); assert.equal(env.objects.size, 0); assert.equal(qa.render().saved, false); assert.equal((env.storage.get(owner) as drafts.HandwritingDraft).pending, null);
  }
});
test('quota retains latest visible input and old checkpoint; recovery retry precedes cloud mutation', async t => {
  const qa = fixture(); t.after(qa.unmount); await paper(qa); const old = structuredClone(qa.env.storage.get(owner));
  qa.env.quota = true; qa.render().change({ reflection: '기기 미저장 입력' }); await assert.rejects(qa.render().flush());
  assert.deepEqual(qa.env.storage.get(owner), old); assert.equal(qa.render().draft.reflection, '기기 미저장 입력'); await qa.render().save(routine); assert.equal(qa.env.sessions.size, 0);
  qa.env.quota = false; await qa.render().flush(); await qa.render().save(routine); assert.equal(qa.render().saved, true);
});
test('two tabs fail stale checkpoint atomically, preserve visible input and refuse cloud save', async t => {
  const env = environment(), a = fixture(env), b = fixture(env); t.after(a.unmount); t.after(b.unmount); await a.ready(); await b.ready();
  a.render().change({ reflection: 'A' }); b.render().change({ reflection: 'B' }); await a.render().flush(); await assert.rejects(b.render().flush(), /changed/);
  assert.equal(b.render().draft.reflection, 'B'); assert.equal(b.render().conflict, true); await b.render().save(routine); assert.equal(env.sessions.size, 0);
});
test('missing RPC and lost readback retain the same pending request; later retry confirms exact rows', async t => {
  for (const failure of ['rpc', 'readback']) {
    const qa = fixture(); t.after(qa.unmount); await paper(qa);
    if (failure === 'rpc') qa.env.missingRpc = true;
    if (failure === 'readback') qa.env.afterRpc = () => { qa.env.failReads = true; };
    await qa.render().save(routine); const pending = (qa.env.storage.get(owner) as drafts.HandwritingDraft).pending!;
    assert.ok(pending); assert.equal(qa.render().saved, false);
    qa.env.missingRpc = false; qa.env.failReads = false; qa.env.afterRpc = null; qa.env.terminalFail = false;
    await qa.render().save(null); assert.equal(qa.render().saved, true); assert.equal(qa.env.sessions.size, 1); assert.deepEqual(qa.env.sessions.get(pending.session.id), pending.session);
  }
});
test('unknown marker/corrupt schema blocks loading without erasing local record; confirmed reset makes stale draft ineligible', async t => {
  for (const failure of ['marker', 'corrupt', 'reset']) {
    const env = environment(); await seedScreen(env, true);
    if (failure === 'marker') env.failMarker = true;
    if (failure === 'corrupt') (env.storage.get(owner) as unknown as { version: number }).version = 999;
    if (failure === 'reset') env.marker = 'new-reset';
    const old = structuredClone(env.storage.get(owner)), qa = fixture(env); t.after(qa.unmount); await qa.ready(); await qa.render().save(null);
    assert.equal(env.sessions.size, 0); assert.equal(env.objects.size, 0);
    if (failure !== 'reset') assert.deepEqual(env.storage.get(owner), old); else { assert.equal(qa.render().invalidated, true); assert.equal(env.storage.get(owner)?.state, 'invalidated'); }
  }
});

test('late worksheet from another lesson never becomes the current source', async t => {
  const qa = fixture(); t.after(qa.unmount); await qa.ready();
  const wrong = { path: handwritingMaterialPath(owner, 'page-03.webp'), version: HANDWRITING_PACKAGE_FORMAT, sha256: 'a'.repeat(64) };
  qa.render().prepareSheet('late-previous-lesson', wrong);
  assert.equal(qa.render().draft.worksheet, null);
  await qa.render().flush(); assert.equal(qa.render().storageError, false);
});
test('a no-move pointer preserves all five undo frames, and unfinished pixels do not enter a checkpoint', async t => {
  const env = environment(), d = await seedScreen(env); d.strokes = 5;
  d.undo = await Promise.all(Array.from({ length: 5 }, async (_, strokes) => ({ raster: await drafts.freezeRaster(2, 2, new Uint8ClampedArray(16).fill(strokes)), strokes, activeMs: strokes * 100 })));
  env.storage.set(owner, d); const qa = fixture(env); t.after(qa.unmount); const canvas = attachCanvas(qa); await qa.ready();
  const event = { currentTarget: canvas.canvas, clientX: 1, clientY: 1, pressure: .5, pointerId: 1 } as unknown as Parameters<ReturnType<typeof qa.render>['start']>[0];
  qa.render().start(event); qa.render().stop(); await qa.render().flush();
  assert.equal((env.storage.get(owner) as drafts.HandwritingDraft).undo.length, 5);
  const before = structuredClone(env.storage.get(owner)) as drafts.HandwritingDraft;
  qa.render().start(event); qa.render().draw(event); await qa.render().flush();
  const during = env.storage.get(owner) as drafts.HandwritingDraft;
  assert.deepEqual(during.raster, before.raster); assert.deepEqual(during.undo, before.undo); assert.equal(during.strokes, before.strokes);
  qa.render().stop(); await qa.render().flush(); const after = env.storage.get(owner) as drafts.HandwritingDraft;
  assert.equal(after.strokes, 6); assert.notDeepEqual(after.raster, before.raster); assert.equal(after.undo.length, 5);
});

test('independently confirmed save distinguishes terminal uncertainty without claiming pending bytes survived', async t => {
  for (const failure of ['cleanup', 'terminal-readback', 'final-marker']) {
    const qa = fixture(); t.after(qa.unmount); await paper(qa);
    qa.env.terminalFail = failure === 'cleanup'; qa.env.terminalReadbackFail = failure === 'terminal-readback'; qa.env.failMarkerAfterTerminal = failure === 'final-marker';
    await qa.render().save(routine);
    assert.equal(qa.env.sessions.size, 1); assert.equal(qa.render().saved, false); assert.equal(qa.render().ready, false);
    assert.match(qa.render().notice, /서버에서 이번 수업 저장을 확인했지만/);
    assert.doesNotMatch(qa.render().notice, /같은 요청은 유지/);
    await assert.rejects(qa.render().flush(), /finalization_unconfirmed/);
    assert.equal(qa.env.storage.get(owner)?.state, failure === 'cleanup' ? 'active' : 'confirmed');
    qa.unmount(); qa.env.terminalFail = false; qa.env.terminalReadbackFail = false; qa.env.failMarkerAfterTerminal = false; qa.env.failMarker = false;
    const restored = fixture(qa.env); t.after(restored.unmount); await restored.ready();
    if (failure === 'cleanup') { assert.ok(restored.render().draft.pending); await restored.render().save(null); assert.equal(restored.render().saved, true); }
    else assert.equal(restored.render().draft.pending, null);
    assert.equal(qa.env.sessions.size, 1); assert.equal(qa.env.payloads.length, 1);
  }
});
test('reset cancels the previous debounced checkpoint while its terminal write is delayed', async t => {
  const qa = fixture(); t.after(qa.unmount); await paper(qa); qa.allowReset();
  qa.render().change({ reflection: 'discard this old edit' });
  const blocked = { arrived: deferred(), release: deferred() }; qa.env.blockWrite = blocked;
  const resetting = qa.render().reset(); await blocked.arrived.promise;
  await new Promise(resolve => setTimeout(resolve, 210));
  qa.env.blockWrite = null; blocked.release.resolve(); await resetting; await tick(); await tick();
  const next = qa.env.storage.get(owner) as drafts.HandwritingDraft;
  assert.equal(next.state, 'active'); assert.equal(next.reflection, ''); assert.equal(qa.render().storageError, false);
  assert.equal(qa.render().draft.attemptId, next.attemptId);
});
test('another pointer release cannot prematurely finalize the active stroke', async t => {
  const env = environment(); await seedScreen(env); const qa = fixture(env); t.after(qa.unmount); const canvas = attachCanvas(qa); await qa.ready();
  const event = { currentTarget: canvas.canvas, clientX: 1, clientY: 1, pressure: .5, pointerId: 1 } as unknown as Parameters<ReturnType<typeof qa.render>['start']>[0];
  qa.render().start(event); qa.render().draw(event); qa.render().stop({ ...event, pointerId: 2 });
  assert.equal(qa.render().draft.strokes, 2);
  qa.render().draw(event); qa.render().stop(event); await qa.render().flush(); assert.equal(qa.render().draft.strokes, 3);
});

test('reset notification during delayed PNG encoding prevents staging or uploading stale work', async t => {
  const env = environment(); await seedScreen(env); const qa = fixture(env); t.after(qa.unmount); const canvas = attachCanvas(qa); await qa.ready();
  const saving = qa.render().save(routine); await canvas.waitForBlob(saving);
  for (const notify of qa.events.get('storage') ?? []) notify({ key: 'record-reset-storage', newValue: JSON.stringify({ userId: owner, app: 'growth' }) });
  canvas.finishBlob(new Blob(['synthetic PNG'], { type: 'image/png' })); await saving;
  assert.equal(env.objects.size, 0); assert.equal(env.sessions.size, 0); assert.equal((env.storage.get(owner) as drafts.HandwritingDraft).pending, null);
  assert.equal(qa.render().ready, false); assert.equal(qa.render().saved, false);
});
