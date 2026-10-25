import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForDietPhoto } from './dietPhotoWait.ts';

test('already cancelled preparation never starts and cannot dispatch a later step', async () => {
  const c = new AbortController(); c.abort(new Error('cancelled'));
  let calls = 0;
  await assert.rejects(waitForDietPhoto(c.signal, async () => { calls++; }), /cancelled/);
  assert.equal(calls, 0);
});

test('cancelled pending work releases caller and ignores a late success', async () => {
  const c = new AbortController(); let finish!: (value: number) => void;
  const pending = waitForDietPhoto(c.signal, () => new Promise<number>(r => { finish = r; }));
  await Promise.resolve(); c.abort(new Error('bounded wait'));
  await assert.rejects(pending, /bounded wait/);
  finish(123);
  let calls = 0;
  await assert.rejects(waitForDietPhoto(c.signal, async () => { calls++; }), /bounded wait/);
  assert.equal(calls, 0);
});

test('success and failure remove the abort listener', async () => {
  const c = new AbortController(); let added = 0; let removed = 0;
  const add = c.signal.addEventListener.bind(c.signal), remove = c.signal.removeEventListener.bind(c.signal);
  c.signal.addEventListener = (...args: Parameters<AbortSignal['addEventListener']>) => { added++; return add(...args); };
  c.signal.removeEventListener = (...args: Parameters<AbortSignal['removeEventListener']>) => { removed++; return remove(...args); };
  assert.equal(await waitForDietPhoto(c.signal, async () => 7), 7);
  await assert.rejects(waitForDietPhoto(c.signal, async () => { throw Error('failed'); }), /failed/);
  assert.equal(added, 2); assert.equal(removed, 2);
});
