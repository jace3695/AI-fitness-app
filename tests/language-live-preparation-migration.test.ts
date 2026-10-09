import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { parseLiveReport } from '../lib/language-live/report-parser.ts';
import { buildLivePreparation, livePreparationSource } from '../lib/language-live/preparation.ts';
import { validateLivePreparationInput } from '../lib/language-live/preparation-validation.ts';
import { decodeLivePreparationHistory } from '../app/data/languageLivePreparationRepository.ts';
import type { LiveLearningEvent, LiveLearningSnapshot, SaveLiveLearningInput } from '../lib/language-live/learning-types.ts';
import type { LivePreparationRecord, SaveLivePreparationInput } from '../lib/language-live/preparation-types.ts';

const db = new PGlite();
const owner = randomUUID(), other = randomUUID(), itemId = randomUUID();
const migration = '20261009184604_language_live_preparations';
const readMigration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const report = () => parseLiveReport('[연이 AI 일본어 학습 기록 v1.1]\n학습 날짜: 2026-10-09\n수업 주제: 합성 학습\n읽기 학습 결과: えを読む\n다음 수업 추천: え를 확인');
const snapshot = async (expectedOwner = owner) => (await db.query<{ snapshot: LiveLearningSnapshot }>('select public.read_language_live_learning($1) snapshot', [expectedOwner])).rows[0].snapshot;
const input = async (changes: Partial<SaveLivePreparationInput> = {}): Promise<SaveLivePreparationInput> => ({ requestId: randomUUID(), preparationId: randomUUID(), expectedRevision: 0,
  preparation: buildLivePreparation(await snapshot(), '2026-10-10'), editedText: '확인하고 편집한 원문\nえ エ か\u3099\n', reviewed: true, ...changes });
const save = async (value: SaveLivePreparationInput, expectedOwner: string | null = owner) => (await db.query<{ receipt: LivePreparationRecord }>('select public.save_language_live_preparation($1,$2) receipt', [value, expectedOwner])).rows[0].receipt;
const history = async (expectedOwner = owner) => (await db.query<{ history: { ownerId: string; count: number; records: LivePreparationRecord[] } }>('select public.read_language_live_preparations($1) history', [expectedOwner])).rows[0].history;
const count = async () => Number((await db.query<{ n: number }>('select count(*) n from public.language_live_preparations')).rows[0].n);
const lesson = async (lessonId = randomUUID(), expected = 0, operation = 'create', restore: number | null = null) => {
  await db.query('select public.save_language_live_lesson($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), lessonId, expected, operation,
    ['create', 'edit'].includes(operation) ? report() : null, restore, ['create', 'edit'].includes(operation), ['create', 'edit'].includes(operation) ? '별도 합성 수업' : null, owner]);
  return lessonId;
};
const learning = async (lessonId: string, expectedVersion = 0, clear = false) => {
  const value: SaveLiveLearningInput = { requestId: randomUUID(), lessonId, lessonRevision: 1, expectedVersion, confirmed: true, policyVersion: 'live-review-v1', changeReason: '확인한 합성 평가',
    events: clear ? [] : [{ eventId: randomUUID(), item: { itemId, kind: 'kana', text: 'え', meaning: '' }, skill: 'reading', kind: 'learn', result: 'not_assessed', occurredDate: '2026-10-09', certainty: 'confirmed', independent: null, hintUsed: null, forgettingConfirmed: false, evidenceText: 'えを読む', sourceField: 'reading', reason: '확인한 합성 근거', relearningText: '', linkedRelearningEventId: null, teacherRecommendedDue: null, teacherRecommendationConfirmed: false }] };
  await db.query('select public.save_language_live_learning($1,$2)', [value, owner]); return value;
};
const insert = (value: SaveLivePreparationInput, changes: { owner?: string; id?: string; revision?: number; previous?: number; request?: string } = {}) => db.query<LivePreparationRecord>(
  `insert into public.language_live_preparations values($1,$2,$3,$4,$5,$6,'forged','2000-01-01') returning *`,
  [changes.owner ?? owner, changes.id ?? value.preparationId, changes.revision ?? value.expectedRevision + 1, changes.previous ?? value.expectedRevision, changes.request ?? value.requestId, value]);

