import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freezeBatch, transitionBatchDelivery, verifyFrozenBatch } from './outbox.ts';
import { answer, presentation } from './local-test-fixtures.ts';
import { id } from './test-fixtures.ts';

test('frozen batches require one owner/generation/slot and contiguous order with exact predecessor', async () => {
  const start = await presentation(), submitted = await answer(start.checkpoint);
  const batch = await freezeBatch(id(), [start.event!, submitted.event!], null); await verifyFrozenBatch(batch);
  assert.ok(Object.isFrozen(batch.events)); assert.ok(Object.isFrozen(batch.events[0]));
  await freezeBatch(id(), [submitted.event!], start.checkpoint.predecessor);
  for (const values of [[submitted.event!, start.event!], [submitted.event!], [start.event!, start.event!], [start.event!, (await presentation()).event!]]) {
    await assert.rejects(freezeBatch(id(), values, null), /event_conflict/);
  }
  await assert.rejects(freezeBatch(id(), [], null), /batch_limit/);
  await assert.rejects(freezeBatch(id(), Array(51).fill(start.event!), null), /batch_limit/);
});
test('delivery transitions can only remain pending readback or quarantine, never acknowledge caller hashes', () => {
  const initial = { revision: 1, status: 'pending' as const };
  const attempted = transitionBatchDelivery(initial, initial, 'append_attempted');
  assert.equal(attempted.status, 'readback_required');
  assert.equal(transitionBatchDelivery(attempted, attempted, 'readback_missing').status, 'readback_required');
  assert.equal(transitionBatchDelivery(attempted, attempted, 'readback_failed').status, 'readback_required');
  assert.throws(() => transitionBatchDelivery(attempted, initial, 'append_attempted'), /checkpoint_conflict/);
  const quarantined = transitionBatchDelivery(attempted, attempted, 'conflict');
  assert.throws(() => transitionBatchDelivery(quarantined, quarantined, 'append_attempted'), /quarantined/);
});
