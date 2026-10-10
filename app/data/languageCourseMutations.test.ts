import assert from 'node:assert/strict';
import test from 'node:test';
import { CURRICULUM } from '../../data/curriculum.ts';
import { createLearningSession, answerSessionQuestion, getSessionQuizIndices, normalizeLearningSession } from '../../utils/learningSession.ts';
import { CURRICULUM_PROGRESS_KEY as P, CURRICULUM_REVIEW_KEY as R } from '../../utils/curriculumProgress.ts';
import { commitLanguageSyncResponse, readLanguageRecordSnapshot, updateLanguageRecords, createLanguageSyncLifecycle, readLanguageSyncRequest } from './languageCloudSync.ts';
import { languageFixture } from '../../tests/helpers/languageFixture.ts';
import { languageDocument } from './languageRecordDocuments.ts';
import { getLanguageMutationOutcome, reconcileLanguageMutation } from './languageRecordMutations.ts';
import { createCourseMutation, createExplicitCourseSave, runCourseMutation, verifyCourseFinishReceipt, LANGUAGE_FINISH_RECEIPTS, type CoursePayload } from './languageCourseMutations.ts';
const lesson = CURRICULUM[0];
const fixed = { timestamp: '2026-10-09T23:00:00.000Z', date: '2026-10-09' };
async function fixture(seed: Record<string, string> = {}) {
  const f = languageFixture(); const request = await f.request();
  const { context } = await commitLanguageSyncResponse(request.request, seed);
  return { ...f, context, lifecycle: request.lifecycle, lease: request.lease,
    source: () => readLanguageRecordSnapshot(context),
    intent(payload: CoursePayload, operationId?: string) { return createCourseMutation(context, readLanguageRecordSnapshot(context), payload, { ...fixed, operationId }); },
    read() { return JSON.parse(f.storage.getItem(P) ?? '{}'); },
  };
}
function session(id = 'session-a', lessonId = lesson.id) { return { ...createLearningSession(lessonId, 5, 'starter'), id }; }
function completed(id = 'session-a') {
  let value = session(id);
  for (const index of getSessionQuizIndices(lesson, 5)) value = answerSessionQuestion(value, index, true, lesson.quiz[index].choices[lesson.quiz[index].answer], { responseMs: 2000, neededHelp: false, modality: 'meaning' });
  return value;
}
const progress = (draft = session()) => JSON.stringify({ lessonDrafts: { [lesson.id]: draft }, activeSession: draft });

