import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { prepareAnswer, prepareCheckpointTransition, preparePresentation, verifyPreparedCapture } from './capture.ts';
import { decodeFrozenEvidence } from './canonical-hash.ts';
import { canonicalEvidence, makeSourceSlotKey } from './validation.ts';
import { answer, localContext, presentation } from './local-test-fixtures.ts';
import { at, catalogue, episode, id, listeningTask, typedTask, uuid } from './test-fixtures.ts';

test('actual presentation and answer are contiguous, immutable and contain no raw compatibility answer', async () => {
  const start = await presentation(), submitted = await answer(start.checkpoint);
  await verifyPreparedCapture(start); await verifyPreparedCapture(submitted);
  assert.equal(start.event!.sequence, 0); assert.equal(submitted.event!.sequence, 1);
  assert.equal(decodeFrozenEvidence(submitted.event!).isRetry, false);
  assert.equal(submitted.checkpoint.answerPreviouslyRevealed, true);
  assert.equal(submitted.checkpoint.handoff!.answer, '合成入力だけ');
  assert.ok(!submitted.event!.canonical.includes('合成入力だけ'));
  assert.ok(Object.isFrozen(submitted.checkpoint.handoff));
  await assert.rejects(answer(submitted.checkpoint), /invalid_input/);
});
test('old answered/lost slots cannot synthesize history; old unattempted remains partial', async () => {
  const event = episode(0)[0];
  for (const history of ['old_attempted', 'lost_checkpoint'] as const) {
    await assert.rejects(preparePresentation({ transitionId: id(), event, actualVisible: true, history, timingObserved: false }, localContext(), catalogue), /unsupported_history/);
  }
  const old = await preparePresentation({ transitionId: id(), event, actualVisible: true, history: 'old_unattempted', timingObserved: false }, localContext(), catalogue);
  const response = decodeFrozenEvidence((await answer(old.checkpoint)).event!);
  assert.equal(response.hintUsed, null); assert.equal(response.answerPreviouslyRevealed, null); assert.equal(response.responseMs, null);
});
test('hint, hide and interruption preserve sticky help, invalidate timing and never guess audio completion', async () => {
  let cp = (await presentation()).checkpoint;
  cp = prepareCheckpointTransition(cp, { kind: 'hint' }, localContext(), id()).checkpoint;
  cp = prepareCheckpointTransition(cp, { kind: 'visibility', visibility: { targetText: false, reading: false, meaning: false, choices: false } }, localContext(), id()).checkpoint;
  cp = prepareCheckpointTransition(cp, { kind: 'interruption' }, localContext(), id()).checkpoint;
  const response = decodeFrozenEvidence((await answer(cp)).event!);
  assert.equal(response.hintUsed, true); assert.equal(response.answerPreviouslyRevealed, true);
  assert.equal(response.responseMs, null); assert.equal(response.timingComplete, false); assert.equal(response.audio.status, 'unknown');
});
test('typed choices and listening target/translation exposure are sticky; ordinary listening choices are allowed', async () => {
  for (const [task, format, field] of [[typedTask, 'typed_answer', 'choices'], [listeningTask, 'listening_choice', 'meaning']] as const) {
    const event = episode(0, { task, format })[0]; event.audio = { status: 'not_requested', promptMatchesTask: null };
    event.textVisibility = { targetText: false, reading: false, meaning: false, choices: false };
    const start = await preparePresentation({ transitionId: id(), event, actualVisible: true, history: 'new_session', timingObserved: true }, localContext(), catalogue);
    const exposed = prepareCheckpointTransition(start.checkpoint, { kind: 'visibility', visibility: { ...event.textVisibility, [field]: true } }, localContext(), id());
    const hidden = prepareCheckpointTransition(exposed.checkpoint, { kind: 'visibility', visibility: event.textVisibility }, localContext(), id());
    assert.equal(decodeFrozenEvidence((await answer(hidden.checkpoint)).event!).answerPreviouslyRevealed, true);
  }
  const event = episode(0, { task: listeningTask, format: 'listening_choice' })[0]; event.audio = { status: 'not_requested', promptMatchesTask: null };
  const start = await preparePresentation({ transitionId: id(), event, actualVisible: true, history: 'new_session', timingObserved: true }, localContext(), catalogue);
  assert.equal(start.checkpoint.answerPreviouslyRevealed, false);
});
test('feedback, exact compatibility match and explicit retry retain chronology; retry is not an answer', async () => {
  const first = await answer((await presentation()).checkpoint, false);
  assert.throws(() => prepareCheckpointTransition(first.checkpoint, { kind: 'retry', occurredAt: at(0, 1100) }, localContext(), id()), /compatibility_pending/);
  assert.throws(() => prepareCheckpointTransition(first.checkpoint, { kind: 'compatibility_applied', eventId: first.event!.eventId, survivingDraftToken: 'different' }, localContext(), id()), /invalid_input/);
  const applied = prepareCheckpointTransition(first.checkpoint, { kind: 'compatibility_applied', eventId: first.event!.eventId, survivingDraftToken: 'exact-surviving-draft-v1' }, localContext(), id());
  const retry = prepareCheckpointTransition(applied.checkpoint, { kind: 'retry', occurredAt: at(0, 1100) }, localContext(), id());
  assert.equal(retry.event, null); assert.equal(retry.checkpoint.nextSequence, 2);
  const second = await answer(retry.checkpoint, true, 2000);
  assert.equal(decodeFrozenEvidence(second.event!).isRetry, true); assert.equal(decodeFrozenEvidence(second.event!).answerPreviouslyRevealed, true);
  await verifyPreparedCapture(applied); await verifyPreparedCapture(retry); await verifyPreparedCapture(second);
});
test('audio requires bound request/start/end, stale callbacks fail and cannot improve a frozen answer', async () => {
  const start = await presentation(), requestId = id(), binding = { sourceSlotKey: start.checkpoint.sourceSlotKey, episodeId: start.checkpoint.episodeId, requestId };
  let cp = prepareCheckpointTransition(start.checkpoint, { kind: 'audio_requested', ...binding, promptMatchesTask: true }, localContext(), id()).checkpoint;
  assert.equal(cp.audio.status, 'unknown');
  assert.throws(() => prepareCheckpointTransition(cp, { kind: 'audio_callback', ...binding, status: 'completed' }, localContext(), id()), /invalid_input/);
  assert.throws(() => prepareCheckpointTransition(cp, { kind: 'audio_callback', ...binding, requestId: id(), status: 'started' }, localContext(), id()), /invalid_input/);
  cp = prepareCheckpointTransition(cp, { kind: 'audio_callback', ...binding, status: 'started' }, localContext(), id()).checkpoint;
  const pending = await answer(cp); assert.equal(decodeFrozenEvidence(pending.event!).audio.status, 'started');
  assert.throws(() => prepareCheckpointTransition(pending.checkpoint, { kind: 'audio_callback', ...binding, status: 'completed' }, localContext(), id()), /invalid_input/);
  cp = prepareCheckpointTransition(cp, { kind: 'audio_callback', ...binding, status: 'completed' }, localContext(), id()).checkpoint;
  cp = prepareCheckpointTransition(cp, { kind: 'audio_callback', ...binding, status: 'failed' }, localContext(), id()).checkpoint;
  assert.throws(() => prepareCheckpointTransition(cp, { kind: 'audio_callback', ...binding, status: 'completed' }, localContext(), id()), /invalid_input/);
});
test('timing overflow, clock reversal, raw-answer overflow and malformed checkpoint are rejected', async () => {
  const start = await presentation(), base = { transitionId: id(), eventId: id(), occurredAt: at(0, 1000), recordTimezone: 'UTC', correct: true, responseMs: 1001,
    handoff: { draftToken: 'v1', answer: 'synthetic', observation: { neededHelp: false, modality: 'meaning' as const } } };
  await assert.rejects(prepareAnswer(start.checkpoint, base, localContext(), catalogue), /invalid_input/);
  await assert.rejects(prepareAnswer(start.checkpoint, { ...base, responseMs: 1, occurredAt: at(-1) }, localContext(), catalogue), /invalid_input/);
  await assert.rejects(prepareAnswer(start.checkpoint, { ...base, responseMs: 1, handoff: { ...base.handoff, answer: 'x'.repeat(4097) } }, localContext(), catalogue));
  const altered = { ...start, checkpoint: { ...start.checkpoint, nextSequence: 4 } };
  await assert.rejects(verifyPreparedCapture(altered), /corrupt_record/);
});
test('explicit undefined optional compatibility fields normalize to JSON absence across subsequent transitions', async () => {
  const start = await presentation();
  const submitted = await prepareAnswer(start.checkpoint, { transitionId: id(), eventId: id(), occurredAt: at(0, 1000), recordTimezone: 'UTC', correct: true, responseMs: null,
    handoff: { draftToken: 'v1', answer: 'synthetic', observation: { responseMs: undefined, neededHelp: false, modality: 'meaning' } } }, localContext(), catalogue);
  const applied = prepareCheckpointTransition(submitted.checkpoint, { kind: 'compatibility_applied', eventId: submitted.event!.eventId, survivingDraftToken: 'v1' }, localContext(), id());
  await verifyPreparedCapture(submitted); await verifyPreparedCapture(applied);
  assert.ok(!Object.hasOwn(submitted.checkpoint.handoff!.observation, 'responseMs'));
  assert.ok(!applied.expected!.canonical.includes('undefined'));
});
test('stored transitions cannot forge initial audio, bypass pending compatibility, or alter reducer output', async () => {
  const start = await presentation(), completedAudio = { status: 'completed' as const, requestId: id(), promptMatchesTask: true };
  await assert.rejects(verifyPreparedCapture({ ...start, checkpoint: { ...start.checkpoint, audio: completedAudio } }), /corrupt_record/);
  const reveal = prepareCheckpointTransition(start.checkpoint, { kind: 'reveal' }, localContext(), id());
  await assert.rejects(verifyPreparedCapture({ ...reveal, checkpoint: { ...reveal.checkpoint, answerPreviouslyRevealed: false, audio: completedAudio } }), /corrupt_record/);
  const submitted = await answer(start.checkpoint), afterAnswer = prepareCheckpointTransition(submitted.checkpoint, { kind: 'reveal' }, localContext(), id());
  await assert.rejects(verifyPreparedCapture({ ...afterAnswer, checkpoint: { ...afterAnswer.checkpoint, handoff: null, answerReady: true } }), /corrupt_record/);
  await assert.rejects(verifyPreparedCapture({ ...submitted, checkpoint: { ...submitted.checkpoint, timingContinuity: 'unknown' } }), /corrupt_record/);
});
test('context epoch and exact entered compatibility input freeze before asynchronous hashing', async () => {
  const start = await presentation(), ctx = localContext();
  const input = { transitionId: id(), eventId: id(), occurredAt: at(0, 1000), recordTimezone: 'UTC', correct: true, responseMs: null,
    handoff: { draftToken: 'v1', answer: 'original synthetic', observation: { neededHelp: false, modality: 'meaning' as const } } };
  const pending = prepareAnswer(start.checkpoint, input, ctx, catalogue);
  ctx.ownerEpoch = 999; input.handoff.answer = 'changed while hashing'; input.eventId = id();
  const frozen = await pending;
  assert.equal(frozen.fence.ownerEpoch, 1); assert.equal(frozen.checkpoint.handoff!.answer, 'original synthetic');
  assert.notEqual(frozen.event!.eventId, input.eventId);
});
test('a new presentation cannot introduce a borrowed audio request outside the bound request transition', async () => {
  const event = episode(0)[0];
  event.audio = { status: 'unknown', requestId: id(), promptMatchesTask: true };
  await assert.rejects(preparePresentation({ transitionId: id(), event, actualVisible: true, history: 'new_session', timingObserved: true }, localContext(), catalogue), /invalid_input/);
  event.audio = { status: 'unknown', promptMatchesTask: null };
  const initial = await preparePresentation({ transitionId: id(), event, actualVisible: true, history: 'new_session', timingObserved: true }, localContext(), catalogue);
  assert.equal(initial.checkpoint.audio.requestId, undefined);
});

