import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HANDWRITING_LESSONS } from '../app/data/handwritingCourse.ts';
import { HANDWRITING_PACKAGE_FORMAT, handwritingMaterialPath } from '../app/data/handwritingMaterials.ts';
import { emptyHandwritingDraft, freezeRaster, hashBytes, makeHandwritingSave, parseHandwritingRecord, terminalHandwritingRecord, type HandwritingDraft, type FrozenHandwritingSave } from '../lib/handwriting-draft.ts';
import { readHandwritingRecord, writeHandwritingRecord, handwritingVersion } from '../lib/handwriting-local-store.ts';
import { confirmHandwritingSave, confirmedObjectAbsent, type HandwritingSaveIO } from '../lib/handwriting-save.ts';
const owner = '00000000-0000-4000-8000-000000000801', routine = '00000000-0000-4000-8000-000000000802';
const other = '00000000-0000-4000-8000-000000000803';
const stamp = '2026-10-09T12:00:00.000Z';
export async function draft(screen = false): Promise<HandwritingDraft> {
  const base = emptyHandwritingDraft(owner, null, HANDWRITING_LESSONS[18]);
  base.checks = [true, true]; base.minutes = '012'; base.reflection = '합성 연습';
  base.worksheet = { path: handwritingMaterialPath(owner, 'page-20.webp'), version: HANDWRITING_PACKAGE_FORMAT, sha256: 'a'.repeat(64) };
  if (screen) {
    base.mode = 'screen'; base.trace = false; base.strokes = 2; base.activeMs = 1203.5;
    base.raster = await freezeRaster(2, 2, new Uint8ClampedArray([1,2,3,255,4,5,6,255,7,8,9,255,10,11,12,255]));
    base.undo = [{ raster: await freezeRaster(2, 2, new Uint8ClampedArray(16)), strokes: 1, activeMs: 402.1 }];
  }
  return base;
}
export async function job(screen = false): Promise<FrozenHandwritingSave> {
  const base = await draft(screen), png = screen ? new Blob(['synthetic PNG bytes'], { type: 'image/png' }) : null;
  return makeHandwritingSave(base, routine, '2026-10-09', stamp, crypto.randomUUID(), screen ? crypto.randomUUID() : null, png, png ? await hashBytes(png) : null);
}
// A deterministic event/transaction adapter exercises shipping IDB code. It is
// deliberately not evidence about any browser engine's durability or eviction.
function idbAdapter(rejectBlobs = false) {
  const values = new Map<string, unknown>(); let tail = Promise.resolve(), quota = false;
  const factory = { open() {
    const request: Record<string, unknown> = {};
    const db = { createObjectStore() {}, close() {}, transaction(_store: string, mode?: string) {
      const tx: Record<string, unknown> = {}, operations: (() => void)[] = []; let aborted = false;
      const snapshot = new Map<string, unknown>();
      const store = {
        get(key: string) { const req: Record<string, unknown> = {}; operations.push(() => { req.result = structuredClone(snapshot.get(key)); (req.onsuccess as () => void)?.(); }); return req; },
        put(value: unknown, key: string) {
          if (quota) { aborted = true; tx.error = Error('quota'); return; }
          if (rejectBlobs && (value as HandwritingDraft)?.pending?.png instanceof Blob) { aborted = true; tx.error = new DOMException('Synthetic Blob storage rejection', 'UnknownError'); return; }
          snapshot.set(key, structuredClone(value));
        },
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
test('paper and screen roundtrip raw minutes, lesson/check wording, lossless raster, evidence and every undo pixel', async () => {
  for (const screen of [false, true]) {
    const original = await draft(screen); original.pending = await job(screen);
    assert.deepEqual(await parseHandwritingRecord(structuredClone(original), owner), original);
    await assert.rejects(parseHandwritingRecord(original, other), /invalid/);
  }
});
test('corrupt/future/schema/oversize/hash/PNG failure never becomes an empty draft', async () => {
  const original = await draft(true);
  for (const altered of [{ ...original, version: 2 }, { ...original, checks: [true] }, { ...original, minutes: '1'.repeat(21) }, { ...original, raster: { ...original.raster!, width: 4097 } }]) await assert.rejects(parseHandwritingRecord(altered, owner));
  const corrupt = structuredClone(original); corrupt.raster!.pixels[0] ^= 1; await assert.rejects(parseHandwritingRecord(corrupt, owner), /invalid/);
  original.pending = await job(true); original.pending.png = new Blob(['same length bad PNG'], { type: 'image/png' }); await assert.rejects(parseHandwritingRecord(original, owner), /invalid/);
  await assert.rejects(freezeRaster(4096, 4096, new Uint8ClampedArray(4)), /oversize/);
});
test('frozen request includes complete session/resource metadata and timestamps; wrong same-size bytes fail', async () => {
  const value = await job(true);
  assert.equal(value.session.started_at, null); assert.equal(value.session.ended_at, null); assert.equal(value.session.updated_at, stamp);
  assert.equal(value.resource!.created_at, stamp); assert.equal(value.resource!.updated_at, stamp);
  assert.equal(Object.keys(value.session).length, 13); assert.equal(Object.keys(value.resource!).length, 12);
  assert.equal(value.session.metrics.pngSha256, await hashBytes(value.png!));
  assert.notEqual(await hashBytes(new Blob(['x'.repeat(value.png!.size)])), value.pngSha256);
});
test('IDB atomic two-tab CAS permits only one writer; stale terminal cleanup cannot erase new content', async () => {
  const adapter = idbAdapter(), original = await draft();
  const first = await writeHandwritingRecord(original, null, adapter.factory);
  const results = await Promise.allSettled([
    writeHandwritingRecord({ ...original, reflection: 'tab A' }, handwritingVersion(first), adapter.factory),
    writeHandwritingRecord({ ...original, reflection: 'tab B' }, handwritingVersion(first), adapter.factory),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(writeHandwritingRecord(terminalHandwritingRecord(original, 'confirmed'), handwritingVersion(first), adapter.factory), /changed/);
  const latest = await readHandwritingRecord(owner, adapter.factory); assert.equal(latest?.state, 'active'); assert.equal(latest?.revision, 2);
});
test('source-only Blob rejection in the shipping IDB transaction preserves the prior whole checkpoint', async () => {
  const adapter = idbAdapter(true), original = await draft(true);
  const first = await writeHandwritingRecord(original, null, adapter.factory);
  const pending = { ...first, pending: await job(true) } as HandwritingDraft;
  await assert.rejects(writeHandwritingRecord(pending, handwritingVersion(first), adapter.factory), /handwriting_checkpoint_failed/);
  assert.deepEqual(await readHandwritingRecord(owner, adapter.factory), first);
  assert.equal((await readHandwritingRecord(owner, adapter.factory) as HandwritingDraft).pending, null);
});
test('tombstone revisions prevent absent-present ABA and quota preserves previous whole checkpoint', async () => {
  const adapter = idbAdapter(), original = await draft(true);
  const first = await writeHandwritingRecord(original, null, adapter.factory);
  adapter.quota(true); await assert.rejects(writeHandwritingRecord({ ...original, reflection: 'unsaved' }, handwritingVersion(first), adapter.factory));
  assert.deepEqual(await readHandwritingRecord(owner, adapter.factory), first); adapter.quota(false);
  const terminal = await writeHandwritingRecord(terminalHandwritingRecord(first, 'discarded'), handwritingVersion(first), adapter.factory);
  assert.equal(terminal.revision, 2); assert.ok(!('raster' in terminal));
  await assert.rejects(writeHandwritingRecord(original, null, adapter.factory), /changed/);
  const second = await writeHandwritingRecord(emptyHandwritingDraft(owner, null), handwritingVersion(terminal), adapter.factory);
  assert.equal(second.revision, 3); assert.notEqual(second.attemptId, first.attemptId);
});
function saga(value: FrozenHandwritingSave) {
  const env = { session: null as unknown, resource: null as unknown, object: null as Blob | null, calls: [] as string[], failRead: false, failCommit: false, lostCommit: false, lostUpload: false, missingRpc: false, owner, marker: null as string | null, afterUpload: null as (() => void) | null, afterCommit: null as (() => void) | null };
  const io: HandwritingSaveIO = {
    assertCurrent: async () => { if (env.owner !== owner) throw Error('handwriting_owner_changed'); if (env.marker !== null) throw Error('handwriting_reset_changed'); },
    readSession: async () => { env.calls.push('session'); return { data: env.session, error: env.failRead ? Error('offline') : null }; },
    readResource: async () => { env.calls.push('resource'); return { data: env.resource, error: env.failRead ? Error('offline') : null }; },
    download: async () => { env.calls.push('download'); return { data: env.object, error: env.object ? null : { code: 'NoSuchKey' } }; },
    upload: async () => { env.calls.push('upload'); env.object = value.png; env.afterUpload?.(); return { error: env.lostUpload ? Error('lost upload response') : null }; },
    commit: async () => { env.calls.push('commit'); if (env.missingRpc) return { error: { code: 'PGRST202' } }; if (!env.failCommit) { env.session = structuredClone(value.session); env.resource = structuredClone(value.resource); } env.afterCommit?.(); return { error: env.failCommit || env.lostCommit ? Error('offline') : null }; },
  };
  return { env, io };
}
test('saga handles staged retry, upload response loss, resource-only recovery and session commit response loss without changing IDs', async () => {
  const value = await job(true), qa = saga(value); qa.env.lostUpload = true; qa.env.lostCommit = true;
  await confirmHandwritingSave(value, qa.io); assert.equal(qa.env.calls.filter(c => c === 'upload').length, 1);
  const before = structuredClone(qa.env.session); await confirmHandwritingSave(value, qa.io); assert.deepEqual(qa.env.session, before); assert.equal(qa.env.calls.filter(c => c === 'commit').length, 1);
  qa.env.session = null; await confirmHandwritingSave(value, qa.io); assert.deepEqual(qa.env.session, before); assert.equal(qa.env.calls.filter(c => c === 'upload').length, 1);
});
test('read failure, missing RPC, session/resource conflict and equal-size wrong PNG stop without overwrite', async () => {
  const value = await job(true);
  const readFailure = saga(value); readFailure.env.failRead = true; await assert.rejects(confirmHandwritingSave(value, readFailure.io)); assert.ok(!readFailure.env.calls.includes('upload'));
  const missing = saga(value); missing.env.missingRpc = true; await assert.rejects(confirmHandwritingSave(value, missing.io), /schema_unavailable/); assert.ok(missing.env.object); assert.equal(missing.env.session, null);
  const wrong = saga(value); wrong.env.object = new Blob(['x'.repeat(value.png!.size)]); await assert.rejects(confirmHandwritingSave(value, wrong.io), /conflict/); assert.ok(!wrong.env.calls.includes('commit')); assert.ok(!wrong.env.calls.includes('upload'));
  const conflict = saga(value); conflict.env.resource = { ...value.resource, notes: 'other request' }; await assert.rejects(confirmHandwritingSave(value, conflict.io), /conflict/); assert.ok(!conflict.env.calls.includes('upload'));
  const absent = saga(value); absent.env.session = value.session; await assert.rejects(confirmHandwritingSave(value, absent.io), /conflict/);
});
test('reset before upload, after upload, after RPC and readback prevents success; private images are preserved', async () => {
  const value = await job(true);
  for (const stage of ['before', 'upload', 'commit']) {
    const qa = saga(value); if (stage === 'before') qa.env.marker = 'reset'; else if (stage === 'upload') qa.env.afterUpload = () => { qa.env.marker = 'reset'; }; else qa.env.afterCommit = () => { qa.env.marker = 'reset'; qa.env.session = null; };
    await assert.rejects(confirmHandwritingSave(value, qa.io), /reset_changed/);
    if (stage !== 'before') assert.equal(qa.env.object, value.png);
    if (stage === 'upload') assert.ok(!qa.env.calls.includes('commit'));
  }
  const changed = saga(value); changed.env.afterUpload = () => { changed.env.owner = other; }; await assert.rejects(confirmHandwritingSave(value, changed.io), /owner_changed/); assert.ok(!changed.env.calls.includes('commit'));
});
test('only exact storage absence permits upload, never generic 400/403/network errors', () => {
  assert.equal(confirmedObjectAbsent({ code: 'NoSuchKey' }), true); assert.equal(confirmedObjectAbsent({ statusCode: 404 }), true);
  for (const error of [null, Error('offline'), { statusCode: 400, message: 'invalid request' }, { statusCode: 403 }]) assert.equal(confirmedObjectAbsent(error), false);
});