test('course narrow track and group writes retain unknown raw tokens and never add daily keys', async t => {
  const raw = ' { "future":900719925474099312345,"future":1,"escape":"\\u3042","selectedTrack":"foundation","quizScores":{"x":42} } ';
  const f = await fixture({ [P]: raw }); t.after(f.restore);
  await runCourseMutation(f.intent({ kind: 'track', track: 'travel' }));
  await runCourseMutation(f.intent({ kind: 'kana', groupId: 'a' }));
  const text = f.storage.getItem(P)!;
  assert.match(text, /"future":900719925474099312345,"future":1/); assert.match(text, /"escape":"\\u3042"/);
  assert.deepEqual(f.read().quizScores, { x: 42 });
  assert.equal(f.storage.getItem('dailyRoutineProgress'), null); assert.equal(f.storage.getItem('dailyLearningHistory'), null);
});
for (const raw of ['null', '[]', '{bad', '{"selectedTrack":"foundation","selectedTrack":"work"}']) test(`course rejects unsupported/touched duplicate source ${raw}`, async t => {
  const f = await fixture({ [P]: raw }); t.after(f.restore);
  await assert.rejects(runCourseMutation(f.intent({ kind: 'track', track: 'work' })));
  assert.equal(f.storage.getItem(P), raw);
});
test('unchanged track and already completed group preserve raw bytes and timestamp', async t => {
  const raw = ' { "selectedTrack":"work", "kanaCompletedGroups":["a",9007199254740993123],"updatedAt":"before" } ';
  const f = await fixture({ [P]: raw }); t.after(f.restore);
  await runCourseMutation(f.intent({ kind: 'track', track: 'work' })); await runCourseMutation(f.intent({ kind: 'kana', groupId: 'a' }));
  assert.equal(f.storage.getItem(P), raw);
});
test('same lesson exact source conflicts while different lessons merge and pointer remains newest', async t => {
  const f = await fixture({ [P]: progress() }); t.after(f.restore);
  const source = f.source();
  const stale = createCourseMutation(f.context, source, { kind: 'draft', lesson, session: { ...session(), stage: 3 } }, fixed);
  await runCourseMutation(createCourseMutation(f.context, source, { kind: 'draft', lesson, session: { ...session(), stage: 2 } }, fixed));
  await assert.rejects(runCourseMutation(stale)); assert.equal(f.read().lessonDrafts[lesson.id].stage, 2);
  const source2 = f.source();
  const other = CURRICULUM[1], otherSession = session('other', other.id);
  await runCourseMutation(createCourseMutation(f.context, source2, { kind: 'draft', lesson: other, session: otherSession }, fixed));
  await runCourseMutation(createCourseMutation(f.context, source2, { kind: 'draft', lesson, session: { ...session(), stage: 4 } }, fixed));
  assert.equal(f.read().activeSession.id, 'other'); assert.equal(f.read().lessonDrafts[other.id].id, 'other');
});
test('legacy raw draft migration and untouched normalized omissions preserve unknown tokens', async t => {
  const long = 'a'.repeat(510);
  const draft = JSON.stringify({ ...session(), responses: { 1: long }, observations: { 2: { neededHelp: false, modality: 'meaning', future: 'PLACEHOLDER' } } }).replace('"PLACEHOLDER"', '900719925474099312345');
  const f = await fixture({ [P]: '{"activeSession":' + draft + '}' }); t.after(f.restore);
  const clean = normalizeLearningSession(JSON.parse(draft), lesson)!;
  await runCourseMutation(f.intent({ kind: 'draft', lesson, session: { ...clean, stage: 1 } }));
  const doc = languageDocument(f.storage.getItem(P), 'object');
  assert.equal(doc.get(['lessonDrafts', lesson.id, 'responses', '1']), long);
  assert.equal(doc.rawAt(['lessonDrafts', lesson.id, 'observations', '2', 'future']), '900719925474099312345');
  assert.equal(doc.rawAt(['activeSession', 'observations', '2', 'future']), '900719925474099312345');
});
test('new session initialization migrates old active pointer then finish restores remaining draft', async t => {
  const old = session('old', CURRICULUM[1].id);
  const f = await fixture({ [P]: JSON.stringify({ activeSession: old }) }); t.after(f.restore);
  await runCourseMutation(f.intent({ kind: 'draft', lesson, session: session() }));
  assert.equal(f.read().activeSession.id, 'session-a'); assert.equal(f.read().lessonDrafts[old.lessonId].id, 'old');
  await runCourseMutation(f.intent({ kind: 'finish', lesson, session: completed() }));
  assert.equal(f.read().activeSession.id, 'old'); assert.equal(f.read().lessonDrafts[lesson.id], undefined);
});
test('finish atomically saves score/reviews and exact retained receipt; retries do not schedule twice', async t => {
  const opaque = '{"future":900719925474099312345,"future":2}';
  const f = await fixture({ [P]: progress(), [R]: '[false,' + opaque + ']' }); t.after(f.restore);
  const intent = f.intent({ kind: 'finish', lesson, session: completed() }, 'finish-once');
  const result = await runCourseMutation(intent); assert.equal(result.acknowledged, true);
  const before = f.storage.getItem(P), reviews = f.storage.getItem(R);
  assert.equal(f.read().quizScores[lesson.id], 100); assert.match(reviews!, /"future":900719925474099312345,"future":2/);
  assert.equal(f.read()[LANGUAGE_FINISH_RECEIPTS].operations['finish-once'].result.sessionId, 'session-a');
  const repeated = createCourseMutation(f.context, intent.source, intent.payload, { ...fixed, operationId: 'finish-once' });
  assert.equal((await runCourseMutation(repeated)).status, 'already-applied');
  assert.equal(f.storage.getItem(P), before); assert.equal(f.storage.getItem(R), reviews);
  assert.equal(f.storage.getItem('reviewCompletedItemsByDate'), null); assert.equal(f.storage.getItem('dailyRoutineProgress'), null);
  await assert.rejects(runCourseMutation(createCourseMutation(f.context, intent.source, { ...intent.payload, kind: 'finish', lesson, session: { ...completed(), stage: 1 } }, { ...fixed, operationId: 'finish-once' })));
});
test('finish receipt survives more than twenty attempts and prevents old completion replay', async t => {
  const f = await fixture(); t.after(f.restore); let first;
  for (let index = 0; index < 23; index++) {
    await runCourseMutation(f.intent({ kind: 'draft', lesson, session: session('session-' + index) }));
    const intent = f.intent({ kind: 'finish', lesson, session: completed('session-' + index) }, 'finish-' + index);
    if (!first) first = intent;
    await runCourseMutation(intent);
  }
  assert.equal(f.read().lessonAttempts[lesson.id].length, 20); assert.equal(Object.keys(f.read()[LANGUAGE_FINISH_RECEIPTS].operations).length, 23);
  assert.equal(verifyCourseFinishReceipt(f.source().records, first!).kind, 'finish');
  const before = f.storage.getItem(R); await runCourseMutation(createCourseMutation(f.context, first!.source, first!.payload, { ...fixed, operationId: first!.operationId }));
  assert.equal(f.storage.getItem(R), before);
});
for (const key of [P, R, 'prepared-journal', 'committed-protocol']) test(`finish rolls back progress, reviews and receipt after ${key} failure`, async t => {
  const f = await fixture({ [P]: progress(), [R]: ' [ {"id":"unrelated","future":9007199254740993123} ] ' }); t.after(f.restore);
  const beforeP = f.storage.getItem(P), beforeR = f.storage.getItem(R); const set = f.storage.setItem; let failed = false;
  // Generation key is resolved from the shipped protocol below.
  const transactions = await import('./storageTransaction.ts'); const target = key === 'prepared-journal' ? transactions.STORAGE_PROTOCOL_KEY : key === 'committed-protocol' ? transactions.STORAGE_PROTOCOL_KEY : key;
  f.storage.setItem = (name, value) => { if (name === target && !failed && (key !== 'committed-protocol' || JSON.parse(value).state === 'committed') && (key !== 'prepared-journal' || JSON.parse(value).state === 'prepared')) { failed = true; throw new Error('synthetic quota failure'); } set(name, value); };
  const intent = f.intent({ kind: 'finish', lesson, session: completed() });
  await assert.rejects(runCourseMutation(intent), /synthetic quota failure/);
  assert.equal(f.storage.getItem(P), beforeP); assert.equal(f.storage.getItem(R), beforeR);
  f.storage.setItem = set;
  assert.equal((await runCourseMutation(intent)).acknowledged, true);
});
test('newer same-session draft prevents stale finish and preserves all records', async t => {
  const f = await fixture({ [P]: progress() }); t.after(f.restore);
  const intent = f.intent({ kind: 'finish', lesson, session: completed() });
  await runCourseMutation(f.intent({ kind: 'draft', lesson, session: { ...session(), stage: 2 } }));
  const before = f.storage.getItem(P); await assert.rejects(runCourseMutation(intent));
  assert.equal(f.storage.getItem(P), before); assert.equal(f.storage.getItem(R), null);
});
for (const review of ['[{"id":"f01:2","id":"f01:2"}]', '[{"id":"f01:2"},{"id":"f01:2"}]', '[{"id":"f01:2","wrongCount":"bad"}]']) test('invalid or duplicate touched review blocks the entire finish: ' + review, async t => {
  const f = await fixture({ [P]: progress(), [R]: review }); t.after(f.restore);
  await assert.rejects(runCourseMutation(f.intent({ kind: 'finish', lesson, session: completed() })));
  assert.equal(f.storage.getItem(P), progress()); assert.equal(f.storage.getItem(R), review);
});
test('retired completion intent is read-only reconciled by exact receipt after same-origin resume', async t => {
  const f = await fixture({ [P]: progress() }); t.after(f.restore);
  const intent = f.intent({ kind: 'finish', lesson, session: completed() }); await runCourseMutation(intent);
  f.lifecycle.revoke(); const life = createLanguageSyncLifecycle();
  const request = readLanguageSyncRequest(f.lease, life, f.storage); const { context } = await commitLanguageSyncResponse(request, request.local);
  const before = f.storage.getItem(P);
  const result = reconcileLanguageMutation(intent, context, verifyCourseFinishReceipt);
  assert.equal(result.acknowledged, true); assert.equal(f.storage.getItem(P), before);
});
test('changed owner/reset source can never rebind an old draft', async t => {
  const f = await fixture({ [P]: progress() }); t.after(f.restore);
  const source = f.source(); await f.owner('b'); await f.owner('a');
  assert.throws(() => createCourseMutation(f.context, source, { kind: 'draft', lesson, session: session() }));
  await assert.rejects(f.request());
});
test('unrelated raw tokens survive exact per-lesson save while a malformed known map blocks', async t => {
  const raw = progress().replace('"answers":{}', '"answers":{},"future":900719925474099312345');
  const f = await fixture({ [P]: raw }); t.after(f.restore);
  await runCourseMutation(f.intent({ kind: 'draft', lesson, session: { ...session(), stage: 1 } }));
  assert.match(f.storage.getItem(P)!, /"future":900719925474099312345/);
  await updateLanguageRecords(f.context, () => ({ [P]: '{"lessonDrafts":{"f01":null}}' }));
  await assert.rejects(runCourseMutation(f.intent({ kind: 'draft', lesson, session: session() })));
});