test('explicit provenance loss makes false and unknown help/reveal/visibility unknown while retaining every true', async () => {
  for (const hintUsed of [false, null, true]) for (const answerPreviouslyRevealed of [false, null, true]) {
    const event = episode(0, { presentationOnly: true })[0];
    event.hintUsed = hintUsed; event.answerPreviouslyRevealed = answerPreviouslyRevealed;
    event.textVisibility = { targetText: false, reading: null, meaning: true, choices: false };
    const start = await preparePresentation({ transitionId: id(), event, actualVisible: true, history: 'new_session', timingObserved: true }, localContext(), catalogue);
    const lost = prepareCheckpointTransition(start.checkpoint, { kind: 'provenance_loss' }, localContext(), id());
    assert.equal(lost.event, null);
    assert.equal(lost.checkpoint.hintUsed, hintUsed === true ? true : null);
    assert.equal(lost.checkpoint.answerPreviouslyRevealed, answerPreviouslyRevealed === true ? true : null);
    assert.deepEqual(lost.checkpoint.textVisibility, { targetText: null, reading: null, meaning: true, choices: null });
    assert.equal(lost.checkpoint.timingContinuity, 'unknown');
    assert.deepEqual(lost.checkpoint.audio, { status: 'unknown', promptMatchesTask: null });
    assert.equal(lost.checkpoint.nextSequence, start.checkpoint.nextSequence);
    assert.deepEqual(lost.checkpoint.predecessor, start.checkpoint.predecessor);
    assert.deepEqual(lost.checkpoint.presentation, start.checkpoint.presentation);
    assert.equal(lost.expected!.canonical, canonicalEvidence(start.checkpoint));
    assert.equal(lost.checkpoint.lastOccurredAt, start.checkpoint.lastOccurredAt);
    assert.equal(lost.checkpoint.attemptStartedAt, start.checkpoint.attemptStartedAt);
    await verifyPreparedCapture(lost);
    const response = decodeFrozenEvidence((await answer(lost.checkpoint)).event!);
    assert.equal(response.hintUsed, hintUsed === true ? true : null);
    assert.equal(response.answerPreviouslyRevealed, answerPreviouslyRevealed === true ? true : null);
    assert.equal(response.responseMs, null); assert.equal(response.timingComplete, false);
    const repeated = prepareCheckpointTransition(lost.checkpoint, { kind: 'provenance_loss' }, localContext(), id());
    await verifyPreparedCapture(repeated);
    assert.deepEqual({ ...repeated.checkpoint, checkpointRevision: lost.checkpoint.checkpointRevision }, lost.checkpoint);
  }
});