before(async () => {
  await db.exec(`create role authenticated; create role anon; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create table public.language_user_state(user_id uuid primary key,state jsonb,updated_at timestamptz default now());`);
  for (const name of ['20261009164307_language_live_report_history', '20261009173440_language_live_learning_history', migration]) await db.exec(readMigration(name));
});
after(async () => db.close());
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade; truncate public.language_user_state; insert into auth.users values('${owner}'),('${other}');
    insert into public.language_user_state values('${owner}','{"languageRecordResetV1":"2026-10-01|generation-9","japaneseCurriculumProgressV1":"untouched"}','2026-10-01T00:00:00Z');
    set app.test_user='${owner}'; set role authenticated;`);
});

test('empty-history preparation persists generated/edited text exactly and retries immutable receipt', async () => {
  const value = await input(), first = await save(value);
  assert.deepEqual(first.payload, value); assert.deepEqual(await save(value), first); assert.equal(await count(), 1);
  assert.deepEqual(decodeLivePreparationHistory(await history(), owner), [first]);
  assert.deepEqual(await save(Object.fromEntries(Object.entries(value).reverse()) as SaveLivePreparationInput), first);
  await assert.rejects(save({ ...value, editedText: 'changed same request' }), /LIVE_CONFLICT preparation request/);
});

test('supplementary-character excerpts from real learning reasons round-trip through JSONB', async () => {
  const source = await lesson();
  const first = await learning(source);
  const updated: SaveLiveLearningInput = { ...first, requestId: randomUUID(), expectedVersion: 1,
    events: first.events.map(event => ({ ...event, kind: 'relearn', relearningText: 'え를 다시 연습', reason: `x${'😀'.repeat(450)}` })) };
  await db.query('select public.save_language_live_learning($1,$2)', [updated, owner]);
  const value = await input();
  assert.match(value.preparation.generatedText, /긴 원문 일부 생략/);
  const saved = await save(value);
  assert.deepEqual(saved.payload, value);
  assert.deepEqual(decodeLivePreparationHistory(await history(), owner), [saved]);
});

test('revision corrections retain all prior generated and edited text; racing stale writers cannot overwrite', async () => {
  const value = await input(), first = await save(value);
  const update = { ...value, requestId: randomUUID(), expectedRevision: 1, editedText: '두 번째 편집문' };
  const results = await Promise.allSettled([save(update), save({ ...update, requestId: randomUUID(), editedText: '경합 편집문' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(await count(), 2);
  const rows = decodeLivePreparationHistory(await history(), owner); assert.equal(rows.length, 2); assert.deepEqual(rows.find(row => row.revision === 1), first);
  await assert.rejects(save({ ...update, requestId: randomUUID() }), /LIVE_CONFLICT preparation revision/);
  assert.deepEqual(await save(value), first);
});

test('complete manifest includes tombstones and every corrected/cleared batch, and prevents stale-source saves', async () => {
  const source = await lesson(); await learning(source); const firstInput = await input(), first = await save(firstInput);
  assert.equal(firstInput.preparation.selected.length, 1);
  await learning(source, 1, true);
  await assert.rejects(save({ ...firstInput, requestId: randomUUID(), preparationId: randomUUID() }), /LIVE_CONFLICT preparation source/);
  assert.deepEqual(await save(firstInput), first, 'committed request replay precedes source freshness');
  const cleared = await input(); assert.equal(cleared.preparation.source.batches.length, 2); assert.equal(cleared.preparation.selected.length, 0); await save(cleared);
  await lesson(source, 1, 'edit'); await assert.rejects(save({ ...cleared, requestId: randomUUID(), preparationId: randomUUID() }), /LIVE_CONFLICT preparation source/);
  const edited = await input(); await save(edited);
  await lesson(source, 2, 'delete'); await assert.rejects(save({ ...edited, requestId: randomUUID(), preparationId: randomUUID() }), /LIVE_CONFLICT preparation source/);
  const deleted = await input(); assert.equal(deleted.preparation.source.lessons[0].operation, 'delete'); assert.equal(deleted.preparation.source.batches.length, 2); await save(deleted);
  const omitted = structuredClone(deleted); omitted.requestId = randomUUID(); omitted.preparationId = randomUUID(); omitted.preparation.source.lessons = []; omitted.preparation.source.batches = [];
  await assert.rejects(save(omitted), /LIVE_CONFLICT preparation source/);
  await lesson(source, 3, 'restore', 1); await assert.rejects(save({ ...deleted, requestId: randomUUID(), preparationId: randomUUID() }), /LIVE_CONFLICT preparation source/);
  assert.deepEqual(await save(firstInput), first); assert.deepEqual((await history()).records.find(row => row.request_id === firstInput.requestId), first);
});

test('new source creation, changed hashes and omitted inactive batch versions cannot pass freshness', async () => {
  const empty = await input(); const source = await lesson();
  await assert.rejects(save(empty), /LIVE_CONFLICT preparation source/);
  await learning(source); await learning(source, 1, true);
  const full = await input();
  for (const target of ['lessonHash', 'batchHash', 'omittedBatch']) {
    const value = structuredClone(full);
    if (target === 'lessonHash') value.preparation.source.lessons[0].payloadHash = 'forged';
    if (target === 'batchHash') value.preparation.source.batches[0].payloadHash = 'forged';
    if (target === 'omittedBatch') value.preparation.source.batches.shift();
    await assert.rejects(save(value), /LIVE_CONFLICT preparation source/);
    await assert.rejects(insert(value), /LIVE_CONFLICT preparation source/);
  }
  assert.equal(await count(), 0);
});

test('selected references must resolve to same item, skill and current active event, never unrelated history', async () => {
  const source = await lesson(); await learning(source); const value = await input(); assert.equal(value.preparation.selected.length, 1);
  for (const target of ['item', 'skill', 'text', 'event']) {
    const bad = structuredClone(value);
    if (target === 'item') bad.preparation.selected[0].itemId = randomUUID();
    if (target === 'skill') bad.preparation.selected[0].skill = 'writing';
    if (target === 'text') bad.preparation.selected[0].text = 'エ';
    if (target === 'event') bad.preparation.selected[0].events[0].eventId = randomUUID();
    await assert.rejects(save(bad), /LIVE_VALIDATION preparation event/);
    await assert.rejects(insert(bad), /LIVE_VALIDATION preparation event/);
  }
  await learning(source, 1, true);
  const inactive = structuredClone(value); inactive.preparation.source = livePreparationSource(await snapshot());
  await assert.rejects(save(inactive), /LIVE_VALIDATION preparation event/);
  assert.equal(await count(), 0);
});

test('future observations cannot be selected before preparation date through RPC or direct insert', async () => {
  const source = await lesson(); await learning(source); const future = await input();
  future.preparation.forDate = '2026-10-08';
  assert.deepEqual(validateLivePreparationInput(future), []);
  await assert.rejects(save(future), /LIVE_VALIDATION preparation event/);
  await assert.rejects(insert(future), /LIVE_VALIDATION preparation event/);
  assert.equal(await count(), 0);
  const current = await input(); assert.equal((await save(current)).revision, 1);
  const dated = await learning(source, 1);
  const undated: SaveLiveLearningInput = { ...dated, requestId: randomUUID(), expectedVersion: 2, events: dated.events.map(event => ({ ...event, occurredDate: null, certainty: 'uncertain', kind: 'review', result: 'uncertain' })) };
  await db.query('select public.save_language_live_learning($1,$2)', [undated, owner]);
  const unknownDate = await input(); assert.equal(unknownDate.preparation.selected[0].status, null);
  assert.equal((await save(unknownDate)).revision, 1);
});

test('future source lessons cannot contribute earlier observations before the preparation date', async () => {
  const source = randomUUID();
  const futureReport = parseLiveReport('[연이 AI 일본어 학습 기록 v1.1]\n학습 날짜: 2026-10-11\n수업 주제: 미래 수업\n읽기 학습 결과: えを読む');
  await db.query('select public.save_language_live_lesson($1,$2,0,$3,$4,null,false,null,$5)', [randomUUID(), source, 'create', futureReport, owner]);
  await learning(source);
  const preparation = buildLivePreparation(await snapshot(), '2026-10-12');
  assert.equal(preparation.selected.length, 1);
  preparation.forDate = '2026-10-10';
  const value = await input({ preparation });
  assert.deepEqual(validateLivePreparationInput(value), []);
  await assert.rejects(save(value), /LIVE_VALIDATION preparation event/);
  await assert.rejects(insert(value), /LIVE_VALIDATION preparation event/);
  assert.equal(await count(), 0);
  const current = await input();
  assert.deepEqual(current.preparation.selected, []);
  assert.equal((await save(current)).revision, 1);
});

test('direct INSERT enforces owner, revision, request linkage, fresh source and server receipt fields', async () => {
  const value = await input(); const direct = (await insert(value)).rows[0];
  assert.notEqual(direct.payload_hash, 'forged'); assert.notEqual(new Date(direct.created_at).getUTCFullYear(), 2000);
  for (const changes of [{ id: randomUUID() }, { request: randomUUID() }, { previous: 2, revision: 3 }, { previous: 0, revision: 2 }]) {
    await assert.rejects(insert({ ...value, requestId: randomUUID() }, changes), /LIVE_VALIDATION|LIVE_CONFLICT/);
  }
  const next = { ...value, expectedRevision: 1, requestId: randomUUID() };
  await db.exec('reset role; alter table public.language_live_preparations add constraint synthetic_failure check(revision<2); set role authenticated;');
  await assert.rejects(save(next)); assert.equal(await count(), 1);
  await db.exec('reset role; alter table public.language_live_preparations drop constraint synthetic_failure; set role authenticated;');
  assert.equal((await save(next)).revision, 2);
});

test('A/B isolation, owner spoofing, anon access and UPDATE/DELETE denial protect retained history', async () => {
  const value = await input(); await save(value);
  await assert.rejects(db.exec('update public.language_live_preparations set payload=payload'), /permission denied/);
  await assert.rejects(db.exec('delete from public.language_live_preparations'), /permission denied/);
  await db.exec(`set app.test_user='${other}';`); assert.equal(await count(), 0); assert.deepEqual((await history(other)).records, []);
  await assert.rejects(save(value), /LIVE_ACCOUNT_CHANGED/); await assert.rejects(history(owner), /LIVE_ACCOUNT_CHANGED/);
  await assert.rejects(save(value, other), /LIVE_VALIDATION preparation payload/); await assert.rejects(save(value, null), /LIVE_ACCOUNT_CHANGED/);
  await assert.rejects(insert(value), /LIVE_AUTH|row-level security/);
  await db.exec('set role anon;');
  for (const operation of [() => save(value), () => history(), () => db.exec('select * from public.language_live_preparations')]) await assert.rejects(operation(), /permission denied/);
  await db.exec("set role authenticated; set app.test_user='';"); await assert.rejects(save(value), /LIVE_AUTH/);
});

test('SQL and client reject malformed dates, flags, limits, duplicate references and unknown keys', async () => {
  const source = await lesson(); await learning(source); const base = await input();
  const invalid: unknown[] = [
    { ...base, reviewed: false }, { ...base, extra: true }, { ...base, expectedRevision: 1.1 }, { ...base, editedText: '😀'.repeat(30001) },
    ...[{ timezone: 'UTC' }, { templateVersion: 'future' }, { forDate: '2026-02-29' }, { forDate: null }, { maxItems: 11 }, { extra: true },
      { warnings: Array(21).fill('경고') }, { references: [base.preparation.references[0], base.preparation.references[0]] },
      { selected: [base.preparation.selected[0], base.preparation.selected[0]] },
      { selected: [{ ...base.preparation.selected[0], events: [] }] }, { generatedText: '　' },
      { source: { ...base.preparation.source, lessons: [...base.preparation.source.lessons, ...base.preparation.source.lessons] } },
    ].map(changes => ({ ...base, preparation: { ...base.preparation, ...changes } })),
  ];
  for (const value of invalid) {
    assert.ok(validateLivePreparationInput(value).length, JSON.stringify(value));
    const valid = (await db.query<{ valid: boolean }>('select public.language_live_preparation_is_valid($1) valid', [value])).rows[0].valid;
    assert.equal(valid, false, JSON.stringify(value)); await assert.rejects(save(value as SaveLivePreparationInput), /LIVE_VALIDATION/);
  }
  assert.equal(await count(), 0);
});

test('history overflow fails explicitly instead of silent truncation, while earlier rows remain intact', async () => {
  const value = await input(); await save(value);
  // Synthetic local fixture only: bypass the trigger to cheaply seed the read-limit boundary.
  await db.exec('reset role; alter table public.language_live_preparations disable trigger language_live_validate_preparation;');
  await db.query(`insert into public.language_live_preparations(user_id,preparation_id,revision,previous_revision,request_id,payload,payload_hash)
    select $1, gen_random_uuid(), 1, 0, gen_random_uuid(), $2, 'synthetic-limit' from generate_series(1,1000)`, [owner, value]);
  await db.exec('alter table public.language_live_preparations enable trigger language_live_validate_preparation; set role authenticated;');
  assert.equal(await count(), 1001); await assert.rejects(history(), /LIVE_LIMIT preparation history/);
  assert.deepEqual((await save(value)).payload, value);
});

test('legacy data and P1/P2 history stay intact; every new function is fixed-search-path invoker', async () => {
  const source = await lesson(); await learning(source); const learningBefore = await snapshot(); await save(await input()); assert.deepEqual(await snapshot(), learningBefore);
  await db.exec('reset role;');
  const legacy = (await db.query<{ state: unknown; updated_at: string }>('select state,updated_at from public.language_user_state')).rows[0];
  assert.deepEqual(legacy.state, { languageRecordResetV1: '2026-10-01|generation-9', japaneseCurriculumProgressV1: 'untouched' }); assert.equal(new Date(legacy.updated_at).toISOString(), '2026-10-01T00:00:00.000Z');
  const functions = (await db.query<{ prosecdef: boolean; proconfig: string[] }>("select prosecdef,proconfig from pg_proc where proname in ('language_live_preparation_is_valid','validate_language_live_preparation','save_language_live_preparation','read_language_live_preparations')")).rows;
  assert.equal(functions.length, 4); assert.ok(functions.every(row => !row.prosecdef && row.proconfig.includes('search_path=""')));
  const rls = (await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname='language_live_preparations'")).rows[0]; assert.equal(rls.relrowsecurity, true);
});


test('maximum 1000-reference template round-trips mastery, relearning and uncertain/none report evidence', async () => {
  const relearnItem = randomUUID(), uncertainItem = randomUUID();
  const sources: { lessonId: string; requestId: string; report: ReturnType<typeof parseLiveReport> }[] = [];
  const batches: SaveLiveLearningInput[] = [];
  for (let index = 0; index < 1000; index += 1) {
    const lessonId = randomUUID(), date = index === 0 ? '2026-09-30' : index === 1 ? '2026-10-01' : index === 2 ? '2026-10-05' : '2026-10-09';
    sources.push({ lessonId, requestId: randomUUID(), report: parseLiveReport(`[연이 AI 일본어 학습 기록 v1.1]\n학습 날짜: ${date}\n수업 주제: 최대 범위 합성 검증\n현재 학습 단계: 미확인\n오늘 배운 문법: 해당 없음\n읽기 학습 결과: えを読む\n쓰기 학습 결과: いを書いて再学習した\n듣기 학습 결과: 미확인`) });
    const observation: LiveLearningEvent = { eventId: randomUUID(), item: { itemId, kind: 'kana', text: 'え', meaning: '' }, skill: 'reading', kind: index ? 'review' : 'learn',
      result: index ? 'independent_correct' : 'not_assessed', occurredDate: date, certainty: 'confirmed', independent: index ? true : null, hintUsed: index ? false : null,
      forgettingConfirmed: false, evidenceText: 'えを読む', sourceField: 'reading', reason: '보존한 최대 범위 근거', relearningText: '', linkedRelearningEventId: null,
      teacherRecommendedDue: null, teacherRecommendationConfirmed: false };
    let events = [observation];
    if (index === 998) {
      const relearn: LiveLearningEvent = { ...observation, item: { itemId: relearnItem, kind: 'kana', text: 'い', meaning: '' }, skill: 'writing', sourceField: 'writing', evidenceText: 'いを書いて再学習した',
        kind: 'relearn', result: 'not_assessed', independent: null, hintUsed: null, relearningText: 'い의 획을 다시 학습' };
      events = [relearn, { ...relearn, eventId: randomUUID(), kind: 'reassessment', result: 'cannot_recall', forgettingConfirmed: true, linkedRelearningEventId: relearn.eventId }];
    }
    if (index === 999) events = [{ ...observation, item: { itemId: uncertainItem, kind: 'kana', text: 'う', meaning: '' }, skill: 'listening', sourceField: 'listening', evidenceText: '미확인',
      certainty: 'uncertain', result: 'uncertain', independent: null, hintUsed: null }];
    batches.push({ requestId: randomUUID(), lessonId, lessonRevision: 1, expectedVersion: 0, confirmed: true, policyVersion: 'live-review-v1', events, changeReason: '최대 범위 합성 이력' });
  }
  // Execute real P1/P2 invoker functions and triggers for every source; no schema/trigger bypass.
  await db.query(`select count(public.save_language_live_lesson((s->>'requestId')::uuid,(s->>'lessonId')::uuid,0,'create',s->'report',null,true,'별도 합성 수업',$2))
    from jsonb_array_elements($1::jsonb) s`, [sources, owner]);
  await db.query('select count(public.save_language_live_learning(b,$2)) from jsonb_array_elements($1::jsonb) b', [batches, owner]);
  const loaded = await snapshot(); assert.equal(loaded.lessons.length, 1000); assert.equal(loaded.batches.length, 1000);
  assert.ok(loaded.lessons.every(lesson => lesson.report.fields.stage.presence === 'unknown' && lesson.report.fields.grammar.presence === 'none'));
  const preparation = buildLivePreparation(loaded, '2026-10-10', 10);
  assert.equal(preparation.references.length, 1000);
  assert.equal(preparation.selected.find(item => item.itemId === itemId)?.status, 'mastery_confirmed');
  assert.equal(preparation.selected.find(item => item.itemId === relearnItem)?.status, 'relearn_needed');
  assert.equal(preparation.selected.find(item => item.itemId === uncertainItem)?.status, null);
  assert.ok(preparation.selected.every(item => item.events.length <= 21));
  assert.ok(preparation.selected.some(item => item.events.length >= 20));
  assert.match(preparation.generatedText, /미확인/); assert.match(preparation.generatedText, /해당 없음/); assert.match(preparation.generatedText, /재학습/);
  const value = await input({ preparation }); assert.deepEqual(validateLivePreparationInput(value), []);
  const saved = await save(value); assert.deepEqual(saved.payload, value);
  assert.deepEqual(decodeLivePreparationHistory(await history(), owner), [saved]);
});
