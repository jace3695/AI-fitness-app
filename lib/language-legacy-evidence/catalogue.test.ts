import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CURRICULUM } from '../../data/curriculum.ts';
import { answerSessionQuestion, createLearningSession, getQuestionChoices, getSessionQuizIndices, getSessionResult, isTypedAnswerCorrect, retrySessionQuestion, updateSessionReviews } from '../../utils/learningSession.ts';
import { reviewModality } from '../../utils/learningReview.ts';
import { buildEvidenceCatalogue, LEGACY_EVIDENCE_CATALOGUE } from './catalogue.ts';
import { projectLegacyEvidence } from './projection.ts';
import { catalogue, context, episode, meaningTask, snapshot } from './test-fixtures.ts';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Captured from unmodified ed4c7d058c6374a198184906d14664c35cbbec20, before adding metadata.
test('all 62 lessons / 496 questions preserve every old content field, ID, order and count', () => {
  const stripped = CURRICULUM.map(lesson => ({ ...lesson, quiz: lesson.quiz.map(quiz => {
    const copy = { ...quiz }; delete copy.evidenceRef; return copy;
  }) }));
  assert.equal(CURRICULUM.length, 62); assert.equal(CURRICULUM.flatMap(lesson => lesson.quiz).length, 496);
  assert.equal(hash(stripped), '5f14c077777c5e68fc9817f0bce097f85982385af29dbe689477c92157e9cf58');
});

test('all 5/10/20-minute selections, starter/reader choices and legacy typing grades are unchanged', () => {
  const behavior = CURRICULUM.map(lesson => ({ id: lesson.id,
    minutes: ([5, 10, 20] as const).map(minutes => getSessionQuizIndices(lesson, minutes)),
    choices: lesson.quiz.map((_, index) => (['starter', 'reader'] as const).map(mode => getQuestionChoices(lesson, index, mode))),
    grades: lesson.quiz.map((quiz, index) => [quiz.choices[quiz.answer], ...lesson.words.map(word => word.reading), 'NO-ANSWER'].map(answer => isTypedAnswerCorrect(lesson, index, answer))),
  }));
  assert.equal(hash(behavior), '8ee0b2f6007606ca2474eba29fda5873aebaddf56c4de9e52175365363f4b70d');
  assert.equal(reviewModality('input', 'starter'), 'meaning'); assert.equal(reviewModality('input', 'reader'), 'typing');
});

test('authored meaning/input references share only the same word; pattern/core/example identities stay distinct', () => {
  assert.equal(LEGACY_EVIDENCE_CATALOGUE.length, 496);
  for (const lesson of CURRICULUM) {
    for (let index = 2; index < 8; index += 2) {
      const meaning = lesson.quiz[index].evidenceRef!, input = lesson.quiz[index + 1].evidenceRef!;
      assert.equal(meaning.itemId, input.itemId); assert.notEqual(meaning.taskId, input.taskId);
    }
    assert.notEqual(lesson.quiz[0].evidenceRef!.itemId, lesson.quiz[2].evidenceRef!.itemId);
    if (lesson.quiz[0].kind === 'listening') assert.equal(lesson.quiz[1].evidenceRef!.itemId, lesson.quiz[2].evidenceRef!.itemId);
  }
  const ids = LEGACY_EVIDENCE_CATALOGUE.map(task => task.legacyQuestionId);
  assert.equal(new Set(ids).size, 496);
});

