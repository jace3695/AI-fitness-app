import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLegacyEvidence } from './projection.ts';
import { studyDay } from './study-policy.ts';
import { makeSourceSlotKey } from './validation.ts';
import { at, catalogue, context, episode, id, listeningTask, meaningTask, snapshot, typedTask, uuid } from './test-fixtures.ts';
import type { EvidenceEvent, EvidenceSnapshot } from './types.ts';
const project = (events: EvidenceEvent[], now = 0) => projectLegacyEvidence(snapshot(events), context(now), catalogue);
const meaning = (events: EvidenceEvent[], now = 0) => project(events, now).pairs.find(pair => pair.itemId === meaningTask.itemId && pair.modality === 'meaning')!;
const history = (days: number[]) => days.flatMap(day => episode(day));

test('all six stages are record-derived with exact elapsed-day boundaries and due precedence', () => {
  assert.equal(meaning([]).stage, 'not_started');
  assert.equal(meaning(episode(0, { presentationOnly: true })).stage, 'learning');
  assert.equal(meaning(episode(0)).stage, 'completed_once');
  assert.equal(meaning(episode(0, { answers: [{ correct: false }] })).stage, 'needs_review');
  assert.equal(meaning(history([0, 1, 7]), 7).stage, 'almost_learned');
  assert.notEqual(meaning(history([0, 1, 7 - 1 / 86400]), 7).stage, 'almost_learned');
  assert.equal(meaning(history([0, 1, 4, 11, 30]), 30).stage, 'long_term_record');
  assert.notEqual(meaning(history([0, 1, 4, 11, 30 - 1 / 86400]), 30).stage, 'long_term_record');
  assert.notEqual(meaning(history([0, 1, 4, 17, 30]), 30).stage, 'long_term_record');
  assert.equal(meaning(history([0, 1, 4, 16, 30]), 30).stage, 'long_term_record');
  const overdue = meaning(history([0, 1, 4, 11, 30]), 60);
  assert.equal(overdue.stage, 'needs_review'); assert.equal(overdue.historicalHighestStage, 'long_term_record'); assert.equal(overdue.historicalEvidenceIds.length, 5);
});

test('one hundred same-day answers preserve counts but cannot advance stage, interval or due date', () => {
  const events = Array.from({ length: 100 }, (_, index) => episode(0, { millisecond: index * 2_000 })).flat();
  const result = meaning(events, 0.5);
  assert.equal(result.responses, 100); assert.equal(result.qualifiedDates.length, 1);
  assert.equal(result.stage, 'completed_once'); assert.equal(result.suggestedIntervalDays, 1); assert.equal(result.suggestedDueAt, at(1, 1000));
});

test('a century-long gap is one observed episode and advances schedule only one interval', () => {
  const result = meaning(history([0, 36500]), 36500);
  assert.equal(result.stage, 'completed_once'); assert.equal(result.suggestedIntervalDays, 3); assert.equal(result.qualifiedDates.length, 2);
});

test('early repetitions on different days do not postpone due date or advance suggested interval', () => {
  const result = meaning(history([0, 1, 2, 3]), 3);
  assert.equal(result.suggestedIntervalDays, 3); assert.equal(result.suggestedDueAt, at(4, 1000));
});

test('wrong then retry-correct preserves both outcomes and never turns into first-response success', () => {
  const events = episode(0, { answers: [{ correct: false }, { correct: true, answerPreviouslyRevealed: true }] });
  const result = meaning(events);
  assert.equal(result.responses, 2); assert.equal(result.wrongResponses, 1); assert.equal(result.correctResponses, 1);
  assert.equal(result.retryResponses, 1); assert.equal(result.helpedResponses, 1); assert.equal(result.lastOutcome?.correct, true);
  assert.equal(result.stage, 'needs_review'); assert.equal(result.qualifiedDates.length, 0);
});

test('later failure or help breaks run but retains historical successes and highest stage', () => {
  for (const answers of [[{ correct: false }], [{ hintUsed: true }], [{ answerPreviouslyRevealed: true }]]) {
    const events = [...history([0, 1, 7]), ...episode(8, { answers })];
    const result = meaning(events, 8);
    assert.equal(result.stage, 'needs_review'); assert.equal(result.historicalHighestStage, 'almost_learned'); assert.equal(result.qualifiedDates.length, 3);
    assert.equal(meaning([...events, ...episode(9)], 9).stage, 'completed_once');
  }
});

