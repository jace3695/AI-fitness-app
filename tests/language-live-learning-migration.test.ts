import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { parseLiveReport } from '../lib/language-live/report-parser.ts';
import { validateLiveLearningInput } from '../lib/language-live/learning-validation.ts';
import type { LiveLearningBatch, LiveLearningEvent, LiveLearningSnapshot, SaveLiveLearningInput } from '../lib/language-live/learning-types.ts';
import { decodeLiveLearningSnapshot } from '../app/data/languageLiveLearningRepository.ts';
import { projectLiveLearning } from '../lib/language-live/state-reducer.ts';

const db = new PGlite();
const owner = randomUUID(), other = randomUUID(), itemId = randomUUID();
const evidence = 'えを読み、間違いを確認して再学習した。';
const readMigration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const report = (date = '2026-10-09') => parseLiveReport(`[연이 AI 일본어 학습 기록 v1.1]\n학습 날짜: ${date}\n수업 주제: 합성 학습\n읽기 학습 결과: ${evidence}`);
const event = (changes: Partial<LiveLearningEvent> = {}): LiveLearningEvent => ({ eventId: randomUUID(), item: { itemId, kind: 'kana', text: 'え', meaning: '' }, skill: 'reading', kind: 'learn', result: 'not_assessed', occurredDate: '2026-10-09', certainty: 'confirmed', independent: null, hintUsed: null, forgettingConfirmed: false, evidenceText: evidence, sourceField: 'reading', reason: '합성 테스트의 확인한 근거', relearningText: '', linkedRelearningEventId: null, teacherRecommendedDue: null, teacherRecommendationConfirmed: false, ...changes });
const input = (lessonId: string, changes: Partial<SaveLiveLearningInput> = {}): SaveLiveLearningInput => ({ requestId: randomUUID(), lessonId, lessonRevision: 1, expectedVersion: 0, confirmed: true, policyVersion: 'live-review-v1', events: [event()], changeReason: '확인한 합성 평가를 저장', ...changes });
const save = async (value: SaveLiveLearningInput, expectedOwner: string | null = owner) => (await db.query<{receipt: LiveLearningBatch}>('select public.save_language_live_learning($1,$2) receipt', [value, expectedOwner])).rows[0].receipt;
const snapshot = async (expectedOwner: string = owner) => (await db.query<{snapshot: LiveLearningSnapshot}>('select public.read_language_live_learning($1) snapshot', [expectedOwner])).rows[0].snapshot;
const lesson = async (lessonId = randomUUID(), expected = 0, operation = 'create', date = '2026-10-09', restore: number | null = null) => {
  await db.query('select public.save_language_live_lesson($1,$2,$3,$4,$5,$6,true,$7,$8)', [randomUUID(), lessonId, expected, operation, ['create','edit'].includes(operation) ? report(date) : null, restore, ['create','edit'].includes(operation) ? '독립적인 합성 수업' : null, owner]);
  return lessonId;
};
const count = async () => Number((await db.query<{n: number}>('select count(*) n from public.language_live_learning_batches')).rows[0].n);

