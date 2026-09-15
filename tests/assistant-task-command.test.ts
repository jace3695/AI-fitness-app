import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { commandDueDate, taskCommandDateLabel } from '../lib/assistant-task-command.ts';

const db = new PGlite();
const owner = randomUUID(), other = randomUUID();
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const values = { title: '합성 보고서', due_at: '2026-09-20T23:59:00+09:00', priority: 4, recurrence_rule: 'weekly', project_id: null };
type Row = Record<string, unknown>;
type Request = { id: string; operation: string; item: string | null; expected: Row | null; values: Row; reset: string | null; expires: string };
const request = (overrides: Partial<Request> = {}): Request => ({ id: randomUUID(), operation: 'create', item: null, expected: null, values, reset: null, expires: new Date(Date.now() + 15 * 60_000).toISOString(), ...overrides });
const apply = async (p: Request) => (await db.query<{receipt: Row}>('select public.apply_assistant_task_command($1,$2,$3,$4,$5,$6,$7) receipt', [p.id, p.operation, p.item, p.expected, p.values, p.reset, p.expires])).rows[0].receipt;
const undo = async (id: string) => (await db.query<{receipt: Row}>('select public.undo_assistant_task_command($1) receipt', [id])).rows[0].receipt;
const count = async (table: string) => Number((await db.query<{n: number}>(`select count(*) n from public.${table}`)).rows[0].n);
const item = async (id: string) => (await db.query<{row: Row}>('select to_jsonb(i) row from public.assistant_items i where id=$1', [id])).rows[0]?.row;