test('identical text and homophones never merge explicit senses, lessons, tasks or revisions', () => {
  const base = structuredClone(CURRICULUM[0]);
  base.quiz = [
    { ...base.quiz[2], choices: ['はし'], evidenceRef: { itemId: 'authored:bridge', taskId: 'authored:bridge:meaning', contentRevision: 1 } },
    { ...base.quiz[2], choices: ['はし'], evidenceRef: { itemId: 'authored:chopsticks', taskId: 'authored:chopsticks:meaning', contentRevision: 1 } },
    { ...base.quiz[2], evidenceRef: { itemId: 'authored:bridge', taskId: 'authored:bridge:meaning', contentRevision: 2 } },
  ];
  const tasks = buildEvidenceCatalogue([base]);
  assert.equal(tasks.length, 3); assert.notEqual(tasks[0].itemId, tasks[1].itemId); assert.notEqual(tasks[0].contentRevision, tasks[2].contentRevision);
  const changed = structuredClone(base); changed.quiz[1].evidenceRef = changed.quiz[0].evidenceRef;
  assert.throws(() => buildEvidenceCatalogue([changed]), /collision/);
  const missing = structuredClone(base); delete missing.quiz[0].evidenceRef;
  assert.throws(() => buildEvidenceCatalogue([missing]), /Missing authored/);
  assert.throws(() => buildEvidenceCatalogue([base, base]), /collision/);
});

test('retired revision evidence is not mapped onto the current item revision', () => {
  const futureCatalogue = catalogue.map(task => ({ ...task, contentRevision: 2 }));
  const result = projectLegacyEvidence(snapshot(episode(0)), context(), futureCatalogue);
  assert.equal(result.status, 'partial'); assert.ok(result.pairs.every(pair => pair.stage === null && pair.responses === 0));
});

test('legacy score/first-answer/retry/help/repeated-save and original review IDs are preserved', () => {
  const lesson = CURRICULUM[0];
  let session = { ...createLearningSession(lesson.id, 5, 'starter'), id: 'unchanged-session' };
  session = answerSessionQuestion(session, 2, false, 'wrong', { neededHelp: true, responseMs: 4567, modality: 'meaning' });
  session = retrySessionQuestion(session, 2);
  assert.equal(session.firstAnswers[2], false); assert.equal(session.answers[2], undefined);
  session = answerSessionQuestion(session, 2, true, 'correct', { neededHelp: false, responseMs: 10, modality: 'meaning' });
  session = answerSessionQuestion(session, 4, true, 'correct');
  session = answerSessionQuestion(session, 6, true, 'correct');
  assert.deepEqual(getSessionResult(lesson, session), { total: 3, answered: 3, correct: 3, firstCorrect: 2, score: 67, complete: true, needsPractice: false });
  assert.equal(session.observations?.[2].responseMs, 4567); assert.equal(session.observations?.[2].neededHelp, true);
  const now = new Date('2026-01-01T00:00:00.000Z');
  const reviews = updateSessionReviews([], lesson, session, now);
  assert.equal(reviews.length, 1); assert.equal(reviews[0].id, 'f01:2'); assert.equal(reviews[0].wrongCount, 1);
  assert.equal(reviews[0].intervalDays, 1); assert.equal(reviews[0].lastNeededHelp, true); assert.equal(reviews[0].lastResponseMs, 4567);
  assert.deepEqual(updateSessionReviews(reviews, lesson, session, new Date('2026-01-02T00:00:00.000Z')), reviews);
  // Reading the new projection has no side effects on an old result or review object.
  const before = structuredClone({ session, reviews }); projectLegacyEvidence(snapshot(episode(0)), context(), catalogue);
  assert.deepEqual({ session, reviews }, before);
});

test('legacy all-correct unobserved draft keeps old completion and does not fabricate a review or evidence', () => {
  const lesson = CURRICULUM[0];
  let session = createLearningSession(lesson.id, 5, 'reader');
  for (const index of getSessionQuizIndices(lesson, 5)) session = answerSessionQuestion(session, index, true, 'correct');
  assert.equal(getSessionResult(lesson, session).complete, true); assert.equal(getSessionResult(lesson, session).score, 100);
  assert.deepEqual(updateSessionReviews([], lesson, session, new Date()), []);
  const result = projectLegacyEvidence(snapshot([]), context(), catalogue);
  assert.equal(result.pairs.find(pair => pair.itemId === meaningTask.itemId && pair.modality === 'meaning')?.coverage, 'unobserved');
  assert.equal(result.historicalModalities, 'unknown');
});