test('skip/postpone/presentation is not an answer and playback alone is not a response', () => {
  const result = project(episode(0, { task: listeningTask, format: 'listening_choice', presentationOnly: true }));
  const pair = result.pairs.find(pair => pair.itemId === listeningTask.itemId && pair.modality === 'listening')!;
  assert.equal(pair.stage, 'learning'); assert.equal(pair.responses, 0); assert.equal(pair.qualifiedDates.length, 0);
  const invalid = snapshot(episode(0)); (invalid.records[1].event as unknown as { kind: string }).kind = 'postponed';
  assert.equal(projectLegacyEvidence(invalid, context(), catalogue).status, 'unavailable');
});

test('missing timing/help/text provenance remains partial; slow correctness is never wrong', () => {
  for (const patch of [
    { responseMs: null, timingComplete: false }, { hintUsed: null }, { answerPreviouslyRevealed: null },
    { textVisibility: { targetText: null, reading: false, meaning: true, choices: true } },
  ]) {
    const result = meaning(episode(0, { answers: [patch] }));
    assert.equal(result.coverage, 'partial'); assert.equal(result.stage, null); assert.equal(result.correctResponses, 1); assert.equal(result.wrongResponses, 0);
  }
  assert.equal(meaning(episode(0, { answers: [{ responseMs: 600_000, occurredAt: at(0, 600_000) }] }), 0.5).stage, 'completed_once');
});

test('listening credit requires matching playback and explicit visibility without any hearing claim', () => {
  for (const status of ['not_requested', 'started', 'aborted', 'failed', 'unknown'] as const) {
    const audio = status === 'not_requested' ? { status, promptMatchesTask: null } : { status, requestId: id(), promptMatchesTask: null };
    const pair = project(episode(0, { task: listeningTask, format: 'listening_choice', answers: [{ audio }] })).pairs.find(pair => pair.itemId === listeningTask.itemId && pair.modality === 'listening')!;
    assert.equal(pair.stage, null); assert.equal(pair.responses, 1); assert.equal(pair.coverage, 'partial');
  }
  const pair = project(episode(0, { task: listeningTask, format: 'listening_choice' })).pairs.find(pair => pair.itemId === listeningTask.itemId && pair.modality === 'listening')!;
  assert.equal(pair.stage, 'completed_once'); assert.equal(pair.lastOutcome?.textVisibility.choices, true);
  const mismatch = project(episode(0, { task: listeningTask, format: 'listening_choice', answers: [{ audio: { status: 'completed', requestId: id(), promptMatchesTask: false } }] }));
  assert.equal(mismatch.status, 'partial');
});

test('same authored item meaning and direct input stay independent; revealed typed answer is helped', () => {
  const events = [...episode(0), ...episode(0, { task: typedTask, format: 'typed_answer', answers: [{ correct: false }] })];
  const result = project(events);
  assert.equal(result.pairs.find(pair => pair.itemId === meaningTask.itemId && pair.modality === 'meaning')?.stage, 'completed_once');
  assert.equal(result.pairs.find(pair => pair.itemId === meaningTask.itemId && pair.modality === 'typing')?.stage, 'needs_review');
  assert.equal(result.pairs.find(pair => pair.itemId === meaningTask.itemId && pair.modality === 'listening')?.stage, 'not_started');
  const exposed = project(episode(0, { task: typedTask, format: 'typed_answer', answers: [{ textVisibility: { targetText: true, reading: false, meaning: true, choices: false } }] }));
  assert.equal(exposed.pairs.find(pair => pair.itemId === typedTask.itemId && pair.modality === 'typing')?.stage, 'needs_review');
  assert.equal(result.speaking, 'unobserved'); assert.equal(result.historicalModalities, 'unknown');
});

test('input ordering and exact duplicate delivery do not change projection', () => {
  const input = snapshot(history([0, 1, 7]));
  const expected = projectLegacyEvidence(input, context(7), catalogue);
  const shuffled = { ...input, records: [...input.records].reverse() };
  assert.deepEqual(projectLegacyEvidence(shuffled, context(7), catalogue), expected);
  assert.deepEqual(projectLegacyEvidence({ ...input, records: [...input.records, input.records[3]] }, context(7), catalogue), expected);
});

test('late committed old wrong answer is included by server sequence and recomputes the run', () => {
  const input = snapshot([...history([0, 7, 30]), ...episode(10, { answers: [{ correct: false }] })]);
  input.records.at(-1)!.receivedAt = at(30, 2000); input.records.at(-2)!.receivedAt = at(30, 2000);
  const result = projectLegacyEvidence(input, context(30), catalogue).pairs.find(pair => pair.itemId === meaningTask.itemId && pair.modality === 'meaning')!;
  assert.equal(result.wrongResponses, 1); assert.equal(result.stage, 'completed_once'); assert.equal(result.historicalHighestStage, 'completed_once');
});