before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  await db.exec(read('./e2e/schema.sql'));
  await db.exec(read('../supabase/migrations/20260915033300_assistant_task_command_history.sql'));
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade; insert into auth.users values('${owner}'),('${other}');
    set app.test_user='${owner}'; set role authenticated;`);
});

test('confirmation creates one task and durable before/after receipt; lost-response retries do not duplicate', async () => {
  const p = request();
  const first = await apply(p);
  assert.equal(first.before_record, null);
  assert.equal((first.after_record as Row).title, values.title);
  assert.deepEqual(await apply(p), first);
  assert.equal(await count('assistant_items'), 1);
  assert.equal(await count('assistant_task_command_history'), 1);
  await assert.rejects(apply({ ...p, values: { ...values, priority: 1 } }), /이미 사용한 요청/);
});

test('failure saving history rolls back the task and allows the same confirmed request to be retried', async () => {
  const p = request();
  await db.exec("reset role; alter table public.assistant_task_command_history add constraint injected_failure check (operation <> 'create'); set role authenticated;");
  await assert.rejects(apply(p));
  assert.equal(await count('assistant_items'), 0);
  await db.exec('reset role; alter table public.assistant_task_command_history drop constraint injected_failure; set role authenticated;');
  await apply(p);
  assert.equal(await count('assistant_items'), 1);
});

test('update receipt preserves unrelated fields; undo restores values, remains in history and cannot execute again', async () => {
  const created = request(); await apply(created);
  await db.query('update public.assistant_items set notes=$1 where id=$2', ['보존할 메모', created.id]);
  const before = await item(created.id);
  const changed = request({ operation: 'update', item: created.id, expected: before, values: { ...values, due_at: null, priority: 1, recurrence_rule: 'none' } });
  const receipt = await apply(changed);
  assert.deepEqual(receipt.before_record, before);
  assert.equal((await item(created.id)).notes, '보존할 메모');
  const restored = await undo(changed.id);
  assert.ok(restored.undone_at);
  assert.equal((await item(created.id)).due_at, before.due_at);
  assert.equal((await item(created.id)).priority, 4);
  assert.deepEqual(await undo(changed.id), restored);
  assert.deepEqual(await apply(changed), restored);
  assert.equal((await item(created.id)).priority, 4);
});

test('two stale sessions cannot overwrite a task or undo later edits even if updated_at was not changed', async () => {
  const created = request(); await apply(created);
  const before = await item(created.id);
  const a = request({ operation: 'update', item: created.id, expected: before, values: { ...values, priority: 2 } });
  const b = request({ operation: 'update', item: created.id, expected: before, values: { ...values, priority: 5 } });
  await apply(a);
  await assert.rejects(apply(b), /다른 곳에서 변경/);
  await db.query('update public.assistant_items set notes=$1 where id=$2', ['다른 기기 메모', created.id]);
  await assert.rejects(undo(a.id), /이후에 변경/);
  assert.equal((await item(created.id)).priority, 2);
  assert.equal(await count('assistant_task_command_history'), 2);
});

test('undoing an untouched addition removes only that task and retains the undo receipt', async () => {
  const a = request(), b = request(); await apply(a); await apply(b);
  const result = await undo(a.id);
  assert.ok(result.undone_at);
  assert.equal(await item(a.id), undefined);
  assert.ok(await item(b.id));
  assert.equal(await count('assistant_task_command_history'), 2);
  assert.deepEqual(await apply(a), result);
  assert.equal(await count('assistant_items'), 1);
});

test('an existing next recurrence prevents deletion when undoing an addition', async () => {
  const p = request(); await apply(p);
  await db.query('insert into public.assistant_items(user_id,title,recurrence_parent_id) values($1,$2,$3)', [owner, '다음 일정', p.id]);
  await assert.rejects(undo(p.id), /다음 반복 일정/);
  assert.equal(await count('assistant_items'), 2);
});

test('other owners cannot read, update, undo or link another owner’s project', async () => {
  const project = randomUUID();
  await db.query('insert into public.assistant_projects(id,user_id,name) values($1,$2,$3)', [project, owner, '개인 프로젝트']);
  const p = request({ values: { ...values, project_id: project } }); await apply(p);
  const expected = await item(p.id);
  await db.exec(`set app.test_user='${other}';`);
  assert.equal(await count('assistant_task_command_history'), 0);
  assert.equal(await count('assistant_items'), 0);
  await assert.rejects(undo(p.id), /이력을 찾을 수/);
  await assert.rejects(apply(request({ operation: 'update', item: p.id, expected })), /다른 곳에서/);
  await assert.rejects(apply(request({ values: { ...values, project_id: project } })), /프로젝트를 찾지/);
  await assert.rejects(db.query('insert into public.assistant_task_command_history(user_id,id,operation,item_id,payload_hash,after_record) values($1,$2,\'create\',$3,\'x\',\'{}\')', [owner, randomUUID(), p.id]));
});

test('expired proposals, invalid fields and an unauthenticated role cannot create tasks', async () => {
  await assert.rejects(apply(request({ expires: new Date(Date.now() - 1000).toISOString() })), /확인 시간이/);
  for (const bad of [{ ...values, priority: 6 }, { ...values, title: '' }, { ...values, user_id: other }, { ...values, recurrence_rule: 'yearly' }]) await assert.rejects(apply(request({ values: bad })));
  await db.exec('reset role; set role anon;');
  await assert.rejects(apply(request()));
  await assert.rejects(db.query('select * from public.assistant_task_command_history'));
});

test('assistant reset clears snapshots and rejects pre-reset pending additions without touching another user', async () => {
  const p = request(); await apply(p);
  const pending = request();
  await db.exec(`set app.test_user='${other}';`); await apply(request());
  await db.exec(`set app.test_user='${owner}';`);
  await db.query("select public.reset_my_app_records('assistant',$1,'초기화')", [randomUUID()]);
  assert.equal(await count('assistant_task_command_history'), 0);
  assert.equal(await count('assistant_items'), 0);
  await assert.rejects(apply(pending), /초기화/);
  await db.exec(`set app.test_user='${other}';`);
  assert.equal(await count('assistant_task_command_history'), 1);
});

test('account deletion cascades command snapshots', async () => {
  await apply(request());
  await db.exec(`reset role; delete from auth.users where id='${owner}';`);
  assert.equal(await count('assistant_task_command_history'), 0);
});

test('Korean command dates preserve the reviewed date across month/year boundaries and reject invalid dates', () => {
  assert.equal(commandDueDate('내일 할 일 추가', '2026-12-31'), '2027-01-01');
  assert.equal(commandDueDate('모레 일정', '2026-01-30'), '2026-02-01');
  assert.equal(commandDueDate('2028년 2월 29일 일정', '2026-09-15'), '2028-02-29');
  assert.throws(() => commandDueDate('2월 30일 일정', '2026-09-15'), /존재하는 날짜/);
  assert.throws(() => commandDueDate('2026-13-01 일정', '2026-09-15'), /존재하는 날짜/);
  assert.match(taskCommandDateLabel('2026-09-20T14:59:00Z'), /23:59/);
});