test('finish review scheduler explicitly deletes obsolete known response time while preserving unknown fields', async t => {
  const final = completed(); const index = getSessionQuizIndices(lesson, 5)[0]; delete final.observations![index].responseMs;
  const raw = '[{"id":"' + lesson.id + ':' + index + '","lastResponseMs":2000,"future":900719925474099312345}]';
  const f = await fixture({ [P]: progress(), [R]: raw }); t.after(f.restore);
  await runCourseMutation(f.intent({ kind: 'finish', lesson, session: final }));
  const doc = languageDocument(f.storage.getItem(R), 'array'); assert.equal(doc.has([0, 'lastResponseMs']), false); assert.equal(doc.rawAt([0, 'future']), '900719925474099312345');
});
for (const receipt of ['null', '{"version":2,"operations":{}}', '{"version":1,"version":1,"operations":{}}', '{"version":1,"operations":{"old":{"payload":null,"result":{}}}}']) test('unsupported finish receipt is preserved and blocks finish: ' + receipt, async t => {
  const raw = progress().slice(0, -1) + ',"languageFinishReceiptsV1":' + receipt + '}';
  const f = await fixture({ [P]: raw }); t.after(f.restore);
  await assert.rejects(runCourseMutation(f.intent({ kind: 'finish', lesson, session: completed() })));
  assert.equal(f.storage.getItem(P), raw); assert.equal(f.storage.getItem(R), null);
});


