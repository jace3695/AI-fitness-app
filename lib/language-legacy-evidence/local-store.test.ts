import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeterministicIDBAdapter } from './idb-test-adapter.ts';
import { LocalEvidenceStore, checkpointStorageKey, eventStorageKey } from './local-store.ts';
import { prepareCheckpointTransition, preparePresentation } from './capture.ts';
import { decodeFrozenEvidence } from './canonical-hash.ts';
import { answer, localContext, presentation } from './local-test-fixtures.ts';
import { freezeBatch } from './outbox.ts';
import { catalogue, episode, id, uuid } from './test-fixtures.ts';
import { makeSourceSlotKey } from './validation.ts';
import type { LocalFence, LocalEvidenceContext } from './persistence-types.ts';

function harness() {
  const adapter = createDeterministicIDBAdapter();
  const state = { fence: localContext() as LocalFence };
  const isCurrent = (value: LocalFence) => value.ownerId === state.fence.ownerId && value.generationId === state.fence.generationId && value.ownerEpoch === state.fence.ownerEpoch;
  const store = new LocalEvidenceStore({ factory: adapter.factory, isCurrent });
  return { adapter, state, store, reopen: () => new LocalEvidenceStore({ factory: adapter.factory, isCurrent }) };
}
async function scopedPresentation(context: LocalEvidenceContext) {
  const event = episode(0)[0]; event.generationId = context.generationId; event.sourceSlotKey = makeSourceSlotKey(context.ownerId, event);
  return preparePresentation({ transitionId: id(), event, actualVisible: true, history: 'new_session', timingObserved: true }, context, catalogue);
}
test('IDB atomically commits frozen event/checkpoint/handoff and exact replay returns latest applied checkpoint', async () => {
  const qa = harness(), start = await presentation(); await qa.store.commit(start);
  const submitted = await answer(start.checkpoint); await qa.store.commit(submitted);
  assert.deepEqual(await qa.store.readCheckpoint(start.fence, start.checkpoint.sourceSlotKey), submitted.checkpoint);
  const applied = prepareCheckpointTransition(submitted.checkpoint, { kind: 'compatibility_applied', eventId: submitted.event!.eventId, survivingDraftToken: 'exact-surviving-draft-v1' }, localContext(), id());
  await qa.store.commit(applied);
  const replay = await qa.reopen().commit(submitted);
  assert.equal(replay.replay, true); assert.equal(replay.checkpoint.handoff!.status, 'applied');
  assert.equal(qa.adapter.entries('events').length, 2); assert.equal(qa.adapter.entries('checkpoints').length, 1);
  assert.equal(qa.adapter.connectionCount(), 0);
});
test('two tabs, duplicate submissions and independent slots are atomic; divergent answer never rebases', async () => {
  const qa = harness(), start = await presentation();
  await Promise.all([qa.store.commit(start), qa.reopen().commit(start)]);
  assert.equal(qa.adapter.entries('events').length, 1);
  const a = await answer(start.checkpoint, true), b = await answer(start.checkpoint, false);
  const results = await Promise.allSettled([qa.store.commit(a), qa.reopen().commit(b)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(qa.adapter.entries('events').length, 2);
  const winner = (await qa.store.readCheckpoint(start.fence, start.checkpoint.sourceSlotKey))!;
  assert.equal(winner.nextSequence, 2);
  const unrelated = await presentation(); await qa.store.commit(unrelated);
  assert.equal(qa.adapter.entries('checkpoints').length, 2);
  await assert.rejects(qa.store.commit(winner.predecessor.eventId === a.event!.eventId ? b : a), /checkpoint_conflict/);
});
test('same lesson source slot cannot acquire a second random episode', async () => {
  const qa = harness(), event = episode(0)[0];
  event.source = 'course_lesson'; event.lessonSessionId = 'original-session'; event.sourceSlotKey = makeSourceSlotKey(localContext().ownerId, event);
  const first = await preparePresentation({ transitionId: id(), event, actualVisible: true, history: 'new_session', timingObserved: true }, localContext(), catalogue);
  await qa.store.commit(first);
  const second = await preparePresentation({ transitionId: id(), event: { ...event, eventId: id(), episodeId: id() }, actualVisible: true, history: 'new_session', timingObserved: true }, localContext(), catalogue);
  await assert.rejects(qa.store.commit(second), /checkpoint_conflict/);
  assert.equal(qa.adapter.entries('events').length, 1);
});
test('quota and abort preserve all-or-none events, checkpoint and compatibility input', async () => {
  for (const fault of ['quota', 'abort'] as const) {
    const qa = harness(), start = await presentation(); await qa.store.commit(start); const submitted = await answer(start.checkpoint);
    if (fault === 'quota') qa.adapter.quotaNextWrite();
    else qa.adapter.beforeNextTransaction('readonly', () => qa.adapter.abortNextTransaction());
    await assert.rejects(qa.store.commit(submitted), /storage_quota|storage_abort/);
    assert.deepEqual(await qa.store.readCheckpoint(start.fence, start.checkpoint.sourceSlotKey), start.checkpoint);
    assert.equal(await qa.store.readEvent(start.fence, submitted.event!.eventId), null);
    assert.equal(qa.adapter.entries('delivery').length, 1); assert.equal(qa.adapter.entries('commits').length, 1);
    await qa.store.commit(submitted); assert.equal(qa.adapter.entries('events').length, 2);
  }
});
test('lost commit response is read back; failed readback remains unconfirmed then reuses exact IDs on retry', async () => {
  const qa = harness(), start = await presentation(); qa.adapter.loseNextCommitResponse();
  assert.equal((await qa.store.commit(start)).status, 'local_committed');
  const submitted = await answer(start.checkpoint); qa.adapter.afterNextWriteCommit(() => qa.adapter.failNextRead());
  await assert.rejects(qa.store.commit(submitted), /commit_unconfirmed/);
  assert.equal(qa.adapter.entries('events').length, 2);
  const retried = await qa.reopen().commit(submitted); assert.equal(retried.replay, true);
  assert.equal(qa.adapter.entries('events').length, 2);
  assert.deepEqual(await qa.store.readEvent(start.fence, submitted.event!.eventId), submitted.event);
});
test('unavailable/blocked IDB and versionchange fail visibly, without fallback or an invented capture', async () => {
  const start = await presentation();
  await assert.rejects(new LocalEvidenceStore({ isCurrent: () => true }).commit(start), /idb_unavailable/);
  const blocked = harness(); blocked.adapter.blockNextOpen(); await assert.rejects(blocked.store.commit(start), /idb_blocked/);
  const changing = harness(); changing.adapter.beforeNextTransaction('readwrite', () => changing.adapter.versionchange());
  await assert.rejects(changing.store.commit(start), /idb_version_changed/);
  assert.equal(changing.adapter.entries('events').length, 0); assert.equal(changing.adapter.entries('commits').length, 0);
});
test('owner/generation/epoch fences reject before commit and hide a commit completed during owner change', async () => {
  const qa = harness(), start = await presentation();
  qa.state.fence = { ...start.fence, ownerId: uuid(99) };
  await assert.rejects(qa.store.commit(start), /stale_context/);
  qa.state.fence = start.fence; qa.adapter.afterNextWriteCommit(() => { qa.state.fence = { ...start.fence, ownerEpoch: 2 }; });
  await assert.rejects(qa.store.commit(start), /stale_context/);
  assert.equal(qa.adapter.entries('events').length, 1);
  await assert.rejects(qa.store.commit(start), /stale_context/);
  assert.deepEqual(await qa.store.readEvent(qa.state.fence, start.event!.eventId), start.event);
  const prepared = await presentation(), freezing = harness(); const pending = freezing.store.commit(prepared);
  freezing.state.fence = { ...prepared.fence, generationId: uuid(44) };
  await assert.rejects(pending, /stale_context/);
});
test('checkpoint tampering is corrupt, never clean provenance; divergent same-ID bytes are persistently quarantined', async () => {
  const qa = harness(), start = await presentation(); await qa.store.commit(start);
  const hint = prepareCheckpointTransition(start.checkpoint, { kind: 'hint' }, localContext(), id()); await qa.store.commit(hint);
  qa.adapter.tamper('checkpoints', checkpointStorageKey(start.fence.ownerId, start.fence.generationId, start.checkpoint.sourceSlotKey), value => {
    const row = value as { value: { hintUsed: boolean; answerPreviouslyRevealed: boolean } }; row.value.hintUsed = false; row.value.answerPreviouslyRevealed = false; return row;
  });
  await assert.rejects(qa.store.readCheckpoint(start.fence, start.checkpoint.sourceSlotKey), /corrupt_record/);
  await assert.rejects(qa.store.commit(await answer(start.checkpoint)), /corrupt_record/);
  const clean = harness(); await clean.store.commit(start);
  const event = decodeFrozenEvidence(start.event!); event.hintUsed = true;
  const divergent = await preparePresentation({ transitionId: id(), event, actualVisible: true, history: 'new_session', timingObserved: true }, localContext(), catalogue);
  await assert.rejects(clean.store.commit(divergent), /event_conflict/);
  const recovered = await clean.reopen().recoverOutbox(start.fence);
  assert.equal(recovered.status, 'quarantined'); assert.equal(recovered.events[0].delivery.status, 'quarantined');
  assert.equal(recovered.events[0].event.canonical, start.event!.canonical);
  await assert.rejects(clean.store.commit(start), /quarantined/);
  await assert.rejects(clean.store.commit(await answer(start.checkpoint)), /quarantined/);
  await assert.rejects(clean.store.putBatch(start.fence, await freezeBatch(id(), [start.event!], null)), /quarantined/);
});
test('frozen batch survives restart, preserves predecessor and excludes local raw answers; caps never evict', async () => {
  const qa = harness(), start = await presentation(); await qa.store.commit(start);
  const submitted = await answer(start.checkpoint); await qa.store.commit(submitted);
  const batch = await freezeBatch(id(), [start.event!, submitted.event!], null); await qa.store.putBatch(start.fence, batch); await qa.store.putBatch(start.fence, batch);
  await qa.store.markReadbackRequired(start.fence, submitted.event!, 1);
  const recovered = await qa.reopen().recoverOutbox(start.fence);
  assert.equal(recovered.status, 'pending'); assert.deepEqual(recovered.batches[0].batch, batch);
  assert.equal(recovered.events.find(entry => entry.event.eventId === submitted.event!.eventId)!.delivery.status, 'readback_required');
  assert.ok(!JSON.stringify(recovered).includes('合成入力だけ'));
  await assert.rejects(qa.store.recoverOutbox(start.fence, 1), /batch_limit/);
  assert.equal(qa.adapter.entries('events').length, 2);
  const wrongPrior = await freezeBatch(id(), [submitted.event!], { ...start.checkpoint.predecessor, payloadHash: 'a'.repeat(64) });
  await assert.rejects(qa.store.putBatch(start.fence, wrongPrior), /event_conflict/);
  assert.equal(qa.adapter.entries('batches').length, 1);
});
test('owner-scoped stale-generation cleanup preserves fresh generation and other owner, including retry', async () => {
  const qa = harness(), old = await presentation(); await qa.store.commit(old);
  const freshContext = { ...localContext(), generationId: uuid(800) }, fresh = await scopedPresentation(freshContext);
  qa.state.fence = fresh.fence; await qa.store.commit(fresh);
  const other = await scopedPresentation({ ...localContext(), ownerId: uuid(801) }); qa.state.fence = other.fence; await qa.store.commit(other);
  qa.state.fence = fresh.fence;
  await assert.rejects(qa.store.cleanupStaleGenerations({ ...freshContext, freshness: 'cached_offline' }), /stale_context/);
  await qa.store.cleanupStaleGenerations(freshContext); await qa.store.cleanupStaleGenerations(freshContext);
  assert.equal(qa.adapter.inspect('events', eventStorageKey(old.fence.ownerId, old.event!.eventId)), undefined);
  assert.ok(qa.adapter.inspect('events', eventStorageKey(fresh.fence.ownerId, fresh.event!.eventId)));
  assert.ok(qa.adapter.inspect('events', eventStorageKey(other.fence.ownerId, other.event!.eventId)));
  assert.equal(qa.adapter.entries('events').length, 2);
  await assert.rejects(qa.store.cleanupStaleGenerations(localContext()), /stale_context/);
});
test('audio request IDs bind once per owner/generation and cannot qualify another episode or later request', async () => {
  const qa = harness(), a = await presentation(), b = await presentation(); await qa.store.commit(a); await qa.store.commit(b);
  const requestId = id();
  const requestA = prepareCheckpointTransition(a.checkpoint, { kind: 'audio_requested', requestId,
    sourceSlotKey: a.checkpoint.sourceSlotKey, episodeId: a.checkpoint.episodeId, promptMatchesTask: true }, localContext(), id());
  await qa.store.commit(requestA); await qa.store.commit(requestA);
  const requestB = prepareCheckpointTransition(b.checkpoint, { kind: 'audio_requested', requestId,
    sourceSlotKey: b.checkpoint.sourceSlotKey, episodeId: b.checkpoint.episodeId, promptMatchesTask: true }, localContext(), id());
  await assert.rejects(qa.store.commit(requestB), /event_conflict/);
  assert.deepEqual(await qa.store.readCheckpoint(b.fence, b.checkpoint.sourceSlotKey), b.checkpoint);
  assert.equal(qa.adapter.entries('audioBindings').length, 1);
});
test('read failures do not mean empty outbox, and SecurityError is a visible storage-unavailable result', async () => {
  const qa = harness(), start = await presentation(); await qa.store.commit(start); qa.adapter.failNextRead();
  await assert.rejects(qa.store.recoverOutbox(start.fence), /storage_read_failed/);
  assert.equal(qa.adapter.entries('events').length, 1);
  const blockedFactory = { open() { throw new DOMException('blocked', 'SecurityError'); } } as unknown as IDBFactory;
  await assert.rejects(new LocalEvidenceStore({ factory: blockedFactory, isCurrent: () => true }).commit(start), /idb_unavailable/);
});
test('cleanup rejects corrupted owner/generation wrappers before deleting any row, preserving other owners', async () => {
  for (const name of ['events', 'delivery', 'checkpoints', 'commits', 'batches', 'audioBindings'] as const) for (const changed of ['ownerId', 'generationId'] as const) {
    const qa = harness(), old = await presentation(); await qa.store.commit(old);
    const otherContext = { ...localContext(), ownerId: uuid(901) }, other = await scopedPresentation(otherContext); qa.state.fence = other.fence; await qa.store.commit(other);
    await qa.store.putBatch(other.fence, await freezeBatch(id(), [other.event!], null));
    await qa.store.commit(prepareCheckpointTransition(other.checkpoint, { kind: 'audio_requested', requestId: id(), sourceSlotKey: other.checkpoint.sourceSlotKey,
      episodeId: other.checkpoint.episodeId, promptMatchesTask: true }, otherContext, id()));
    const rows = qa.adapter.entries(name);
    const target = rows.find(([, value]) => (value as { ownerId: string }).ownerId === other.fence.ownerId)!;
    qa.adapter.tamper(name, target[0], value => ({ ...(value as object), [changed]: changed === 'ownerId' ? old.fence.ownerId : uuid(903) }));
    const fresh = { ...localContext(), generationId: uuid(902) }; qa.state.fence = fresh;
    const before = qa.adapter.entries('events');
    await assert.rejects(qa.store.cleanupStaleGenerations(fresh), /corrupt_record/);
    assert.deepEqual(qa.adapter.entries('events'), before);
    assert.ok(qa.adapter.inspect('events', eventStorageKey(other.fence.ownerId, other.event!.eventId)));
    assert.ok(qa.adapter.inspect('events', eventStorageKey(old.fence.ownerId, old.event!.eventId)));
  }
});