test('provenance loss preserves bound audio identity and immutable answer handoffs without enabling another answer', async () => {
  const start = await presentation(), requestId = id();
  const requested = prepareCheckpointTransition(start.checkpoint, { kind: 'audio_requested', requestId,
    sourceSlotKey: start.checkpoint.sourceSlotKey, episodeId: start.checkpoint.episodeId, promptMatchesTask: true }, localContext(), id());
  const lost = prepareCheckpointTransition(requested.checkpoint, { kind: 'provenance_loss' }, localContext(), id());
  assert.deepEqual(lost.checkpoint.audio, { status: 'unknown', requestId, promptMatchesTask: null });
  await verifyPreparedCapture(lost);
  const submitted = await answer(lost.checkpoint);
  const afterAnswer = prepareCheckpointTransition(submitted.checkpoint, { kind: 'provenance_loss' }, localContext(), id());
  assert.equal(afterAnswer.checkpoint.answerPreviouslyRevealed, true);
  assert.equal(afterAnswer.checkpoint.answerReady, false);
  assert.deepEqual(afterAnswer.checkpoint.handoff, submitted.checkpoint.handoff);
  assert.deepEqual(afterAnswer.checkpoint.predecessor, submitted.checkpoint.predecessor);
  await verifyPreparedCapture(afterAnswer);
  await assert.rejects(answer(afterAnswer.checkpoint), /invalid_input/);
  assert.throws(() => prepareCheckpointTransition(afterAnswer.checkpoint, { kind: 'retry', occurredAt: at(0, 1100) }, localContext(), id()), /compatibility_pending/);
});

