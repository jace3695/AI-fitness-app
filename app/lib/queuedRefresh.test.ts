import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueuedRefresh } from './queuedRefresh.ts';

test('a mutation during a read waits for a fresh read instead of losing its refresh', async () => {
  let server = 'before';
  let visible = '';
  let reads = 0;
  let finishFirst!: () => void;
  const firstRead = new Promise<void>(resolve => { finishFirst = resolve; });
  const refresh = createQueuedRefresh(async () => {
    reads++;
    const snapshot = server;
    if (reads === 1) await firstRead;
    visible = snapshot;
  });
  const initial = refresh();
  await Promise.resolve();
  server = 'saved';
  const afterMutation = refresh();
  const afterFocus = refresh();
  finishFirst();
  await Promise.all([initial, afterMutation, afterFocus]);
  assert.equal(reads, 2);
  assert.equal(visible, 'saved');
});

test('a failed read releases the lock for retry', async () => {
  let reads = 0;
  const refresh = createQueuedRefresh(async () => { if (++reads === 1) throw new Error('offline'); });
  await assert.rejects(refresh(), /offline/);
  await refresh();
  assert.equal(reads, 2);
});