test('explicit new save keeps retired envelope immutable and rejects changed source or committed outcome', async t => {
  const f = await fixture({ [P]: progress() }); t.after(f.restore);
  const original = f.intent({ kind: 'draft', lesson, session: { ...session(), wordIndex: 1 } });
  f.lifecycle.revoke(); const lifecycle = createLanguageSyncLifecycle();
  const request = readLanguageSyncRequest(f.lease, lifecycle, f.storage); const { context } = await commitLanguageSyncResponse(request, request.local);
  const recovery = createExplicitCourseSave(context, original.source, { kind: 'draft', lesson, session: { ...session(), wordIndex: 2 } }, original);
  assert.notEqual(recovery.operationId, original.operationId); assert.equal(original.context, f.context); assert.equal(original.payload.kind === 'draft' && original.payload.session.wordIndex, 1);
  await runCourseMutation(recovery);
  assert.equal(f.read().activeSession.wordIndex, 2);
  assert.throws(() => createExplicitCourseSave(context, recovery.source, recovery.payload, recovery));
  assert.throws(() => createExplicitCourseSave(context, original.source, original.payload, original));
});

test('ambiguous committed-marker write-then-throw cannot become a new save but exact receipt can reconcile', async t => {
  const f = await fixture({ [P]: progress() }); t.after(f.restore);
  const transactions = await import('./storageTransaction.ts'); const set = f.storage.setItem; let armed = true;
  f.storage.setItem = (key, value) => { set(key, value); if (armed && key === transactions.STORAGE_PROTOCOL_KEY && JSON.parse(value).state === 'committed') { armed = false; throw new Error('ambiguous committed marker'); } };
  const intent = f.intent({ kind: 'finish', lesson, session: completed() }); await assert.rejects(runCourseMutation(intent), /ambiguous committed marker/);
  assert.equal(getLanguageMutationOutcome(intent), 'unknown');
  assert.throws(() => createExplicitCourseSave(f.context, intent.source, intent.payload, intent));
  const before = f.storage.getItem(R); assert.equal(reconcileLanguageMutation(intent, f.context, verifyCourseFinishReceipt).acknowledged, true); assert.equal(f.storage.getItem(R), before);
});