before(async () => {
  await db.exec(`create role authenticated; create role anon; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create table public.language_user_state(user_id uuid primary key,state jsonb,updated_at timestamptz default now());`);
  await db.exec(readMigration('20261009164307_language_live_report_history'));
  await db.exec(readMigration('20261009173440_language_live_learning_history'));
});
after(async () => db.close());
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade; truncate public.language_user_state; insert into auth.users values('${owner}'),('${other}'); insert into public.language_user_state values('${owner}','{"languageRecordResetV1":"2026-10-01|generation-9","japaneseCurriculumProgressV1":"untouched"}','2026-10-01T00:00:00Z'); set app.test_user='${owner}'; set role authenticated;`);
});

test('atomic confirmed batch retains exact evidence and replays lost-response receipt', async () => {
  const source = await lesson(), value = input(source);
  const first = await save(value);
  assert.deepEqual(await save(value), first); assert.equal(await count(), 1);
  assert.equal(first.payload.events[0].evidenceText, evidence);
  assert.equal(first.payload.events[0].hintUsed, null);
  const loaded = await snapshot(); assert.deepEqual(decodeLiveLearningSnapshot(loaded, owner), loaded);
  assert.equal(loaded.batches.length, 1);
  await assert.rejects(save({ ...value, changeReason: '다른 요청 내용' }), /LIVE_CONFLICT learning request/);
});

test('correction and scoped clear are append-only CAS generations; stale saves never revive progress', async () => {
  const source = await lesson(), firstInput = input(source); const first = await save(firstInput);
  const clear = input(source, { expectedVersion: 1, events: [], changeReason: '이 수업의 잘못 연결한 평가만 해제' });
  const cleared = await save(clear); assert.equal(cleared.version, 2);
  assert.equal((await db.query<{payload: SaveLiveLearningInput}>('select payload from public.language_live_active_learning_batches')).rows[0].payload.events.length, 0);
  await assert.rejects(save(input(source, { expectedVersion: 1 })), /LIVE_CONFLICT learning version/);
  assert.deepEqual(await save(firstInput), first); assert.deepEqual(await save(clear), cleared);
  assert.equal(await count(), 2);
  assert.equal((await snapshot()).batches[0].payload.events.length, 1);
});

test('racing writers cannot overwrite each other and one failed batch leaves no fragments', async () => {
  const source = await lesson();
  const results = await Promise.allSettled([save(input(source)), save(input(source))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(await count(), 1);
  const next = input(source, { expectedVersion: 1 });
  await db.exec('reset role; alter table public.language_live_learning_batches add constraint synthetic_failure check(version<2); set role authenticated;');
  await assert.rejects(save(next)); assert.equal(await count(), 1);
  await db.exec('reset role; alter table public.language_live_learning_batches drop constraint synthetic_failure; set role authenticated;');
  assert.equal((await save(next)).version, 2);
});

test('edited, deleted and restored source revisions never accidentally reactivate obsolete evidence', async () => {
  const source = await lesson(), originalInput = input(source); const original = await save(originalInput);
  await lesson(source, 1, 'edit');
  assert.equal((await db.query('select * from public.language_live_active_learning_batches')).rows.length, 0);
  await assert.rejects(save(input(source, { expectedVersion: 1 })), /LIVE_CONFLICT learning source/);
  await save(input(source, { lessonRevision: 2 }));
  // P1 delete API requires no duplicate override.
  await db.query('select public.save_language_live_lesson($1,$2,2,$3,null,null,false,null,$4)', [randomUUID(),source,'delete',owner]);
  assert.equal((await db.query('select * from public.language_live_active_learning_batches')).rows.length, 0);
  await db.query('select public.save_language_live_lesson($1,$2,3,$3,null,1,false,null,$4)', [randomUUID(),source,'restore',owner]);
  assert.equal((await db.query('select * from public.language_live_active_learning_batches')).rows.length, 0);
  const restored = await save(input(source, { lessonRevision: 4, events: original.payload.events, changeReason: '복원한 보고서의 기존 근거를 다시 확인' }));
  assert.equal(restored.payload.events[0].occurredDate, original.payload.events[0].occurredDate);
  assert.equal((await snapshot()).batches.length, 3);
  assert.deepEqual(await save(originalInput), original);
});

test('item identity and repeated errors use the same confirmed item without orthography merging', async () => {
  const source = await lesson(); await save(input(source));
  const next = await lesson();
  const error = event({ kind: 'review', result: 'incorrect', certainty: 'confirmed' });
  await save(input(next, { events: [error] }));
  await assert.rejects(save(input(await lesson(), { events: [event({ item: { itemId: randomUUID(), kind: 'kana', text: 'え', meaning: '' } })] })), /LIVE_CONFLICT learning identity/);
  await assert.rejects(save(input(await lesson(), { events: [event({ item: { itemId, kind: 'kana', text: 'エ', meaning: '' } })] })), /LIVE_CONFLICT learning identity/);
  await save(input(await lesson(), { events: [event({ item: { itemId: randomUUID(), kind: 'kana', text: 'エ', meaning: '' } })] }));
  await save(input(await lesson(), { events: [event({ item: { itemId: randomUUID(), kind: 'word', text: 'え', meaning: '다른 동음어' } })] }));
  assert.equal(await count(), 4);
});

test('relearning and reassessment link same owner/item/skill; malformed or inactive links fail', async () => {
  const source = await lesson();
  const relearn = event({ kind: 'relearn', relearningText: '획과 소리를 다시 연결했다' });
  const reassess = event({ kind: 'reassessment', result: 'independent_correct', independent: true, hintUsed: false, linkedRelearningEventId: relearn.eventId });
  await save(input(source, { events: [relearn, reassess] }));
  const later = await lesson();
  await save(input(later, { events: [{ ...reassess, eventId: randomUUID(), occurredDate: '2026-10-10' }] }));
  await assert.rejects(save(input(await lesson(), { events: [{ ...reassess, eventId: randomUUID(), skill: 'writing' }] })), /LIVE_VALIDATION relearning link/);
  await assert.rejects(save(input(await lesson(), { events: [{ ...reassess, eventId: randomUUID(), linkedRelearningEventId: randomUUID() }] })), /LIVE_VALIDATION relearning link/);
  await save(input(source, { expectedVersion: 1, events: [] }));
  await assert.rejects(save(input(await lesson(), { events: [{ ...reassess, eventId: randomUUID() }] })), /LIVE_VALIDATION relearning link/);
});

test('A/B isolation, owner spoofing, cross-owner source, anon and immutable history are enforced', async () => {
  const source = await lesson(), value = input(source); await save(value);
  await assert.rejects(db.exec("update public.language_live_learning_batches set payload=payload"), /permission denied/);
  await assert.rejects(db.exec('delete from public.language_live_learning_batches'), /permission denied/);
  await db.exec(`set app.test_user='${other}';`);
  assert.equal(await count(), 0); assert.deepEqual((await snapshot(other)).batches, []);
  await assert.rejects(save(input(source)), /LIVE_ACCOUNT_CHANGED/);
  await assert.rejects(save(input(source), other), /LIVE_CONFLICT learning source/);
  await assert.rejects(save(input(source), null), /LIVE_ACCOUNT_CHANGED/);
  await assert.rejects(db.query(`insert into public.language_live_learning_batches values($1,$2,1,1,0,$3,$4,'forged',now())`, [owner,source,randomUUID(),value]), /LIVE_AUTH|row-level security/);
  await db.exec('set role anon;');
  for (const query of ['select * from public.language_live_learning_batches', 'select * from public.language_live_current_learning_batches', 'select * from public.language_live_active_learning_batches']) await assert.rejects(db.exec(query), /permission denied/);
  await assert.rejects(save(value), /permission denied/); await assert.rejects(snapshot(), /permission denied/);
  await db.exec("set role authenticated; set app.test_user='';"); await assert.rejects(save(value), /LIVE_AUTH/);
});

test('direct INSERT receives source, CAS, identity, receipt and timestamp protection', async () => {
  const source = await lesson(), value = input(source);
  const direct = (await db.query<LiveLearningBatch>(`insert into public.language_live_learning_batches values($1,$2,1,1,0,$3,$4,'forged','2000-01-01') returning *`, [owner,source,value.requestId,value])).rows[0];
  assert.notEqual(direct.payload_hash, 'forged'); assert.notEqual(new Date(direct.created_at).getUTCFullYear(), 2000);
  const next = input(source, { expectedVersion: 1 });
  await assert.rejects(db.query(`insert into public.language_live_learning_batches values($1,$2,1,3,2,$3,$4,'forged',now())`, [owner,source,next.requestId,next]), /LIVE_VALIDATION|LIVE_CONFLICT/);
  assert.equal(await count(), 1);
});

test('evidence must be an exact source field excerpt; unknown is not accepted as confirmed achievement', async () => {
  const source = await lesson();
  await assert.rejects(save(input(source, { events: [event({ evidenceText: 'not in report' })] })), /LIVE_VALIDATION source evidence/);
  await assert.rejects(save(input(source, { events: [event({ sourceField: 'speaking' })] })), /LIVE_VALIDATION source evidence/);
  assert.equal(await count(), 0);
});

test('SQL and client validation reject malformed flags/dates/unknown keys/unbounded evidence', async () => {
  const source = await lesson();
  const invalid: unknown[] = [
    { ...input(source), confirmed: false }, { ...input(source), policyVersion: 'future-policy' },
    { ...input(source), expectedVersion: 1.1 }, { ...input(source), extra: true },
    ...[{ skill: 'all' }, { sourceField: null }, { occurredDate: '2026-02-29' }, { occurredDate: '2026-2-03' },
      { result: 'independent_correct' }, { result: 'hinted_correct', hintUsed: false }, { certainty: 'uncertain', forgettingConfirmed: true },
      { evidenceText: '😀'.repeat(2501) }, { kind: 'relearn', relearningText: '' },
      { teacherRecommendationConfirmed: true, teacherRecommendedDue: '2026-10-08' },
      { teacherRecommendationConfirmed: true, occurredDate: null, teacherRecommendedDue: '2026-10-10' },
      { kind: 'reassessment', linkedRelearningEventId: null }, { extra: null },
    ].map(changes => ({ ...input(source), events: [{ ...event(), ...changes }] })),
  ];
  for (const value of invalid) {
    assert.ok(validateLiveLearningInput(value).length, JSON.stringify(value));
    const valid = (await db.query<{valid: boolean}>('select public.language_live_learning_is_valid($1) valid', [value])).rows[0].valid;
    assert.equal(valid, false, JSON.stringify(value));
    await assert.rejects(save(value as SaveLiveLearningInput), /LIVE_VALIDATION/);
  }
  assert.equal(await count(), 0);
});

test('null date, uncertain evidence, hinted success and confirmed teacher due remain explicit', async () => {
  const source = await lesson();
  const events = [event({ occurredDate: null, certainty: 'uncertain', kind: 'review', result: 'uncertain' }),
    event({ kind: 'review', result: 'hinted_correct', independent: false, hintUsed: true, teacherRecommendedDue: '2026-10-11', teacherRecommendationConfirmed: true })];
  const value = input(source, { events }); assert.deepEqual(validateLiveLearningInput(value), []);
  assert.deepEqual((await save(value)).payload.events, events);
});

test('JSON key order retries are identical and event IDs cannot migrate to unrelated lessons', async () => {
  const source = await lesson(), value = input(source); const first = await save(value);
  const reverse = Object.fromEntries(Object.entries(value).reverse()) as SaveLiveLearningInput;
  assert.deepEqual(await save(reverse), first);
  await assert.rejects(save(input(await lesson(), { events: value.events })), /LIVE_CONFLICT learning identity/);
});

test('legacy reset generation and all existing state remain unchanged; public code is invoker', async () => {
  const source = await lesson(); await save(input(source));
  await save(input(source, { expectedVersion: 1, events: [] }));
  await db.exec('reset role;');
  const legacy = (await db.query<{state: unknown; updated_at: string}>('select state,updated_at from public.language_user_state')).rows[0];
  assert.deepEqual(legacy.state, { languageRecordResetV1: '2026-10-01|generation-9', japaneseCurriculumProgressV1: 'untouched' });
  assert.equal(new Date(legacy.updated_at).toISOString(), '2026-10-01T00:00:00.000Z');
  const functions = (await db.query<{prosecdef: boolean; proconfig: string[]}>("select prosecdef,proconfig from pg_proc where proname in ('read_language_live_learning','save_language_live_learning','validate_language_live_learning_batch')")).rows;
  assert.equal(functions.length, 3); assert.ok(functions.every(row => !row.prosecdef && row.proconfig.includes('search_path=""')));
  const views = (await db.query<{reloptions: string[]}>("select reloptions from pg_class where relname in ('language_live_current_learning_batches','language_live_active_learning_batches')")).rows;
  assert.ok(views.every(view => view.reloptions.includes('security_invoker=true')));
});


test('persisted mastery, forgetting, relearning and reassessment round-trip through the real reducer', async () => {
  for (const [index, date] of ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-09'].entries()) {
    const source = await lesson(randomUUID(), 0, 'create', date);
    await save(input(source, { events: [event({ occurredDate: date, ...(index ? {
      kind: 'review', result: 'independent_correct', independent: true, hintUsed: false,
    } : {}) })] }));
  }
  const readState = async () => projectLiveLearning(decodeLiveLearningSnapshot(JSON.parse(JSON.stringify(await snapshot())), owner));
  const mastered = (await readState()).states[0];
  assert.equal(mastered.status, 'mastery_confirmed'); assert.equal(mastered.masteryHistory.length, 1);
  assert.equal(mastered.nextDue, '2026-10-23');
  const source = await lesson(randomUUID(), 0, 'create', '2026-10-10');
  const relearn = event({ occurredDate: '2026-10-10', kind: 'relearn', relearningText: '획과 발음을 다시 연결함' });
  const observations = [
    event({ occurredDate: '2026-10-10', kind: 'forgetting', result: 'cannot_recall', forgettingConfirmed: true }),
    relearn,
    event({ occurredDate: '2026-10-10', kind: 'reassessment', result: 'independent_correct', independent: true,
      hintUsed: false, linkedRelearningEventId: relearn.eventId }),
  ];
  await save(input(source, { events: observations }));
  const after = (await readState()).states[0];
  assert.equal(after.status, 'learning'); assert.equal(after.nextDue, '2026-10-11');
  assert.equal(after.firstLearnedDate, '2026-10-01'); assert.equal(after.masteryHistory.length, 1);
  assert.equal(after.history.length, 7); assert.equal(after.history[4].previousStatus, 'mastery_confirmed');
  assert.equal(after.history[4].status, 'relearn_needed');
  assert.equal(after.history[6].event.linkedRelearningEventId, relearn.eventId);
  await save(input(source, { expectedVersion: 1, events: [], changeReason: '이 보고서의 연결만 해제' }));
  const cleared = await readState();
  assert.equal(cleared.states[0].status, 'mastery_confirmed');
  assert.equal(cleared.inactiveBatches.length, 1);
  assert.deepEqual(cleared.inactiveBatches[0].payload.events, observations);
});

test('unknown source excerpts cannot become confirmed achievement through direct insert or RPC', async () => {
  const source = randomUUID();
  const unknownReport = parseLiveReport('[연이 AI 일본어 학습 기록 v1.1]\n학습 날짜: 2026-10-09\n읽기 학습 결과: 미확인');
  await db.query('select public.save_language_live_lesson($1,$2,0,$3,$4,null,false,null,$5)', [randomUUID(), source, 'create', unknownReport, owner]);
  const value = input(source, { events: [event({ evidenceText: '미확인', kind: 'review', result: 'independent_correct', independent: true, hintUsed: false })] });
  await assert.rejects(save(value), /LIVE_VALIDATION source evidence/);
  await assert.rejects(db.query(`insert into public.language_live_learning_batches values($1,$2,1,1,0,$3,$4,'forged',now())`, [owner, source, value.requestId, value]), /LIVE_VALIDATION source evidence/);
  assert.equal(await count(), 0);
  const uncertain = { ...value, requestId: randomUUID(), events: [event({ evidenceText: '미확인', kind: 'review', result: 'uncertain', certainty: 'uncertain' })] };
  await save(uncertain);
  const projected = projectLiveLearning(decodeLiveLearningSnapshot(await snapshot(), owner));
  assert.equal(projected.states[0].status, null); assert.equal(projected.states[0].nextDue, null);
  assert.equal(projected.states[0].independentSuccessCount, 0);
});

test('explicitly unlearned source cannot support achievement, while unlearned and uncertain records remain valid', async () => {
  const source = randomUUID();
  const unlearnedReport = parseLiveReport('[연이 AI 일본어 학습 기록 v1.1]\n학습 날짜: 2026-10-09\n읽기 학습 결과: 미학습');
  assert.equal(unlearnedReport.fields.reading.presence, 'not_learned');
  await db.query('select public.save_language_live_lesson($1,$2,0,$3,$4,null,false,null,$5)', [randomUUID(), source, 'create', unlearnedReport, owner]);
  const value = input(source, { events: [event({ evidenceText: '미학습', kind: 'review', result: 'independent_correct', independent: true, hintUsed: false })] });
  await assert.rejects(save(value), /LIVE_VALIDATION source evidence/);
  await assert.rejects(db.query(`insert into public.language_live_learning_batches values($1,$2,1,1,0,$3,$4,'forged',now())`, [owner, source, value.requestId, value]), /LIVE_VALIDATION source evidence/);
  for (const changes of [
    { kind: 'learn' as const },
    { kind: 'relearn' as const, relearningText: '근거에 없는 학습' },
    { kind: 'forgetting' as const, result: 'cannot_recall' as const, forgettingConfirmed: true },
  ]) await assert.rejects(save(input(source, { events: [event({ evidenceText: '미학습', ...changes })] })), /LIVE_VALIDATION source evidence/);
  assert.equal(await count(), 0);

  await save(input(source, { events: [event({ evidenceText: '미학습', kind: 'not_learned' })] }));
  let projected = projectLiveLearning(decodeLiveLearningSnapshot(await snapshot(), owner));
  assert.equal(projected.states[0].status, 'unlearned');
  assert.equal(projected.states[0].independentSuccessCount, 0);
  await save(input(source, { expectedVersion: 1, events: [event({ evidenceText: '미학습', kind: 'review', result: 'uncertain', certainty: 'uncertain' })] }));
  projected = projectLiveLearning(decodeLiveLearningSnapshot(await snapshot(), owner));
  assert.equal(projected.states[0].status, null);
  assert.equal(projected.states[0].independentSuccessCount, 0);
});
