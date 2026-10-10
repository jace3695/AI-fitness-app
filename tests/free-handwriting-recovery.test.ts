import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyHandwritingEvidence, handwritingPoint } from '../app/data/practiceEvidence.ts';
import { emptyFreeDraft, freezeRaster, hashBytes, makeFreeSave, parseFreeRecord, terminalFreeRecord, freeRecordEqual, freeSlot, type FreeDraft, type FreeSave } from '../lib/free-handwriting-draft.ts';
import { readFreeRecord, writeFreeRecord } from '../lib/free-handwriting-local-store.ts';
import { confirmFreeSave } from '../lib/free-handwriting-save.ts';
import { type HandwritingSaveIO } from '../lib/handwriting-save.ts';
import { emptyHandwritingDraft, parseHandwritingRecord } from '../lib/handwriting-draft.ts';
const owner = '00000000-0000-4000-8000-000000000801', other = '00000000-0000-4000-8000-000000000803', routine = '00000000-0000-4000-8000-000000000802';
const stamp = '2026-10-09T12:00:00.000Z';
export async function draft(): Promise<FreeDraft> {
  const d = emptyFreeDraft(owner, null); d.guideIndex = 2; d.guideText = 'Historical guide wording'; d.inkColor = '#abcdef';
  let evidence = handwritingPoint(emptyHandwritingEvidence(), .1, .2, .3, 'pen'); evidence = handwritingPoint(evidence, .6, .7, .8, 'pen'); evidence = { ...evidence, strokes: 2, activeMs: 1203.5 };
  d.frames = [{ raster: await freezeRaster(2,2,new Uint8ClampedArray(16)), evidence: emptyHandwritingEvidence() }, { raster: await freezeRaster(2,2,new Uint8ClampedArray(16).fill(255)), evidence }]; d.historyIndex = 1;
  return d;
}
export async function job(): Promise<FreeSave> {
  const d = await draft(), png = new TextEncoder().encode('synthetic PNG bytes');
  return makeFreeSave(d, routine, 15, '2026-10-09', stamp, crypto.randomUUID(), crypto.randomUUID(), png, await hashBytes(png));
}
function idbAdapter() {
  const values = new Map<string, unknown>(); let tail = Promise.resolve(), quota = false;
  const factory = { open() {
    const request: Record<string, unknown> = {};
    const db = { createObjectStore() {}, close() {}, transaction(_store: string, mode?: string) {
      const tx: Record<string, unknown> = {}, operations: (() => void)[] = []; let aborted = false;
      const snapshot = new Map<string, unknown>();
      const store = {
        get(key: string) { const req: Record<string, unknown> = {}; operations.push(() => { req.result = structuredClone(snapshot.get(key)); (req.onsuccess as () => void)?.(); }); return req; },
        put(value: unknown, key: string) { if (quota) { aborted = true; tx.error = Error('quota'); return; } snapshot.set(key, structuredClone(value)); },
      };
      tx.objectStore = () => store; tx.abort = () => { aborted = true; };
      tail = tail.then(() => new Promise<void>(resolve => setImmediate(() => {
        values.forEach((value, key) => snapshot.set(key, value));
        for (const operation of operations) { if (!aborted) operation(); }
        if (aborted) (tx.onabort as () => void)?.();
        else { if (mode === 'readwrite') { values.clear(); snapshot.forEach((value, key) => values.set(key, value)); } (tx.oncomplete as () => void)?.(); }
        resolve();
      })));
      return tx;
    } };
    setImmediate(() => { request.result = db; (request.onsuccess as () => void)?.(); }); return request;
  } } as unknown as IDBFactory;
  return { factory, values, quota: (value: boolean) => { quota = value; } };
}
test('free draft restores exact raster, twenty undo/redo frames, historical guide, ink and measured evidence', async () => {
  const d = await draft(); d.frames = Array.from({length:20}, () => structuredClone(d.frames[1])); d.historyIndex = 12; d.pending = await job();
  assert.deepEqual(await parseFreeRecord(structuredClone(d), owner), d);
  await assert.rejects(parseFreeRecord(d, other));
  assert.equal((await parseFreeRecord(d, owner) as FreeDraft).guideText, 'Historical guide wording');
});
test('unknown current and nested fields cannot be normalized away by loading or terminal cleanup', async () => {
  const original = await draft();
  for (const target of ['top','frame','raster','evidence','pending','session','resource','metrics','terminal']) {
    const d = structuredClone(original); d.pending = await job();
    const record = target === 'terminal' ? terminalFreeRecord(d, 'confirmed') : d;
    const object = target === 'top' || target === 'terminal' ? record : target === 'frame' ? d.frames[0] : target === 'raster' ? d.frames[0].raster : target === 'evidence' ? d.frames[0].evidence : target === 'pending' ? d.pending : target === 'session' ? d.pending.session : target === 'resource' ? d.pending.resource : d.pending.session.metrics;
    Object.assign(object, { futureField: { preserved: true } });
    const before = structuredClone(record); await assert.rejects(parseFreeRecord(record, owner)); assert.deepEqual(record, before);
  }
});
test('corruption, invalid evidence, future schemas, bad dates and equal-size changed PNG fail closed', async () => {
  const d = await draft();
  for (const patch of [{version:2},{historyIndex:99},{frames:Array(21).fill(d.frames[0])},{inkColor:'red'},{guideText:''}]) await assert.rejects(parseFreeRecord({...d,...patch},owner));
  for (const patch of [{activeMs:86400001},{strokes:-1},{minX:.9,maxX:.2},{penMin:0},{minY:null}]) { const v=structuredClone(d); Object.assign(v.frames[1].evidence,patch); await assert.rejects(parseFreeRecord(v,owner)); }
  const pixels=structuredClone(d); pixels.frames[1].raster.pixels[0]^=1; await assert.rejects(parseFreeRecord(pixels,owner));
  const dimensions=structuredClone(d); dimensions.frames[1].raster.width=1201; await assert.rejects(parseFreeRecord(dimensions,owner));
  d.pending=await job(); d.pending.png[0]^=1; await assert.rejects(parseFreeRecord(d,owner)); d.pending=await job(); d.pending.session.session_date='2026-02-30'; await assert.rejects(parseFreeRecord(d,owner));
});
test('free and 53-lesson validators reject one another without weakening the original course contract', async () => {
  const free=await draft(), course=emptyHandwritingDraft(owner,null);
  await assert.rejects(parseHandwritingRecord(free,owner)); await assert.rejects(parseFreeRecord(course,owner)); assert.deepEqual(await parseHandwritingRecord(course,owner),course);
});
test('IDB CAS compares every current pixel, PNG byte and extension; stale cleanup preserves newer edits', async () => {
  const adapter=idbAdapter(), d=await draft(); d.pending=await job(); const first=await writeFreeRecord(d,null,adapter.factory);
  for (const change of ['pixel','png','extension']) {
    const altered=structuredClone(first) as FreeDraft;
    if(change==='pixel') altered.frames[0].raster.pixels[0]^=1;
    if(change==='png') altered.pending!.png[0]^=1;
    if(change==='extension') Object.assign(altered,{futureField:'keep'});
    adapter.values.set(freeSlot(owner),altered);
    await assert.rejects(writeFreeRecord(terminalFreeRecord(first,'confirmed'),first,adapter.factory),/changed/);
    assert.deepEqual(adapter.values.get(freeSlot(owner)),altered);
  }
});
test('two tabs and tombstones prevent stale overwrite/ABA; quota retains the entire prior checkpoint', async () => {
  const adapter=idbAdapter(), d=await draft(), first=await writeFreeRecord(d,null,adapter.factory);
  const results=await Promise.allSettled([writeFreeRecord({...d,inkColor:'#000000'},first,adapter.factory),writeFreeRecord({...d,inkColor:'#ffffff'},first,adapter.factory)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const latest=await readFreeRecord(owner,adapter.factory); assert.ok(latest); adapter.quota(true);
  await assert.rejects(writeFreeRecord(terminalFreeRecord(latest,'confirmed'),latest,adapter.factory)); assert.deepEqual(await readFreeRecord(owner,adapter.factory),latest); adapter.quota(false);
  const terminal=await writeFreeRecord(terminalFreeRecord(latest,'confirmed'),latest,adapter.factory); assert.equal(terminal.state,'confirmed'); assert.ok(!('frames' in terminal));
  await assert.rejects(writeFreeRecord(d,null,adapter.factory),/changed/); await assert.rejects(writeFreeRecord(d,first,adapter.factory),/changed/);
  const next=await writeFreeRecord(emptyFreeDraft(owner,null),terminal,adapter.factory); assert.equal(next.revision,terminal.revision+1);
});
function saga(value: FreeSave) {
  const env={session:null as unknown,resource:null as unknown,object:null as Blob|null,calls:[] as string[],readError:false,owner,marker:null as string|null,lostUpload:false,lostCommit:false,failCommit:false,missing:false,resetRpc:false,afterUpload:null as (()=>void)|null,afterCommit:null as (()=>void)|null};
  const io: HandwritingSaveIO={
    assertCurrent:async()=>{if(env.owner!==owner)throw Error('owner');if(env.marker!==null)throw Error('reset');},
    readSession:async()=>{env.calls.push('session');return{data:env.session,error:env.readError?Error('offline'):null};},
    readResource:async()=>{env.calls.push('resource');return{data:env.resource,error:env.readError?Error('offline'):null};},
    download:async()=>{env.calls.push('download');return{data:env.object,error:env.object?null:{code:'NoSuchKey'}};},
    upload:async()=>{env.calls.push('upload');env.object=new Blob([new Uint8Array(value.png).buffer],{type:'image/png'});env.afterUpload?.();return{error:env.lostUpload?Error('lost'):null};},
    commit:async()=>{env.calls.push('commit');if(env.missing)return{error:{code:'PGRST202'}};if(env.resetRpc)return{error:{message:'free_handwriting_reset_changed'}};if(!env.failCommit){env.session=structuredClone(value.session);env.resource=structuredClone(value.resource);}env.afterCommit?.();return{error:env.lostCommit||env.failCommit?Error('lost'):null};},
  };return{env,io};
}
test('generic read-first transport preserves exact free IDs after lost upload and commit responses',async()=>{
  const j=await job(),qa=saga(j);qa.env.lostUpload=true;qa.env.lostCommit=true;await confirmFreeSave(j,qa.io);await confirmFreeSave(j,qa.io);
  assert.deepEqual(qa.env.calls.slice(0,3),['session','resource','download']);assert.equal(qa.env.calls.filter(x=>x==='upload').length,1);assert.equal(qa.env.calls.filter(x=>x==='commit').length,1);assert.deepEqual(qa.env.session,j.session);
  qa.env.session=null;await confirmFreeSave(j,qa.io);assert.deepEqual(qa.env.session,j.session);
});
test('free transport refuses read errors, changed metadata and equal-size different bytes without mutations',async()=>{
  const j=await job();
  for(const kind of ['read','session','resource','bytes']){const qa=saga(j);if(kind==='read')qa.env.readError=true;if(kind==='session')qa.env.session={...j.session,memo:'changed'};if(kind==='resource')qa.env.resource={...j.resource,updated_at:'2026-10-09T12:00:00.001Z'};if(kind==='bytes')qa.env.object=new Blob([new Uint8Array(j.png.length).fill(88)]);await assert.rejects(confirmFreeSave(j,qa.io));assert.ok(!qa.env.calls.includes('upload'));assert.ok(!qa.env.calls.includes('commit'));}
});
test('missing free RPC and reset fences retain uploaded private objects without fallback inserts or deletion',async()=>{
  const j=await job();
  for(const kind of ['missing','resetRpc','upload','commit']){const qa=saga(j);if(kind==='missing')qa.env.missing=true;if(kind==='resetRpc')qa.env.resetRpc=true;if(kind==='upload')qa.env.afterUpload=()=>{qa.env.marker='reset';};if(kind==='commit')qa.env.afterCommit=()=>{qa.env.marker='reset';qa.env.session=null;};await assert.rejects(confirmFreeSave(j,qa.io));assert.ok(qa.env.object);assert.ok(!qa.env.calls.includes('delete'));}
});
test('full-content equality includes PNG bytes and rejects unknown nested fields',async()=>{
  const d=await draft();d.pending=await job();const same=structuredClone(d);assert.equal(freeRecordEqual(d,same),true);same.pending!.png[0]^=1;assert.equal(freeRecordEqual(d,same),false);
});
