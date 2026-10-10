import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as drafts from '../lib/free-handwriting-draft.ts';
import * as evidence from '../app/data/practiceEvidence.ts';
import * as saveBoundary from '../lib/free-handwriting-save.ts';
import type { GrowthRoutineRow } from '../app/data/growthPlatform.ts';
const owner = '00000000-0000-4000-8000-000000000811', other = '00000000-0000-4000-8000-000000000812';
const routine = { id: '00000000-0000-4000-8000-000000000813', user_id: owner, category: 'handwriting', target_minutes: 15 } as GrowthRoutineRow;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function environment() {
  return { owner, storage: new Map<string, drafts.FreeRecord>(), sessions: new Map<string, unknown>(), resources: new Map<string, unknown>(), objects: new Map<string, Blob>(),
    marker: null as string | null, markerGate: null as { arrived: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null, failMarker: false, failReads: false, progressFails: false, failCommit: false, missingRpc: false, quota: false, terminalFail: false, terminalReadbackFail: false, activeReadbackFail: false, failMarkerAfterTerminal: false,
    payloads: [] as drafts.FreeSave['session'][], calls: [] as string[], beforeRpc: null as (() => void) | null,
    afterRpc: null as (() => void) | null, blockWrite: null as { arrived: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null, localQueue: Promise.resolve() };
}
class SyntheticImageData { data: Uint8ClampedArray; width: number; height: number; constructor(data: Uint8ClampedArray, width: number, height: number) { this.data = data; this.width = width; this.height = height; } }
function fixture(env = environment(), id = owner) {
  const slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  const stateChanges = new Set<() => void>();
  const events = new Map<string, Set<(...args: unknown[]) => void>>(); let cursor = 0, allowReset = false;
  const storage = {
    async readFreeRecord(candidate: string) { return drafts.parseFreeRecord(structuredClone(env.storage.get(candidate)), candidate); },
    async writeFreeRecord(record: drafts.FreeRecord, expected: drafts.FreeRecord | null) {
      const next = { ...record, revision: (expected?.revision ?? 0) + 1 }; await drafts.parseFreeRecord(next, record.owner);
      const run = env.localQueue.then(async () => {
        if (env.blockWrite) { env.blockWrite.arrived.resolve(); await env.blockWrite.release.promise; }
        if (env.quota || env.terminalFail && record.state !== 'active') throw Error('quota');
        const local = env.storage.get(record.owner);
        if (expected ? !drafts.freeRecordEqual(local,expected) : !!local) throw Error('free_handwriting_draft_changed');
        env.storage.set(record.owner, structuredClone(next));
        if (record.state === 'active' && env.activeReadbackFail) throw Error('active readback offline');
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
          if (table === 'user_app_state') {
            if (env.markerGate) { env.markerGate.arrived.resolve(); await env.markerGate.release.promise; }
            return { data: { state: { 'ai-fitness-record-reset-growth': env.marker } }, error: env.failMarker ? Error('marker offline') : null };
          }
          if (!filters.id) return { data: [...env.sessions.values()], error: env.progressFails ? Error('progress offline') : null };
          env.calls.push(`read:${table}`);
          return { data: (table === 'growth_sessions' ? env.sessions : env.resources).get(filters.id) ?? null, error: env.failReads ? Error('offline') : null };
        };
        const query = { select() { return query; }, eq(key: string, value: string) { filters[key] = value; return query; }, contains() { return query; }, order() { return query; }, range() { return query; }, abortSignal() { return query; }, maybeSingle: execute, then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); } }; return query;
      },
      storage: { from() { return {
        download: async (path: string) => ({ data: env.objects.get(path) ?? null, error: env.objects.has(path) ? null : { code: 'NoSuchKey' } }),
        upload: async (path: string, blob: Blob, options: { upsert: boolean }) => { assert.equal(options.upsert, false); assert.ok((env.storage.get(id) as drafts.FreeDraft).pending); env.calls.push('upload'); env.objects.set(path, blob); return { error: null }; },
      }; } },
      rpc(name: string, args: { p_session: drafts.FreeSave['session']; p_resource: drafts.FreeSave['resource'] | null; p_expected_owner: string; p_expected_reset_marker: string | null }) {
        assert.equal(name, 'save_free_handwriting_attempt');
        const execute = async () => {
          assert.ok((env.storage.get(id) as drafts.FreeDraft).pending, 'stage before remote mutation');
          env.calls.push('rpc'); env.payloads.push(structuredClone(args.p_session)); env.beforeRpc?.();
          if (env.missingRpc) return { error: { code: 'PGRST202' } };
          if (args.p_expected_owner !== env.owner) return { error: { message: 'handwriting_owner_changed' } };
          if (args.p_expected_reset_marker !== env.marker) return { error: { message: 'free_handwriting_reset_changed' } };
          if (!env.failCommit) { env.sessions.set(args.p_session.id, structuredClone(args.p_session)); if (args.p_resource) env.resources.set(args.p_resource.id, structuredClone(args.p_resource)); }
          env.afterRpc?.(); return { error: env.failCommit ? Error('offline') : null };
        };
        const query = { abortSignal() { return query; }, then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); } }; return query;
      },
    } },
    '@/app/data/appRecordReset': { RECORD_RESET_EVENT: 'record-reset', RECORD_RESET_STORAGE_EVENT: 'record-reset-storage', isRecordResetRunning: () => false, resetMarkerKey: () => 'ai-fitness-record-reset-growth' },
    '@/app/data/practiceEvidence': evidence, '@/utils/dateKey': { getLocalDateKey: () => '2026-10-09' }, '@/lib/free-handwriting-draft': drafts, '@/lib/free-handwriting-local-store': storage, '@/lib/free-handwriting-save': saveBoundary,
  };
  const exports = {} as typeof import('../app/growth/handwriting/free/useFreeHandwritingPractice');
  const source = ts.transpileModule(readFileSync(new URL('../app/growth/handwriting/free/useFreeHandwritingPractice.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const eventTarget = { addEventListener(name: string, callback: (...args: unknown[]) => void) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(callback); }, removeEventListener(name: string, callback: (...args: unknown[]) => void) { events.get(name)?.delete(callback); } };
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { Error, AbortSignal, Date, crypto, performance, structuredClone, ImageData: SyntheticImageData, Uint8ClampedArray, Uint8Array, Blob, setTimeout, clearTimeout,
    window: { ...eventTarget, confirm: () => allowReset }, document: { ...eventTarget, visibilityState: 'visible' },
  })(exports, (name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name as keyof typeof modules]; });
  const isOwnerActive = (candidate: string) => env.owner === candidate;
  const render = () => { cursor = 0; const result = exports.useFreeHandwritingPractice(id, isOwnerActive); effects.splice(0).forEach(effect => effect()); return result; };
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
  const ctx = { fillRect() {}, getImageData: () => new SyntheticImageData(new Uint8ClampedArray(pixels), 2, 2), putImageData: (image: SyntheticImageData) => { pixels = new Uint8ClampedArray(image.data); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { pixels[0]++; } };
  const canvas = { width: 2, height: 2, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: 2, height: 2 }), setPointerCapture() {}, toBlob(callback: (blob: Blob | null) => void) { blobCallback = callback; blobStarted.resolve(); } };
  qa.render().canvasRef.current = canvas as unknown as HTMLCanvasElement;
  return { canvas, pixels: () => pixels, finishBlob: (value: Blob | null) => { assert.ok(blobCallback); blobCallback(value); },
    async waitForBlob(saving: Promise<void>) {
      await Promise.race([blobStarted.promise, saving.then(() => { assert.ok(blobCallback, `Save finished before PNG encoding began: ${qa.render().notice}`); })]);
    } };
}
async function seed(env: ReturnType<typeof environment>, pending = false) {
  const d = drafts.emptyFreeDraft(owner,null); d.guideIndex=2; d.guideText='복구 문장'; d.inkColor='#abcdef';
  let ink=evidence.handwritingPoint(evidence.emptyHandwritingEvidence(),.1,.2,.3,'pen');ink=evidence.handwritingPoint(ink,.6,.7,.8,'pen');ink={...ink,strokes:2,activeMs:1203.5};
  d.frames=[{raster:await drafts.freezeRaster(2,2,new Uint8ClampedArray(16)),evidence:evidence.emptyHandwritingEvidence()},{raster:await drafts.freezeRaster(2,2,new Uint8ClampedArray(16).fill(255)),evidence:ink}];d.historyIndex=1;d.revision=1;
  if(pending){const png=new TextEncoder().encode('synthetic PNG');d.pending=drafts.makeFreeSave(d,routine.id,15,'2026-10-09','2026-10-09T12:00:00.000Z',crypto.randomUUID(),crypto.randomUUID(),png,await drafts.hashBytes(png));}
  env.storage.set(owner,d);return d;
}
async function restored(pending=false){const env=environment();const original=await seed(env,pending),qa=fixture(env),canvas=attachCanvas(qa);await qa.ready();return{env,original,qa,canvas};}
test('restored free guide and ink render before the pending reset-marker lookup allows exact raster paint', async t => {
  const env = environment(), original = await seed(env);
  const gate = { arrived: deferred(), release: deferred() }; env.markerGate = gate;
  const qa = fixture(env), canvas = attachCanvas(qa); t.after(qa.unmount); t.after(gate.release.resolve);
  await gate.arrived.promise;
  const recovering = qa.render();
  assert.equal(recovering.draft.guideText, original.guideText);
  assert.equal(recovering.draft.inkColor, original.inkColor);
  assert.equal(recovering.ready, false);
  assert.notDeepEqual(canvas.pixels(), original.frames[original.historyIndex].raster.pixels);
  gate.release.resolve(); await qa.ready();
  assert.deepEqual(canvas.pixels(), original.frames[original.historyIndex].raster.pixels);
});
test('fresh canvas pointer input before delayed initialization is ignored until an initial frame is ready', async t => {
  const env = environment(), gate = { arrived: deferred(), release: deferred() }; env.markerGate = gate;
  const qa = fixture(env), canvas = attachCanvas(qa); t.after(qa.unmount); t.after(gate.release.resolve);
  await gate.arrived.promise;
  const event = { currentTarget: canvas.canvas, clientX: 1, clientY: 1, pressure: .5, pointerId: 1, pointerType: 'mouse' } as unknown as Parameters<ReturnType<typeof qa.render>['start']>[0];
  const blank = new Uint8ClampedArray(canvas.pixels());
  qa.render().start(event); qa.render().draw(event); qa.render().stop(event);
  assert.equal(qa.render().ready, false); assert.equal(qa.render().draft.frames.length, 0);
  assert.equal(drafts.freeEvidence(qa.render().draft).strokes, 0); assert.deepEqual(canvas.pixels(), blank); assert.equal(env.storage.size, 0);
  gate.release.resolve(); await qa.ready(); await qa.render().flush();
  const initialized = env.storage.get(owner) as drafts.FreeDraft;
  assert.equal(initialized.frames.length, 1); assert.equal(initialized.historyIndex, 0); assert.equal(drafts.freeEvidence(initialized).strokes, 0);
});
test('free hook restores raster, guide, ink, exact evidence and undo/redo after reload',async t=>{
 const {env,original,qa,canvas}=await restored();t.after(qa.unmount);assert.deepEqual(canvas.pixels(),original.frames[1].raster.pixels);assert.equal(qa.render().draft.inkColor,'#abcdef');
 qa.render().restore(0);await qa.render().flush();assert.equal(drafts.freeEvidence(qa.render().draft).strokes,0);qa.unmount();const b=fixture(env),bc=attachCanvas(b);t.after(b.unmount);await b.ready();assert.equal(b.render().draft.historyIndex,0);assert.deepEqual(bc.pixels(),original.frames[0].raster.pixels);b.render().restore(1);await b.render().flush();assert.deepEqual(drafts.freeEvidence(b.render().draft),original.frames[1].evidence);
});
test('pending retry ignores missing routine, retains exact request, double click commits once',async t=>{
 const {env,original,qa}=await restored(true);t.after(qa.unmount);await Promise.all([qa.render().save(null),qa.render().save(null)]);assert.equal(qa.render().saved,true);assert.deepEqual(env.payloads,[original.pending!.session]);assert.equal(env.storage.get(owner)?.state,'confirmed');
});
test('fresh request stages full PNG/hash before upload and commits exact metadata',async t=>{
 const {env,qa,canvas}=await restored();t.after(qa.unmount);const saving=qa.render().save(routine);await canvas.waitForBlob(saving);canvas.finishBlob(new Blob(['synthetic PNG'],{type:'image/png'}));await saving;assert.equal(qa.render().saved,true);assert.equal(env.sessions.size,1);assert.equal(env.resources.size,1);assert.ok(env.payloads[0].metrics.pngSha256);assert.equal(env.payloads[0].metrics.practiceKind,'free-handwriting-v1');
});
test('null PNG and owner switch during delayed encoding preserve original local input with no mutation',async t=>{
 for(const switchOwner of [false,true]){const {env,qa,canvas}=await restored();t.after(qa.unmount);const saving=qa.render().save(routine);await canvas.waitForBlob(saving);if(switchOwner)env.owner=other;canvas.finishBlob(switchOwner?new Blob(['synthetic PNG'],{type:'image/png'}):null);await saving;assert.equal(env.objects.size,0);assert.equal(env.sessions.size,0);assert.equal((env.storage.get(owner) as drafts.FreeDraft).pending,null);assert.equal(qa.render().saved,false);}
});
test('quota keeps newer visible ink and previous checkpoint; retry precedes all cloud mutation',async t=>{
 const {env,qa}=await restored();t.after(qa.unmount);const old=structuredClone(env.storage.get(owner));env.quota=true;qa.render().changeColor('#112233');await assert.rejects(qa.render().flush());await tick();assert.deepEqual(env.storage.get(owner),old);assert.equal(qa.render().draft.inkColor,'#112233');await qa.render().save(routine);assert.equal(env.objects.size,0);env.quota=false;await qa.render().flush();assert.equal((env.storage.get(owner) as drafts.FreeDraft).inkColor,'#112233');
});
test('stale second-tab checkpoint and cleanup never overwrite the newer draft',async t=>{
 const env=environment();await seed(env);const a=fixture(env),b=fixture(env);attachCanvas(a);attachCanvas(b);t.after(a.unmount);t.after(b.unmount);await a.ready();await b.ready();a.render().changeColor('#111111');await a.render().flush();b.render().changeColor('#222222');await assert.rejects(b.render().flush());await tick();assert.equal(b.render().conflict,true);assert.equal(b.render().draft.inkColor,'#222222');assert.equal((env.storage.get(owner) as drafts.FreeDraft).inkColor,'#111111');await b.render().save(routine);assert.equal(env.objects.size,0);
});
test('missing RPC and lost commit readback retain pending IDs over reload',async t=>{
 for(const mode of ['missing','readback']){const {env,original,qa}=await restored(true);t.after(qa.unmount);if(mode==='missing')env.missingRpc=true;else env.afterRpc=()=>{env.failReads=true;};await qa.render().save(null);assert.equal(qa.render().saved,false);assert.deepEqual((env.storage.get(owner) as drafts.FreeDraft).pending,original.pending);qa.unmount();env.missingRpc=false;env.failReads=false;env.afterRpc=null;const b=fixture(env);attachCanvas(b);t.after(b.unmount);await b.ready();await b.render().save(null);assert.equal(b.render().saved,true);assert.equal(env.sessions.size,1);}
});
test('unknown schema and extensions preserve source; offline recovered draft keeps local edits',async t=>{
 for(const mode of ['schema','field','offline']){const env=environment();await seed(env,true);if(mode==='schema')Object.assign(env.storage.get(owner)!,{version:999});if(mode==='field')Object.assign(env.storage.get(owner)!,{futureField:'keep'});if(mode==='offline')env.failMarker=true;const old=structuredClone(env.storage.get(owner));const qa=fixture(env);attachCanvas(qa);t.after(qa.unmount);await qa.ready();assert.equal(qa.render().loadError,true);assert.deepEqual(env.storage.get(owner),old);await qa.render().save(null);assert.equal(env.objects.size,0);}
 const env=environment();await seed(env);env.failMarker=true;const qa=fixture(env);attachCanvas(qa);t.after(qa.unmount);await qa.ready();qa.render().changeColor('#112233');await qa.render().flush();assert.equal((env.storage.get(owner) as drafts.FreeDraft).inkColor,'#112233');
});
test('reset-invalidated pending source stays intact until explicit new-attempt confirmation',async t=>{
 const env=environment();const original=await seed(env,true);env.marker='new-reset';const qa=fixture(env);attachCanvas(qa);t.after(qa.unmount);await qa.ready();assert.equal(qa.render().invalidated,true);await qa.render().save(null);await qa.render().clear();assert.deepEqual(env.storage.get(owner),original);qa.allowReset();await qa.render().clear();assert.equal(qa.render().invalidated,false);const next=env.storage.get(owner) as drafts.FreeDraft;assert.notEqual(next.attemptId,original.attemptId);assert.equal(next.pending,null);assert.equal(next.resetMarker,'new-reset');assert.equal(env.objects.size,0);
});
test('unrelated pointer release cannot finalize; unfinished checkpoint uses last completed pixels and evidence',async t=>{
 const {env,qa,canvas}=await restored();t.after(qa.unmount);const e={currentTarget:canvas.canvas,clientX:1,clientY:1,pressure:.5,pointerId:1,pointerType:'pen'} as unknown as Parameters<ReturnType<typeof qa.render>['start']>[0];
 qa.render().start(e);qa.render().draw(e);qa.render().stop({...e,pointerId:2});await qa.render().flush();assert.equal(drafts.freeEvidence(env.storage.get(owner) as drafts.FreeDraft).strokes,2);assert.equal((env.storage.get(owner) as drafts.FreeDraft).frames[1].raster.pixels[0],255);qa.render().stop(e);await qa.render().flush();assert.equal(drafts.freeEvidence(env.storage.get(owner) as drafts.FreeDraft).strokes,3);
});
test('reset notification during delayed PNG prevents staging/upload and leaves checkpoint intact',async t=>{
 const {env,qa,canvas}=await restored();t.after(qa.unmount);const saving=qa.render().save(routine);await canvas.waitForBlob(saving);for(const notify of qa.events.get('storage')??[])notify({key:'record-reset-storage',newValue:JSON.stringify({userId:owner,app:'growth'})});canvas.finishBlob(new Blob(['PNG'],{type:'image/png'}));await saving;assert.equal(env.objects.size,0);assert.equal(env.sessions.size,0);assert.equal((env.storage.get(owner) as drafts.FreeDraft).pending,null);assert.equal(qa.render().invalidated,true);
});
test('server-confirmed local cleanup failure or uncertain readback never reopens stale writable draft',async t=>{
 for(const mode of ['quota','readback','marker']){const {env,qa}=await restored(true);t.after(qa.unmount);if(mode==='quota')env.terminalFail=true;if(mode==='readback')env.terminalReadbackFail=true;if(mode==='marker')env.failMarkerAfterTerminal=true;await qa.render().save(null);assert.equal(env.sessions.size,1);assert.equal(qa.render().ready,false);assert.match(qa.render().notice,/서버에서 저장을 확인했지만/);await assert.rejects(qa.render().flush(),/finalization_unconfirmed/);assert.equal(env.storage.get(owner)?.state,mode==='quota'?'active':'confirmed');}
});
test('clear is checkpoint-first, preserves 20-frame bound and old content on quota failure',async t=>{
 const {env,qa,canvas}=await restored();t.after(qa.unmount);const before=structuredClone(env.storage.get(owner));env.quota=true;await qa.render().clear();assert.deepEqual(env.storage.get(owner),before);assert.deepEqual(canvas.pixels(),(before as drafts.FreeDraft).frames[1].raster.pixels);env.quota=false;await qa.render().flush();await qa.render().clear();const next=env.storage.get(owner) as drafts.FreeDraft;assert.equal(next.frames.length,3);assert.equal(drafts.freeEvidence(next).strokes,0);qa.render().restore(1);await qa.render().flush();assert.equal(drafts.freeEvidence(qa.render().draft).strokes,2);
});
test('checkpoint queued from the previous flush microtask waits for its own completed write',async t=>{
 const {env,qa}=await restored();t.after(qa.unmount);
 for(let i=1;i<=12;i++){await qa.render().flush();const color=`#${i.toString(16).padStart(6,'0')}`;qa.render().changeColor(color);await qa.render().flush();assert.equal((env.storage.get(owner) as drafts.FreeDraft).inkColor,color);}
});
test('bounded coalescing retains newest stroke, guide and ink after a greater-than-20-frame burst',async t=>{
 const {env,qa,canvas}=await restored();t.after(qa.unmount);const block={arrived:deferred(),release:deferred()};env.blockWrite=block;
 qa.render().changeColor('#111111');const first=qa.render().flush();await block.arrived.promise;
 const e={currentTarget:canvas.canvas,clientX:1,clientY:1,pressure:.5,pointerId:1,pointerType:'pen'} as unknown as Parameters<ReturnType<typeof qa.render>['start']>[0];
 for(let i=0;i<28;i++){qa.render().start(e);qa.render().draw(e);qa.render().stop(e);}
 qa.render().nextGuide();qa.render().changeColor('#fedcba');const visible=qa.render().draft;
 env.blockWrite=null;block.release.resolve();await first;await qa.render().flush();const stored=env.storage.get(owner) as drafts.FreeDraft;
 assert.equal(stored.frames.length,20);assert.equal(stored.historyIndex,19);assert.equal(stored.inkColor,'#fedcba');assert.equal(stored.guideText,visible.guideText);assert.equal(drafts.freeEvidence(stored).strokes,30);assert.deepEqual(stored.frames[19].raster.pixels,canvas.pixels());
});
test('active offline clear remains a local CAS edit and keeps undo history',async t=>{
 const {env,qa}=await restored();t.after(qa.unmount);env.failMarker=true;await qa.render().clear();assert.equal(drafts.freeEvidence(qa.render().draft).strokes,0);qa.render().restore(1);await qa.render().flush();assert.equal(drafts.freeEvidence(qa.render().draft).strokes,2);assert.equal(env.sessions.size,0);
});
test('committed nonterminal checkpoint with lost readback is reported as unconfirmed, not old bytes preserved',async t=>{
 const {env,qa}=await restored();t.after(qa.unmount);env.activeReadbackFail=true;qa.render().changeColor('#135790');await assert.rejects(qa.render().flush());await tick();assert.equal((env.storage.get(owner) as drafts.FreeDraft).inkColor,'#135790');assert.equal(qa.render().draft.inkColor,'#135790');assert.match(qa.render().notice,/마지막 기기 저장 상태는 확인하지 못했어요/);assert.doesNotMatch(qa.render().notice,/이전 복구 기록을 유지/);await qa.render().save(routine);assert.equal(env.objects.size,0);qa.unmount();env.activeReadbackFail=false;const b=fixture(env);attachCanvas(b);t.after(b.unmount);await b.ready();assert.equal(b.render().draft.inkColor,'#135790');
});