test('provenance-loss verifier rejects incomplete demotion, false promotion and extra action fields', async () => {
  const start = await presentation(), lost = prepareCheckpointTransition(start.checkpoint, { kind: 'provenance_loss' }, localContext(), id());
  await assert.rejects(verifyPreparedCapture({ ...lost, checkpoint: { ...lost.checkpoint, hintUsed: false } }), /corrupt_record/);
  await assert.rejects(verifyPreparedCapture({ ...lost, checkpoint: { ...lost.checkpoint, answerPreviouslyRevealed: false } }), /corrupt_record/);
  await assert.rejects(verifyPreparedCapture({ ...lost, checkpoint: { ...lost.checkpoint,
    textVisibility: { ...lost.checkpoint.textVisibility, targetText: false } } }), /corrupt_record/);
  await assert.rejects(verifyPreparedCapture({ ...lost, checkpoint: { ...lost.checkpoint,
    textVisibility: { ...lost.checkpoint.textVisibility, meaning: null } } }), /corrupt_record/);
  await assert.rejects(verifyPreparedCapture({ ...lost, checkpoint: { ...lost.checkpoint, timingContinuity: 'continuous' } }), /corrupt_record/);
  await assert.rejects(verifyPreparedCapture({ ...lost, checkpoint: { ...lost.checkpoint, audio: start.checkpoint.audio } }), /corrupt_record/);
  await assert.rejects(verifyPreparedCapture({ ...lost, mutation: { kind: 'checkpoint',
    action: { kind: 'provenance_loss', reason: 'unrecognized' } } } as typeof lost), /corrupt_record/);
});

