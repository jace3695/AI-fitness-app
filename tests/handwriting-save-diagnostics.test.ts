import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { observeHandwritingSaveBoundary, sanitizeHandwritingSaveBoundary } from './e2e/handwriting-save-diagnostics.ts';

function harness() {
  let callback: BlobCallback | undefined;
  const calls: { receiver: unknown; args: unknown[] }[] = [];
  let thrown: unknown, returned: unknown = { nativeReturn: true };
  class Canvas {
    label = '수업 손글씨 연습장';
    getAttribute(name: string) { assert.equal(name, 'aria-label'); return this.label; }
    toBlob(...args: unknown[]) { calls.push({ receiver: this, args }); if (thrown) throw thrown; callback = args[0] as BlobCallback; return returned; }
  }
  class Transaction extends EventTarget { db = { name: 'yeoni-handwriting' }; error: unknown = null; }
  class Request extends EventTarget { error: unknown = null; }
  class Store {
    name = 'slots'; transaction = new Transaction(); request = new Request();
    put(...args: unknown[]) { calls.push({ receiver: this, args }); if (thrown) throw thrown; return this.request; }
  }
  const window = {} as { __qaHandwritingSaveBoundary: Record<string, unknown> };
  vm.runInNewContext(`(${observeHandwritingSaveBoundary.toString()})()`, { window, HTMLCanvasElement: Canvas, IDBObjectStore: Store, Blob });
  return { canvas: new Canvas(), store: new Store(), calls, state: window.__qaHandwritingSaveBoundary,
    callback: () => callback!, throw: (value: unknown) => { thrown = value; }, returned: () => returned,
    return: (value: unknown) => { returned = value; } };
}
const png = () => new Blob(['synthetic image only'], { type: 'image/png' });

