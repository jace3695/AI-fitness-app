import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { parseLiveReport } from '../lib/language-live/report-parser.ts';
import { validateLiveReport } from '../lib/language-live/validation.ts';
import type { LiveLesson } from '../lib/language-live/types.ts';

const db = new PGlite();
const owner = randomUUID(), other = randomUUID();
const migration = readFileSync(new URL('../supabase/migrations/20261009164307_language_live_report_history.sql', import.meta.url), 'utf8');
const raw = '[연이 AI 일본어 학습 기록 v1.1]\r\n학습 날짜: 2026-10-09\r\n수업 주제: あ・え\r\n쓰기 학습 결과: 미학습\r\n틀린 부분: 해당 없음';
const report = () => parseLiveReport(raw);
const request = (changes: Record<string, unknown> = {}) => ({ requestId: randomUUID(), lessonId: randomUUID(), expected: 0, operation: 'create', report: report(), restore: null, allowDuplicate: false, reason: null, expectedOwner: owner, ...changes });
const apply = async (input: ReturnType<typeof request>) => (await db.query<{receipt: LiveLesson}>('select public.save_language_live_lesson($1,$2,$3,$4,$5,$6,$7,$8,$9) receipt', [input.requestId,input.lessonId,input.expected,input.operation,input.report,input.restore,input.allowDuplicate,input.reason,input.expectedOwner])).rows[0].receipt;
const rowCount = async () => Number((await db.query<{n: number}>('select count(*) n from public.language_live_lessons')).rows[0].n);
const latest = async () => (await db.query<LiveLesson>('select * from public.language_live_current_lessons')).rows;