test('partial prefix, conflicting IDs and missing episode sequences cannot promote any stage', () => {
  const input = snapshot(history([0, 1, 7]));
  const versions: EvidenceSnapshot[] = [
    { ...input, completeness: { ...input.completeness, status: 'partial' } },
    { ...input, records: input.records.slice(1) },
    { ...input, records: [...input.records, { ...input.records[1], event: { ...input.records[1].event, correct: false } as EvidenceEvent }] },
  ];
  for (const value of versions) {
    const result = projectLegacyEvidence(value, context(7), catalogue);
    assert.equal(result.status, 'partial'); assert.ok(result.pairs.every(pair => pair.stage === null));
  }
  const noPresentation = snapshot([episode(0)[1]]);
  assert.equal(projectLegacyEvidence(noPresentation, context(), catalogue).pairs.find(pair => pair.itemId === meaningTask.itemId && pair.modality === 'meaning')?.stage, null);
});

test('future, backwards episode clocks, nonprospective and received-before-response are excluded from promotion', () => {
  const future = snapshot(history([0, 1, 7]));
  assert.equal(projectLegacyEvidence(future, context(1), catalogue).status, 'partial');
  const backwards = episode(0); backwards[0].occurredAt = at(0, 2000);
  assert.equal(project(backwards).pairs.find(pair => pair.itemId === meaningTask.itemId && pair.modality === 'meaning')?.stage, null);
  const received = snapshot(episode(0)); received.records[1].receivedAt = at(0);
  assert.equal(projectLegacyEvidence(received, context(), catalogue).status, 'partial');
  const invalid = snapshot(episode(0)); invalid.records[1].event.occurredAt = '2026-99-99T00:00:00.000Z';
  assert.equal(projectLegacyEvidence(invalid, context(), catalogue).status, 'unavailable');
});

test('timezone boundaries are explicit, fixed across devices and DST never substitutes for elapsed days', () => {
  assert.equal(studyDay('2026-01-01T23:30:00.000Z', '+09:00'), '2026-01-02');
  assert.equal(studyDay('2026-01-01T00:30:00.000Z', '-01:00'), '2025-12-31');
  assert.equal(studyDay('2026-03-08T06:59:59.000Z', 'America/New_York'), '2026-03-08');
  assert.equal(studyDay('2026-03-08T07:00:00.000Z', 'America/New_York'), '2026-03-08');
  const events = history([0, 1, 7]); events.forEach(event => { event.recordTimezone = 'America/New_York'; });
  assert.equal(meaning(events, 7).stage, 'almost_learned');
  const input = snapshot(events);
  assert.equal(projectLegacyEvidence(input, { ...context(7), studyDayTimezone: 'UTC' }, catalogue).status, 'unavailable');
});

test('forgotten hints, episode identity changes and stale playback IDs are data defects', () => {
  const forgotten = episode(0, { answers: [{ hintUsed: true }, { hintUsed: false }] });
  assert.equal(meaning(forgotten).stage, null);
  const listening = [...episode(0, { task: listeningTask, format: 'listening_choice' }), ...episode(1, { task: listeningTask, format: 'listening_choice' })];
  listening[2].audio.requestId = listening[0].audio.requestId; listening[3].audio.requestId = listening[0].audio.requestId;
  assert.equal(project(listening, 1).status, 'partial');
  const changedEpisode = [...episode(0), ...episode(0, { task: typedTask, format: 'typed_answer' })];
  for (const event of changedEpisode.slice(2)) {
    event.episodeId = changedEpisode[0].episodeId;
    event.sourceSlotKey = makeSourceSlotKey(context().ownerId, event);
  }
  const changed = project(changedEpisode);
  assert.equal(changed.status, 'partial');
  assert.ok(changed.warnings.some(warning => warning.code === 'episode_identity_changed'));
  assert.ok(changed.pairs.every(pair => pair.stage === null));
});

test('owner/reset mismatch never leaks even raw response counts', () => {
  for (const ctx of [{ ...context(), ownerId: uuid(9) }, { ...context(), generationId: uuid(9) }]) {
    const result = projectLegacyEvidence(snapshot(episode(0)), ctx, catalogue);
    assert.equal(result.status, 'unavailable'); assert.deepEqual(result.pairs, []);
  }
});