test('finish skips unsupported unrelated resume candidates and preserves their exact raw tokens', async t => {
  const missingId = { ...session('missing', CURRICULUM[1].id), id: undefined };
  const badMap = { ...session('unsupported', CURRICULUM[2].id), answers: [] };
  const raw = JSON.stringify({ activeSession: session(), lessonDrafts: { [lesson.id]: session(), [CURRICULUM[1].id]: missingId, [CURRICULUM[2].id]: badMap } }).replace('"answers":[]', '"answers":[],"future":900719925474099312345');
  const f = await fixture({ [P]: raw }); t.after(f.restore); const before = languageDocument(raw, 'object');
  await runCourseMutation(f.intent({ kind: 'finish', lesson, session: completed() }));
  const after = languageDocument(f.storage.getItem(P), 'object');
  assert.equal(after.has(['activeSession']), false);
  for (const id of [CURRICULUM[1].id, CURRICULUM[2].id]) assert.equal(after.rawAt(['lessonDrafts', id]), before.rawAt(['lessonDrafts', id]));
});

for (const tamper of ['score', 'incomplete', 'malformed'] as const) test('finish refuses a retained receipt with inconsistent deterministic proof: ' + tamper, async t => {
  const f = await fixture({ [P]: progress() }); t.after(f.restore);
  const intent = f.intent({ kind: 'finish', lesson, session: completed() }); await runCourseMutation(intent);
  const raw = f.storage.getItem(P)!; const doc = languageDocument(raw, 'object'), path = [LANGUAGE_FINISH_RECEIPTS, 'operations', intent.operationId];
  if (tamper === 'score') doc.set([...path, 'result', 'score'], 99);
  else {
    const proof = JSON.parse(doc.get<string>([...path, 'payload'])!);
    if (tamper === 'incomplete') delete proof.action.session.answers[getSessionQuizIndices(lesson, 5)[0]];
    else proof.action.session.answers = [];
    const canonical = (value: unknown): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}' : JSON.stringify(value);
    doc.set([...path, 'payload'], canonical(proof));
  }
  await updateLanguageRecords(f.context, () => ({ [P]: doc.text() }));
  assert.throws(() => verifyCourseFinishReceipt(f.source().records, intent));
  const repeated = createCourseMutation(f.context, intent.source, intent.payload, { ...fixed, operationId: intent.operationId });
  await assert.rejects(runCourseMutation(repeated)); assert.equal(f.storage.getItem(P), doc.text());
});