test('PNG observer forwards receiver, native arguments/return, callback receiver and bytes', () => {
  const qa = harness(), blob = png(), callbackReceiver = { callbackReceiver: true };
  let received: unknown, receiver: unknown;
  function callback(this: unknown, value: Blob | null) { received = value; receiver = this; }
  assert.equal(qa.canvas.toBlob(callback, 'image/png', .8), qa.returned());
  assert.equal(qa.calls[0].receiver, qa.canvas);
  assert.deepEqual(qa.calls[0].args.slice(1), ['image/png', .8]);
  assert.equal(qa.state.phase, 'encoding-png');
  qa.callback().call(callbackReceiver, blob);
  assert.equal(received, blob); assert.equal(receiver, callbackReceiver);
  assert.equal(qa.state.phase, 'encoded-png'); assert.equal(qa.state.encodingPngValid, true);
});
test('unrelated canvas and invalid callback remain untouched', () => {
  const qa = harness(), callback = () => {};
  qa.canvas.label = 'another canvas'; qa.canvas.toBlob(callback);
  assert.equal(qa.calls[0].args[0], callback); assert.equal(qa.state.phase, 'idle');
  qa.canvas.label = '수업 손글씨 연습장'; qa.canvas.toBlob(null);
  assert.deepEqual(qa.calls[1].args, [null]); assert.equal(qa.state.phase, 'idle');
  qa.canvas.toBlob(); assert.deepEqual(qa.calls[2].args, []);
});
test('PNG observer preserves null callback result and original native/callback failures', () => {
  const qa = harness(); let received: unknown = 'waiting';
  qa.canvas.toBlob((value: Blob | null) => { received = value; }); qa.callback()(null);
  assert.equal(received, null); assert.equal(qa.state.encodingPngValid, false);
  const nativeError = new DOMException('private native detail', 'NotSupportedError'); qa.throw(nativeError);
  assert.throws(() => qa.canvas.toBlob(() => {}), error => error === nativeError);
  assert.equal(qa.state.errorName, 'NotSupportedError'); assert.equal(qa.state.errorBoundary, 'png-call');
  qa.throw(null); const callbackError = new Error('private callback detail');
  qa.canvas.toBlob(() => { throw callbackError; });
  assert.throws(() => qa.callback()(png()), error => error === callbackError);
  assert.ok(!JSON.stringify(qa.state).includes('private'));
});
test('pending IDB observer preserves exact put and independently observes commit events', () => {
  const qa = harness(), value = { pending: { png: png() } }, key = 'private-owner:private-slot';
  assert.equal(qa.store.put(value, key), qa.store.request);
  assert.equal(qa.calls[0].receiver, qa.store); assert.equal(qa.calls[0].args[0], value); assert.equal(qa.calls[0].args[1], key);
  assert.equal(qa.state.pendingPutAttempted, true); assert.equal(qa.state.pendingPutHasBlob, true); assert.equal(qa.state.pendingPutReturned, true);
  qa.store.request.dispatchEvent(new Event('success'));
  assert.equal(qa.state.pendingRequestSucceeded, true); assert.equal(qa.state.pendingTransactionCompleted, false);
  qa.store.transaction.dispatchEvent(new Event('complete'));
  assert.equal(qa.state.phase, 'pending-transaction-completed'); assert.equal(qa.calls.length, 1);
  assert.ok(!JSON.stringify(qa.state).includes('private'));
});
test('other DBs/stores and unstaged drafts are not observed', () => {
  for (const kind of ['db', 'store', 'draft']) {
    const qa = harness(), value = { pending: kind === 'draft' ? null : { png: png() } };
    if (kind === 'db') qa.store.transaction.db.name = 'unrelated-db';
    if (kind === 'store') qa.store.name = 'another-store';
    assert.equal(qa.store.put(value), qa.store.request); assert.equal(qa.calls[0].args.length, 1); assert.equal(qa.state.phase, 'idle');
  }
});
test('pending IDB failure is never prevented, retried or replaced; originating name survives abort', () => {
  const qa = harness(); qa.store.put({ pending: { png: png() } });
  qa.store.request.error = new DOMException('secret blob URL', 'UnknownError');
  const requestError = new Event('error', { cancelable: true }); qa.store.request.dispatchEvent(requestError);
  assert.equal(requestError.defaultPrevented, false); assert.equal(qa.state.pendingRequestFailed, true);
  qa.store.transaction.error = new DOMException('private abort detail', 'AbortError');
  qa.store.transaction.dispatchEvent(new Event('abort'));
  assert.equal(qa.state.phase, 'pending-transaction-aborted'); assert.equal(qa.state.errorName, 'UnknownError'); assert.equal(qa.state.errorBoundary, 'pending-request');
  assert.equal(qa.calls.length, 1); assert.ok(!JSON.stringify(qa.state).includes('secret'));
  const nativeError = new DOMException('private quota detail', 'QuotaExceededError'); qa.throw(nativeError);
  assert.throws(() => qa.store.put({ pending: { png: png() } }), error => error === nativeError);
  assert.equal(qa.state.errorBoundary, 'pending-put'); assert.equal(qa.state.errorName, 'QuotaExceededError');
});
test('diagnostic error inspection cannot replace a thrown native value', () => {
  const qa = harness(), error = { get name() { throw new Error('sensitive getter'); } };
  qa.throw(error); assert.throws(() => qa.store.put({ pending: { png: png() } }), thrown => thrown === error);
  assert.equal(qa.state.errorName, 'other');
});
test('hostile pre-call observation still forwards native canvas and store calls exactly once', () => {
  const qa = harness(), callback = () => {};
  qa.canvas.getAttribute = () => { throw new Error('observer failure'); };
  assert.equal(qa.canvas.toBlob(callback, 'image/png'), qa.returned());
  assert.equal(qa.calls[0].args[0], callback); assert.equal(qa.calls[0].receiver, qa.canvas);
  Object.defineProperty(qa.store, 'name', { get() { throw new Error('observer failure'); } });
  const value = { pending: { png: png() } };
  assert.equal(qa.store.put(value, 'slot'), qa.store.request);
  assert.equal(qa.calls[1].args[0], value); assert.equal(qa.calls[1].receiver, qa.store); assert.equal(qa.calls.length, 2);
});
test('frozen diagnostic state cannot prevent the native operation, callback or original error', () => {
  const qa = harness(), blob = png(); Object.freeze(qa.state);
  let called = 0; qa.canvas.toBlob((value: Blob | null) => { called++; assert.equal(value, blob); }); qa.callback()(blob);
  assert.equal(called, 1); assert.equal(qa.store.put({ pending: { png: blob } }), qa.store.request);
  const error = new Error('native failure'); qa.throw(error);
  assert.throws(() => qa.store.put({ pending: { png: blob } }), thrown => thrown === error);
  assert.throws(() => qa.canvas.toBlob(() => {}), thrown => thrown === error);
  assert.equal(qa.calls.length, 4);
});
test('listener installation failure cannot replace a successful native IDB request', () => {
  for (const target of ['request', 'transaction'] as const) {
    const qa = harness();
    const eventTarget = target === 'request' ? qa.store.request : qa.store.transaction;
    eventTarget.addEventListener = () => { throw new Error('observer listener failure'); };
    assert.equal(qa.store.put({ pending: { png: png() } }), qa.store.request);
    assert.equal(qa.calls.length, 1); assert.equal(qa.state.errorBoundary, 'none');
  }
});
test('event observer failures cannot prevent the original event handlers', () => {
  const qa = harness(); qa.store.put({ pending: { png: png() } });
  let success = 0, completed = 0;
  qa.store.request.addEventListener('success', () => { success++; });
  qa.store.transaction.addEventListener('complete', () => { completed++; });
  Object.freeze(qa.state);
  qa.store.request.dispatchEvent(new Event('success')); qa.store.transaction.dispatchEvent(new Event('complete'));
  assert.equal(success, 1); assert.equal(completed, 1);
});
test('exported boundary summary drops unknown fields and non-enum/nonboolean contents', () => {
  const value = sanitizeHandwritingSaveBoundary({ phase: 'private text', errorBoundary: 'private-url', errorName: 'eyJ-private', encodingRequested: 'true', pendingPutHasBlob: true, user: 'secret-owner', png: png() });
  assert.equal(value.phase, 'unknown'); assert.equal(value.errorBoundary, 'unknown'); assert.equal(value.errorName, 'unknown');
  assert.equal(value.encodingRequested, null); assert.equal(value.pendingPutHasBlob, true);
  assert.ok(!/secret|private|eyJ/.test(JSON.stringify(value)));
});