test('listening target/reading/translation exposure is helped; choices alone remain eligible', () => {
  for (const field of ['targetText', 'reading', 'meaning'] as const) {
    const events = episode(0, { task: listeningTask, format: 'listening_choice' });
    events[1].textVisibility[field] = true;
    const pair = project(events).pairs.find(pair => pair.itemId === listeningTask.itemId && pair.modality === 'listening')!;
    assert.equal(pair.stage, 'needs_review'); assert.equal(pair.helpedResponses, 1); assert.equal(pair.responses, 1); assert.equal(pair.qualifiedDates.length, 0);
  }
});

test('presentation exposure cannot be forgotten by hiding text before direct input/listening answer', () => {
  for (const [task, format] of [[typedTask, 'typed_answer'], [listeningTask, 'listening_choice']] as const) {
    const events = episode(0, { task, format }); events[0].textVisibility.targetText = true;
    const result = project(events);
    const pair = result.pairs.find(pair => pair.itemId === task.itemId && pair.modality === (format === 'typed_answer' ? 'typing' : 'listening'))!;
    assert.equal(pair.stage, null); assert.ok(pair.warnings.some(warning => warning.code === 'forgotten_help_provenance'));
    events[1].answerPreviouslyRevealed = true;
    const actual = project(events).pairs.find(candidate => candidate.itemId === task.itemId && candidate.modality === pair.modality)!;
    assert.equal(actual.stage, 'needs_review'); assert.equal(actual.helpedResponses, 1);
  }
});

test('a resumed wrong episode interrupts other episodes at the first wrong response, not its final retry', () => {
  const resumed = episode(5, { answers: [{ correct: false }, { correct: true, answerPreviouslyRevealed: true }] });
  resumed[2].occurredAt = at(30, 2000);
  const result = meaning([...history([0, 1, 7]), ...resumed], 30);
  assert.equal(result.stage, 'needs_review'); assert.equal(result.historicalHighestStage, 'completed_once');
});

test('retry after submitted feedback must preserve revealed-answer provenance even after reload', () => {
  for (const correct of [true, false]) {
    const events = episode(0, { answers: [{ correct }, { correct: true, answerPreviouslyRevealed: false }] });
    const result = meaning(events);
    assert.equal(result.coverage, 'partial'); assert.equal(result.stage, null); assert.equal(result.lastOutcome?.isRetry, true);
    events[2].answerPreviouslyRevealed = true;
    assert.equal(meaning(events).stage, 'needs_review');
  }
});

test('response duration cannot exceed the recorded elapsed episode and still promote', () => {
  const result = meaning(episode(0, { answers: [{ responseMs: 50_000 }] }));
  assert.equal(result.stage, null); assert.ok(result.warnings.some(warning => warning.code === 'clock_inconsistent_response_duration'));
});

test('simultaneous adverse and qualifying episodes cannot manufacture a historical high stage', () => {
  const result = meaning([...history([0, 1, 7]), ...episode(7, { answers: [{ correct: false }] })], 7);
  assert.equal(result.stage, null); assert.equal(result.historicalHighestStage, null);
  assert.ok(result.warnings.some(warning => warning.code === 'ambiguous_interruption_time'));
});

test('direct-input answer choices are an aid, including earlier presentation; listening choices remain allowed', () => {
  const exposed = episode(0, { task: typedTask, format: 'typed_answer' });
  exposed[1].textVisibility.choices = true;
  const typed = (events: EvidenceEvent[]) => project(events).pairs.find(pair => pair.itemId === typedTask.itemId && pair.modality === 'typing')!;
  assert.equal(typed(exposed).stage, 'needs_review');
  assert.equal(typed(exposed).helpedResponses, 1);
  assert.equal(typed(exposed).qualifiedDates.length, 0);
  const hidden = episode(0, { task: typedTask, format: 'typed_answer' });
  hidden[0].textVisibility.choices = true;
  assert.equal(typed(hidden).stage, null);
  assert.ok(typed(hidden).warnings.some(warning => warning.code === 'forgotten_help_provenance'));
  hidden[1].answerPreviouslyRevealed = true;
  assert.equal(typed(hidden).stage, 'needs_review');
  assert.equal(typed(hidden).helpedResponses, 1);
  const listening = project(episode(0, { task: listeningTask, format: 'listening_choice' })).pairs.find(pair => pair.itemId === listeningTask.itemId && pair.modality === 'listening')!;
  assert.equal(listening.lastOutcome?.textVisibility.choices, true);
  assert.equal(listening.stage, 'completed_once');
});