before(async () => {
  await db.exec(`create role authenticated; create role anon; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create table public.language_user_state(user_id uuid primary key,state jsonb,updated_at timestamptz default now());`);
  await db.exec(migration);
});
after(async () => db.close());
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade; truncate public.language_user_state; insert into auth.users values('${owner}'),('${other}'); insert into public.language_user_state values('${owner}','{"legacy":"must stay exact"}','2026-10-01T00:00:00Z'); set app.test_user='${owner}'; set role authenticated;`);
});

test('one immutable revision is also an idempotent receipt; exact source/25 fields preserved', async () => {
  const input=request(); const first=await apply(input); const second=await apply(input);
  assert.deepEqual(second, first); assert.equal(await rowCount(), 1);
  assert.equal(first.report.rawText, raw); assert.equal(Object.keys(first.report.fields).length, 25);
  assert.equal(first.report.fields.writing.presence, 'not_learned');
  assert.equal(first.report.fields.speaking.presence, 'unknown');
  assert.equal((await db.query('select * from public.language_live_mutations')).rows.length, 1);
  await assert.rejects(apply({ ...input, report: parseLiveReport(raw+'\n추가 내용') }), /LIVE_CONFLICT request/);
  assert.equal(await rowCount(), 1);
});

test('v1 and missing dates work; SQL rejects invalid dates and malformed canonical fields', async () => {
  const old=parseLiveReport('[연이 AI 일본어 학습 기록 v1]\n수업 주제: 이전 보고서');
  const saved=await apply(request({report:old})); assert.equal(saved.report.lessonDate,null); assert.equal(saved.report.fields.reassessments.presence,'unknown');
  for (const invalid of [parseLiveReport('학습 날짜: 2026-02-29'), { ...report(), fields:{} }, { ...report(), lessonTimezone:'bad-zone' }, { ...report(), rawText:'' }, { ...report(), lessonDate:'2026-10-08' }]) {
    await assert.rejects(apply(request({report:invalid})), /LIVE_VALIDATION|check constraint/);
  }
  assert.equal(await rowCount(),1);
});

test('same content duplicates require explicit reason but other dates and lessons are not merged', async () => {
  await apply(request());
  await assert.rejects(apply(request()), /LIVE_DUPLICATE/);
  await assert.rejects(apply(request({allowDuplicate:true,reason:null})), /LIVE_VALIDATION/);
  const separate=await apply(request({allowDuplicate:true,reason:'같은 날짜에 다시 진행한 별도 수업'}));
  assert.equal(separate.duplicate_reason,'같은 날짜에 다시 진행한 별도 수업');
  await apply(request({report:parseLiveReport(raw.replace('2026-10-09','2026-10-10'))}));
  assert.equal((await latest()).length,3);
});

test('edit/delete/restore append history; deleted latest never exposes an older active version', async () => {
  const create=request(); const first=await apply(create);
  const edit=request({lessonId:create.lessonId,expected:1,operation:'edit',report:parseLiveReport(raw+'\n말하기 학습 결과: 미확인')});
  const second=await apply(edit); assert.equal(second.revision,2);
  const remove=request({lessonId:create.lessonId,expected:2,operation:'delete',report:null});
  const deleted=await apply(remove); assert.equal(deleted.report.rawText,second.report.rawText);
  assert.equal((await db.query("select * from public.language_live_current_lessons where operation<>'delete'")).rows.length,0);
  assert.deepEqual(await apply(remove),deleted);
  await assert.rejects(apply(request({lessonId:create.lessonId,expected:3,operation:'edit'})), /LIVE_CONFLICT/);
  const restore=request({lessonId:create.lessonId,expected:3,operation:'restore',restore:1,report:null});
  const restored=await apply(restore); assert.deepEqual(restored.report,first.report); assert.equal(restored.revision,4);
  assert.equal(await rowCount(),4); assert.equal((await latest())[0].revision,4);
  assert.deepEqual(await apply(create),first); // A lost older response can still recover its exact receipt.
});

test('stale concurrent edits cannot overwrite each other and keep both originals', async () => {
  const original=request(); await apply(original);
  const a=request({lessonId:original.lessonId,expected:1,operation:'edit',report:parseLiveReport(raw+'\n읽기 학습 결과: a')});
  const b=request({lessonId:original.lessonId,expected:1,operation:'edit',report:parseLiveReport(raw+'\n읽기 학습 결과: b')});
  const results=await Promise.allSettled([apply(a),apply(b)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1); assert.equal(await rowCount(),2);
  assert.equal((await db.query<{report:unknown}>('select report from public.language_live_lessons where revision=1')).rows[0].report && true,true);
});

test('rollback leaves no partial history/receipt and same request can succeed afterward', async () => {
  const input=request();
  await db.exec("reset role; alter table public.language_live_lessons add constraint synthetic_failure check(operation<>'create'); set role authenticated;");
  await assert.rejects(apply(input)); assert.equal(await rowCount(),0);
  await db.exec('reset role; alter table public.language_live_lessons drop constraint synthetic_failure; set role authenticated;');
  await apply(input); assert.equal(await rowCount(),1);
});

test('authenticated A/B, owner spoof, views and anon are isolated; prior history cannot be changed', async () => {
  const input=request(); await apply(input);
  await assert.rejects(db.exec('update public.language_live_lessons set report=report'), /permission denied/);
  await assert.rejects(db.exec('delete from public.language_live_lessons'), /permission denied/);
  await db.exec(`set app.test_user='${other}';`);
  assert.equal(await rowCount(),0); assert.equal((await latest()).length,0); assert.equal((await db.query('select * from public.language_live_mutations')).rows.length,0);
  await assert.rejects(apply(request({lessonId:input.lessonId,expected:1,operation:'delete',report:null,expectedOwner:other})), /LIVE_CONFLICT/);
  await assert.rejects(db.query('insert into public.language_live_lessons select $1,$2,1,0,$3,$4,$5,$6,null,null,$7,now()', [owner,randomUUID(),'create',report(),randomUUID(),'forged',{}]), /LIVE_AUTH|row-level security/);
  await db.exec('set role anon;');
  await assert.rejects(db.exec('select * from public.language_live_current_lessons'), /permission denied/);
  await assert.rejects(apply(request()), /permission denied/);
  await db.exec("set role authenticated; set app.test_user='';");
  await assert.rejects(apply(request()), /LIVE_AUTH/);
});

test('direct insert cannot bypass expected revision or mutate deletion content', async () => {
  const input=request(); await apply(input);
  const inserted=(await db.query<Record<string,unknown>>('select * from public.language_live_lessons')).rows[0];
  await assert.rejects(db.query('insert into public.language_live_lessons select user_id,lesson_id,3,2,operation,report,$1,payload_hash,restored_from_revision,duplicate_reason,mutation,created_at from public.language_live_lessons',[randomUUID()]), /LIVE_CONFLICT revision/);
  assert.equal(inserted.revision,1);
  await assert.rejects(apply(request({lessonId:input.lessonId,expected:1,operation:'delete',report:report()})), /LIVE_VALIDATION/);
  assert.equal(await rowCount(),1);
});

test('legacy state is exactly untouched and new views/functions are invoker owner-scoped', async () => {
  await apply(request());
  await db.exec('reset role;');
  const old=(await db.query<{state:unknown,updated_at:Date}>('select state,updated_at from public.language_user_state')).rows[0];
  assert.deepEqual(old.state,{legacy:'must stay exact'}); assert.equal(new Date(old.updated_at).toISOString(),'2026-10-01T00:00:00.000Z');
  const security=(await db.query<{prosecdef:boolean}>("select prosecdef from pg_proc where proname='save_language_live_lesson'")).rows[0]; assert.equal(security.prosecdef,false);
  const views=(await db.query<{reloptions:string[]}>("select reloptions from pg_class where relname in ('language_live_current_lessons','language_live_mutations')")).rows; assert.ok(views.every(view=>view.reloptions.includes('security_invoker=true')));
});

test('restoring an edited active lesson preserves both reports and appends a new revision', async () => {
  const input = request();
  const original = await apply(input);
  const edit = await apply(request({ lessonId: input.lessonId, expected: 1, operation: 'edit', report: parseLiveReport(raw + '\n읽기 학습 결과: 확인 필요') }));
  const restored = await apply(request({ lessonId: input.lessonId, expected: 2, operation: 'restore', restore: 1, report: null }));
  assert.equal(restored.revision, 3);
  assert.equal(restored.restored_from_revision, 1);
  assert.deepEqual(restored.report, original.report);
  assert.equal((await db.query<{report: unknown}>('select report from public.language_live_lessons where revision=2')).rows[0].report && true, true);
  assert.notDeepEqual(edit.report, restored.report);
});

test('a changed auth owner or omitted expected owner cannot write a pending draft', async () => {
  await db.exec(`set app.test_user='${other}';`);
  await assert.rejects(apply(request()), /LIVE_ACCOUNT_CHANGED/);
  await assert.rejects(apply(request({ expectedOwner: null })), /LIVE_ACCOUNT_CHANGED/);
  assert.equal(await rowCount(), 0);
  const saved = await apply(request({ expectedOwner: other }));
  assert.equal(saved.user_id, other);
  await db.exec(`set app.test_user='${owner}';`);
  assert.equal(await rowCount(), 0);
});

test('direct inserts enforce canonical receipts, ownership, source metadata and timestamps', async () => {
  const input = request();
  await apply(input);
  const insert = `insert into public.language_live_lessons select user_id,$1,1,0,'create',report,$2,'forged',null,null,$3,'2000-01-01' from public.language_live_lessons limit 1`;
  await assert.rejects(db.query(insert, [randomUUID(), randomUUID(), {}]), /LIVE_VALIDATION mutation/);
  for (const changes of [{ source: 'invented' }, { importFormat: 'automatic_sync' }, { structuredSchemaVersion: '1' }]) {
    await assert.rejects(apply(request({ report: { ...report(), ...changes } })), /LIVE_VALIDATION/);
  }
  assert.equal(await rowCount(), 1);
  const lessonId = randomUUID(), requestId = randomUUID(), directReport = parseLiveReport(raw + '\n직접 입력 합성 검증');
  const mutation = { lessonId, expectedRevision: 0, operation: 'create', report: directReport, restoreRevision: null, allowDuplicate: false, duplicateReason: null };
  const direct = (await db.query<{payload_hash: string; created_at: string}>(`insert into public.language_live_lessons(user_id,lesson_id,revision,previous_revision,operation,report,request_id,payload_hash,mutation,created_at)
    values($1,$2,1,0,'create',$3,$4,'forged',$5,'2000-01-01') returning payload_hash,created_at`, [owner, lessonId, directReport, requestId, mutation])).rows[0];
  assert.notEqual(direct.payload_hash, 'forged');
  assert.notEqual(new Date(direct.created_at).getUTCFullYear(), 2000);
  assert.equal(await rowCount(), 2);
});

test('equivalent JSON key order retries are idempotent; old receipts survive newer edits', async () => {
  const input = request();
  const first = await apply(input);
  const reordered = Object.fromEntries(Object.entries(input.report).reverse());
  const retry = await apply({ ...input, report: reordered as typeof input.report });
  assert.deepEqual(retry, first);
  await apply(request({ lessonId: input.lessonId, expected: 1, operation: 'edit', report: parseLiveReport(raw + '\n말하기 학습 결과: 평가 안 함') }));
  assert.deepEqual(await apply(input), first);
  assert.equal(await rowCount(), 2);
});

test('punctuated unknown dates and source-only unsupported versions remain conservative', async () => {
  const saved = await apply(request({ report: parseLiveReport('[연이 AI 일본어 학습 기록 v2]\n학습 날짜: 미확인。') }));
  assert.equal(saved.report.lessonDate, null);
  assert.equal(saved.report.reportVersion, 'unknown');
  assert.equal(saved.report.fields.lessonDate.presence, 'unknown');
});

test('SQL and browser validation agree on Japanese/Unicode whitespace in edited fields', async () => {
  const value = report();
  value.fields.topic.text = '\u3000 あ・え \u00a0'; value.topic = value.fields.topic.text.trim();
  value.fields.stage.text = '\ufeff 初級\u2003'; value.stage = value.fields.stage.text.trim();
  value.fields.lessonDate.text = '\u30002026-10-09\u3000';
  const saved = await apply(request({ report: value }));
  assert.equal(saved.report.topic, 'あ・え'); assert.equal(saved.report.stage, '初級');
});

test('direct delete/restore inserts cannot attach create/edit-only duplicate overrides', async () => {
  const input = request(); await apply(input);
  for (const operation of ['delete', 'restore']) {
    const restoreRevision = operation === 'restore' ? 1 : null;
    const mutation = { lessonId: input.lessonId, expectedRevision: 1, operation, report: null, restoreRevision, allowDuplicate: true, duplicateReason: 'spoofed note' };
    await assert.rejects(db.query(`insert into public.language_live_lessons(user_id,lesson_id,revision,previous_revision,operation,report,request_id,payload_hash,restored_from_revision,duplicate_reason,mutation)
      values($1,$2,2,1,$3,$4,$5,'forged',$6,'spoofed note',$7)`, [owner,input.lessonId,operation,input.report,randomUUID(),restoreRevision,mutation]), /LIVE_VALIDATION duplicate reason/);
  }
  assert.equal(await rowCount(), 1);
});

test('SQL uses UTF-16 code units for every persisted string bound', async () => {
  const units = (await db.query<{n:number}>('select public.language_live_utf16_length($1) n', ['あ😀か\u3099'])).rows[0].n;
  assert.equal(units, 'あ😀か\u3099'.length);
  const allowed = { ...report(), rawText: '😀'.repeat(50000), unparsedText: '' };
  assert.deepEqual(validateLiveReport(allowed), []);
  const saved = await apply(request({ report: allowed }));
  assert.deepEqual(validateLiveReport(saved.report), []);
  const tooLong = '😀'.repeat(50001);
  const invalidReports = [
    { ...report(), rawText: tooLong },
    { ...report(), parserVersion: '😀'.repeat(26) },
    { ...report(), unparsedText: tooLong },
    { ...report(), warnings: ['😀'.repeat(501)] },
    { ...report(), fields: { ...report().fields, vocabulary: { text: tooLong, presence: 'reported' } } },
    { ...report(), fields: { ...report().fields, vocabulary: { text: 'test', presence: 'reported', sourceBlocks: [tooLong] } } },
  ];
  for (const invalid of invalidReports) {
    assert.ok(validateLiveReport(invalid).length);
    await assert.rejects(apply(request({ report: invalid })), /LIVE_VALIDATION/);
  }
  await assert.rejects(apply(request({ allowDuplicate: true, reason: '😀'.repeat(251) })), /LIVE_VALIDATION duplicate reason/);
  await assert.rejects(apply(request({ allowDuplicate: true, reason: '\u3000\u00a0\ufeff' })), /LIVE_VALIDATION duplicate reason/);
  assert.equal(await rowCount(), 1);
});

test('UTF-8 whole-report byte budget rejects oversized extra JSON in both validators', async () => {
  const invalid = { ...report(), extra: '漢'.repeat(700000) };
  assert.ok(validateLiveReport(invalid).some(message => message.includes('2MB')));
  await assert.rejects(apply(request({ report: invalid })), /LIVE_VALIDATION/);
  assert.equal(await rowCount(), 0);
});
