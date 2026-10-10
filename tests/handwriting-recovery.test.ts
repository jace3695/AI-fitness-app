import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HANDWRITING_LESSONS } from '../app/data/handwritingCourse.ts';
import { HANDWRITING_PACKAGE_FORMAT, handwritingMaterialPath } from '../app/data/handwritingMaterials.ts';
import { HANDWRITING_MAX_PNG_BYTES, emptyHandwritingDraft, freezeRaster, hashBytes, makeHandwritingSave, parseHandwritingRecord, terminalHandwritingRecord, type HandwritingDraft, type FrozenHandwritingSave } from '../lib/handwriting-draft.ts';
import { readHandwritingRecord, writeHandwritingRecord, handwritingVersion } from '../lib/handwriting-local-store.ts';
import { decodeHandwritingStorageRecord, encodeHandwritingStorageRecord, type StoredHandwritingRecord } from '../lib/handwriting-storage-codec.ts';
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
  const values = new Map<string, unknown>(); let tail = Promise.resolve(), quota = false, afterWrite: (() => void) | null = null;
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
        else { if (mode === 'readwrite') { values.clear(); snapshot.forEach((value, key) => values.set(key, value)); afterWrite?.(); } (tx.oncomplete as () => void)?.(); }
        resolve();
      })));
      return tx;
    } };
    setImmediate(() => { request.result = db; (request.onsuccess as () => void)?.(); }); return request;
  } } as unknown as IDBFactory;
  return { factory, values, quota: (value: boolean) => { quota = value; }, afterWrite: (callback: () => void) => { afterWrite = callback; } };
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
test('shipping IDB byte envelope stages exact pending PNG even when native Blob writes are rejected', async () => {
  const adapter = idbAdapter(true), original = await draft(true);
  const first = await writeHandwritingRecord(original, null, adapter.factory);
  const pending = { ...first, pending: await job(true) } as HandwritingDraft;
  const next = await writeHandwritingRecord(pending, handwritingVersion(first), adapter.factory);
  assert.deepEqual(next, { ...pending, revision: first.revision + 1 });
  const stored = [...adapter.values.values()][0] as StoredHandwritingRecord;
  assert.ok(stored.state === 'active' && stored.pending?.png && !(stored.pending.png instanceof Blob));
  assert.equal(stored.pending.png.encoding, 'handwriting-png-bytes-v1');
  assert.equal(await hashBytes(stored.pending.png.bytes), pending.pending!.pngSha256);
  assert.deepEqual(await readHandwritingRecord(owner, adapter.factory), next);
});
test('legacy Blob records read without migration and tagged bytes decode to the original exact frozen job', async () => {
  const adapter = idbAdapter(), original = await draft(true); original.pending = await job(true); original.revision = 7;
  const key = `${owner}:${original.courseId}`; adapter.values.set(key, structuredClone(original));
  const raw = structuredClone(adapter.values.get(key));
  assert.deepEqual(await readHandwritingRecord(owner, adapter.factory), original);
  assert.deepEqual(adapter.values.get(key), raw, 'A legacy read must not migrate, rewrite, or remove the record');
  const encoded = await encodeHandwritingStorageRecord(original);
  await assert.rejects(parseHandwritingRecord(encoded.stored, owner), /handwriting_draft_invalid/, 'The old Blob-only parser must reject the new explicit encoding');
  const restored = await decodeHandwritingStorageRecord(encoded.stored, owner) as HandwritingDraft;
  assert.deepEqual(restored, original); assert.equal(await hashBytes(restored.pending!.png!), original.pending.pngSha256);
  const flow = saga(restored.pending!); await confirmHandwritingSave(restored.pending!, flow.io);
  assert.deepEqual(flow.env.session, original.pending.session); assert.deepEqual(flow.env.resource, original.pending.resource);
  assert.equal(await hashBytes(flow.env.object!), original.pending.pngSha256);
});
test('unknown or malformed byte envelopes, hashes and metadata fail closed without changing raw storage', async () => {
  const original = await draft(true); original.pending = await job(true); original.revision = 1;
  const { stored } = await encodeHandwritingStorageRecord(original);
  assert.ok(stored.state === 'active' && stored.pending?.png && !(stored.pending.png instanceof Blob));
  const envelope = stored.pending.png;
  const variants = [
    { ...envelope, encoding: 'handwriting-png-bytes-v2' }, { ...envelope, type: 'image/jpeg' }, { ...envelope, extra: true },
    { ...envelope, bytes: [] }, { ...envelope, bytes: new Uint8ClampedArray(envelope.bytes) }, { ...envelope, bytes: new Uint8Array() },
    { ...envelope, bytes: new Uint8Array(HANDWRITING_MAX_PNG_BYTES + 1) },
    { ...envelope, bytes: new Uint8Array(new SharedArrayBuffer(envelope.bytes.length)) },
    { ...envelope, bytes: new Uint8Array(envelope.bytes.length).fill(255) },
  ];
  const records: unknown[] = variants.map(png => ({ ...stored, pending: { ...stored.pending!, png } }));
  records.push({ ...stored, version: 2 });
  records.push({ ...stored, pending: { ...stored.pending!, pngSha256: '0'.repeat(64) } });
  records.push({ ...stored, pending: { ...stored.pending!, resource: { ...stored.pending!.resource!, size_bytes: envelope.bytes.length + 1 } } });
  records.push({ ...stored, pending: { ...stored.pending!, session: { ...stored.pending!.session, memo: 'different job' } } });
  for (const record of records) {
    const adapter = idbAdapter(), key = `${owner}:${original.courseId}`; adapter.values.set(key, record);
    const before = structuredClone(record);
    await assert.rejects(readHandwritingRecord(owner, adapter.factory));
    assert.deepEqual(adapter.values.get(key), before);
  }
  await assert.rejects(decodeHandwritingStorageRecord(stored, other), /invalid/);
});
test('PNG subarray and raster views copy only their exact bytes, excluding unrelated backing data', async () => {
  const original = await draft(true); original.pending = await job(true);
  const backing = new Uint8ClampedArray(32).fill(99); backing.set(original.raster!.pixels, 8);
  original.raster!.pixels = backing.subarray(8, 24);
  const { runtime, stored } = await encodeHandwritingStorageRecord(original);
  assert.ok(runtime.state === 'active' && stored.state === 'active' && stored.pending?.png && !(stored.pending.png instanceof Blob));
  assert.equal(runtime.raster!.pixels.byteOffset, 0); assert.equal(runtime.raster!.pixels.buffer.byteLength, 16);
  const png = stored.pending.png, whole = new Uint8Array(png.bytes.length + 12).fill(123); whole.set(png.bytes, 5);
  const wire = { ...stored, pending: { ...stored.pending, png: { ...png, bytes: whole.subarray(5, 5 + png.bytes.length) } } };
  const decoded = await decodeHandwritingStorageRecord(wire, owner) as HandwritingDraft;
  assert.equal(decoded.pending!.png!.size, png.bytes.length); assert.equal(await hashBytes(decoded.pending!.png!), original.pending.pngSha256);
  whole.fill(0); assert.equal(await hashBytes(decoded.pending!.png!), original.pending.pngSha256, 'Decoded Blob owns an immutable copy');
  const detached = new Uint8Array(png.bytes); structuredClone(detached, { transfer: [detached.buffer] });
  await assert.rejects(decodeHandwritingStorageRecord({ ...stored, pending: { ...stored.pending, png: { ...png, bytes: detached } } }, owner), /handwriting_draft_invalid/);
  assert.equal(detached.byteLength, 0);
});
test('snapshot bounds reject oversized PNG before reading bytes or opening an IDB transaction', async () => {
  const original = await draft(true); original.pending = await job(true);
  original.pending.png = new Blob([new Uint8Array(HANDWRITING_MAX_PNG_BYTES + 1)], { type: 'image/png' });
  const factory = { open() { assert.fail('Invalid image must not open a transaction'); } } as unknown as IDBFactory;
  await assert.rejects(writeHandwritingRecord(original, null, factory), /handwriting_draft_invalid/);
});
function delayBlobRead(call: number) {
  const native = Blob.prototype.arrayBuffer;
  let entered!: () => void, release!: () => void, count = 0;
  const arrived = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  Blob.prototype.arrayBuffer = async function () { if (++count === call) { entered(); await gate; } return native.call(this); };
  return { arrived, release, restore: () => { Blob.prototype.arrayBuffer = native; } };
}
test('the complete write and CAS snapshot precedes delayed validation and PNG conversion', async () => {
  for (const delayedCall of [1, 2]) {
    const adapter = idbAdapter(true), original = await draft(true), first = await writeHandwritingRecord(original, null, adapter.factory);
    const input = { ...first, pending: await job(true) } as HandwritingDraft, expected = handwritingVersion(first)!;
    const before = structuredClone(input), prior = { ...expected }, delay = delayBlobRead(delayedCall);
    try {
      const writing = writeHandwritingRecord(input, expected, adapter.factory);
      await Promise.race([delay.arrived, writing.then(() => assert.fail('The targeted asynchronous boundary must be observed'))]);
      input.owner = other; input.reflection = 'late mutation'; input.raster!.pixels.fill(0); input.undo[0].raster.pixels.fill(255);
      input.lesson.steps[0] = 'changed lesson'; input.pending!.session.memo = 'changed request'; expected.revision = 999;
      delay.release(); const result = await writing;
      assert.deepEqual(result, { ...before, revision: prior.revision + 1 });
      assert.equal(adapter.values.has(`${other}:${original.courseId}`), false);
    } finally { delay.release(); delay.restore(); }
  }
});
test('an intervening writer wins during PNG conversion and stale encoded bytes cannot overwrite it', async () => {
  const adapter = idbAdapter(true), first = await writeHandwritingRecord(await draft(true), null, adapter.factory);
  const input = { ...first, pending: await job(true) } as HandwritingDraft, delay = delayBlobRead(2);
  try {
    const writing = writeHandwritingRecord(input, handwritingVersion(first), adapter.factory);
    await Promise.race([delay.arrived, writing.then(() => assert.fail('Conversion must reach the gate'))]);
    const winner = await writeHandwritingRecord({ ...first, reflection: 'newer tab wins' } as HandwritingDraft, handwritingVersion(first), adapter.factory);
    delay.release(); await assert.rejects(writing, /handwriting_draft_changed/);
    assert.deepEqual(await readHandwritingRecord(owner, adapter.factory), winner);
  } finally { delay.release(); delay.restore(); }
});
test('independent readback rejects equal-size corrupted stored PNG bytes without claiming write success', async () => {
  const adapter = idbAdapter(true), original = await draft(true); original.pending = await job(true);
  adapter.afterWrite(() => {
    const stored = [...adapter.values.values()][0] as StoredHandwritingRecord;
    assert.ok(stored.state === 'active' && stored.pending?.png && !(stored.pending.png instanceof Blob));
    stored.pending.png.bytes[0] ^= 1;
  });
  await assert.rejects(writeHandwritingRecord(original, null, adapter.factory), /handwriting_draft_invalid/);
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