test('old v1 presentation, interruption and answer bytes and verifier behavior stay unchanged', async () => {
  const event = episode(0, { presentationOnly: true })[0];
  event.eventId = uuid(701); event.episodeId = uuid(702);
  event.sourceSlotKey = makeSourceSlotKey(localContext().ownerId, event);
  const start = await preparePresentation({ transitionId: uuid(703), event, actualVisible: true,
    history: 'new_session', timingObserved: true }, localContext(), catalogue);
  const interrupted = prepareCheckpointTransition(start.checkpoint, { kind: 'interruption' }, localContext(), uuid(704));
  assert.equal(interrupted.checkpoint.hintUsed, false);
  assert.equal(interrupted.checkpoint.answerPreviouslyRevealed, false);
  assert.deepEqual(interrupted.checkpoint.textVisibility, start.checkpoint.textVisibility);
  const submitted = await prepareAnswer(interrupted.checkpoint, { transitionId: uuid(705), eventId: uuid(706),
    occurredAt: at(0, 1000), recordTimezone: 'Asia/Seoul', correct: true, responseMs: 500,
    handoff: { draftToken: 'v1-golden', answer: '合成入力だけ', observation: { responseMs: 123.5, neededHelp: false, modality: 'meaning' } } }, localContext(), catalogue);
  // These complete PreparedCapture digests were verified against the unmodified
  // pre-B1 capture implementation, including the old interruption reducer.
  const expected = ['fb412ea0f41f117044af1179b066b99f05a941824f4064019b3c0239b1544df9',
    'd16cd1f87a10b592f575dee058ead35542b15756447f4317a9c393746a30ab80',
    '9457251b783bf6237a1bacdfe3370ae5a528b6ddf4faf1eafc2571fcf0b26d90'];
  for (const [index, value] of [start, interrupted, submitted].entries()) {
    assert.equal(createHash('sha256').update(canonicalEvidence(value)).digest('hex'), expected[index]);
    await verifyPreparedCapture(value);
    await verifyPreparedCapture(JSON.parse(canonicalEvidence(value)));
  }
});
