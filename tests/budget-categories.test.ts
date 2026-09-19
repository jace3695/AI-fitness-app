import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth;
    create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  await db.exec(readFileSync(new URL('./e2e/schema.sql', import.meta.url), 'utf8'));
  // Include nullable legacy columns that the hosted table retains.
  await db.exec('alter table public.budget_transactions alter column category drop not null; alter table public.budget_transactions add column merchant text,add column note text,add column is_fixed boolean;');
  await db.exec(readFileSync(new URL('../supabase/migrations/20260914113147_budget_category_history.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260914131417_budget_expense_fields.sql', import.meta.url), 'utf8'));
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`reset role; truncate public.budget_category_changes,public.budget_category_rules,public.budget_transactions,public.user_app_state cascade; set app.test_user='${owner}'; set role authenticated;`);
});
const rows = async () => (await db.query<{row: Record<string, unknown>}>('select to_jsonb(t) as row from public.budget_transactions t order by id')).rows.map(item => item.row);
async function seed() {
  await db.query("insert into public.budget_transactions(user_id,date,amount,place,category,payment,memo,note) values($1,'2026-09-14',1200,'합성 카페','기타','체크카드','원본 메모','legacy'),($1,'2026-09-13',3400,'  합성   카페  ',null,null,'다른 메모',null)", [owner]);
  return rows();
}
const change = (originals: Record<string, unknown>[], id = randomUUID(), remember = true, category = '카페') => db.query('select public.change_budget_categories($1,$2,$3,$4) as result', [id, JSON.stringify(originals.map(expected => ({ id: expected.id, expected }))), category, remember]);
const undo = (id: string) => db.query('select public.undo_budget_category_change($1)', [id]);
const count = async (table: string) => Number((await db.query<{ count: number }>(`select count(*) as count from public.${table}`)).rows[0].count);
const edit = (originals: Record<string, unknown>[], field: string, value: unknown, id = randomUUID()) => db.query('select public.change_budget_expense_fields($1,$2,$3,$4) as result', [id, JSON.stringify(originals.map(expected => ({ id: expected.id, expected }))), field, JSON.stringify(value)]);

for (const [field, value] of Object.entries({ amount: 9007199254740991, date: '2024-02-29', payment: '현금', place: '바뀐 합성 장소', memo: '' })) {
  test(`${field} batch changes only that field, records original scalar values and restores nullable legacy rows`, async () => {
    await seed();
    await db.exec('update public.budget_transactions set memo=null;');
    const original = await rows(), id = randomUUID();
    await edit(original, field, value, id); await edit(original, field, value, id);
    assert.deepEqual(await rows(), original.map(row => ({ ...row, [field]: value })));
    const history = (await db.query<{field_name:string;field_value:unknown;category:unknown}>('select field_name,field_value,category from public.budget_category_changes')).rows;
    assert.deepEqual(history, [{ field_name:field, field_value:value, category:null }]);
    const before = (await db.query<{before_value:unknown}>('select before_value from public.budget_category_change_items order by transaction_id')).rows.map(row => row.before_value);
    assert.deepEqual(before, original.map(row => row[field]));
    await assert.rejects(edit(original, field, 'different', id));
    await assert.rejects(change(original, id));
    await undo(id); await undo(id); await edit(original, field, value, id);
    assert.deepEqual(await rows(), original);
    assert.equal(await count('budget_category_rules'), 0);
  });
}

test('field batch and undo roll back every row when another field changes in either session', async () => {
  const original = await seed(), categoryId = randomUUID();
  await change(original, categoryId);
  const categorized = await rows(), editId = randomUUID();
  await edit(categorized, 'amount', 7700, editId);
  const edited = await rows();
  await assert.rejects(undo(categoryId), /이후에 바뀐/);
  assert.deepEqual(await rows(), edited);
  await undo(editId);
  assert.deepEqual(await rows(), categorized);
  await undo(categoryId);
  assert.deepEqual(await rows(), original);
  await db.query("update public.budget_transactions set note='newer' where id=$1", [original[1].id]);
  const newer = await rows();
  await assert.rejects(edit(original, 'memo', 'bulk overwrite'), /다른 곳에서 변경/);
  assert.deepEqual(await rows(), newer);
  assert.equal(await count('budget_category_changes'), 2);
});

test('field edits reject foreign owners, anonymous callers and deleted-row undo', async () => {
  const original = await seed(), id = randomUUID();
  await edit(original, 'payment', '현금', id);
  await db.exec(`set app.test_user='${other}';`);
  await assert.rejects(edit(original, 'memo', 'other')); await assert.rejects(undo(id));
  await db.exec('set role anon;'); await assert.rejects(edit(original, 'amount', 1));
  await db.exec(`set role authenticated; set app.test_user='${owner}';`);
  await db.query('delete from public.budget_transactions where id=$1', [original[1].id]);
  await assert.rejects(undo(id), /삭제된 기록/);
  assert.equal(await count('budget_category_change_items'), 1);
  await db.query("select public.reset_my_app_records('budget',$1,'초기화')", [randomUUID()]);
  assert.equal(await count('budget_category_changes'), 0);
  assert.equal(await count('budget_category_change_items'), 0);
});

test('malformed and oversized field requests never leave a transaction or history change', async () => {
  const original = await seed();
  const invalid: [string, unknown][] = [['user_id',other],['transaction_type','수입'],['amount','12'],['amount',0],['amount',-1],['amount',1.5],['amount',9007199254740992],['date','2026-02-29'],['date','0000-01-01'],['date','2026-1-01'],['place',' '],['place','a'.repeat(201)],['memo','a'.repeat(1001)],['memo',null],['memo',{}],['payment','unknown']];
  for (const [field, value] of invalid) await assert.rejects(edit(original, field, value));
  await assert.rejects(edit([], 'amount', 1));
  await assert.rejects(edit([original[0],original[0]], 'amount', 1));
  await assert.rejects(edit(Array.from({length:101},()=>original[0]), 'amount', 1));
  await assert.rejects(edit([{ ...original[0], extra:'x'.repeat(200001) }], 'amount', 1));
  await assert.rejects(db.query("select public.change_budget_expense_fields($1,$2,'amount','1')", [randomUUID(),JSON.stringify([{id:original[0].id}])]));
  assert.deepEqual(await rows(), original);
  assert.equal(await count('budget_category_changes'), 0);
});

test('category batch and memory commit together; repeat/undo preserve all original fields including nulls', async () => {
  const original = await seed(); const id = randomUUID();
  await change(original, id); await change(original, id);
  const changed = await rows();
  assert.deepEqual(changed, original.map(row => ({ ...row, category: '카페' })));
  assert.equal(await count('budget_category_changes'), 1);
  assert.equal(await count('budget_category_rules'), 1);
  await undo(id); await undo(id);
  assert.deepEqual(await rows(), original);
  assert.equal(await count('budget_category_rules'), 0);
  await change(original, id); // A retry of an already undone request cannot reapply it.
  assert.deepEqual(await rows(), original);
  await assert.rejects(change(original, id, true, '교통'));
});
test('stale second row rolls back the first category, memory and receipt', async () => {
  const original = await seed();
  await db.query("update public.budget_transactions set memo='다른 창에서 수정' where id=$1", [original[1].id]);
  const newer = await rows();
  await assert.rejects(change(original), /다른 곳에서 변경/);
  assert.deepEqual(await rows(), newer);
  assert.equal(await count('budget_category_rules'), 0);
  assert.equal(await count('budget_category_changes'), 0);
});
test('undo never overwrites a newer record or remembered category; failures roll back all rows', async () => {
  const original = await seed(); const id = randomUUID();
  await change(original, id);
  await db.query("update public.budget_transactions set amount=9999 where id=$1", [original[1].id]);
  const newer = await rows();
  await assert.rejects(undo(id), /이후에 바뀐/);
  assert.deepEqual(await rows(), newer);
  await db.query('update public.budget_transactions set amount=$2 where id=$1', [original[1].id, original[1].amount]);
  await db.query("update public.budget_category_rules set category='교통',revision=$1", [randomUUID()]);
  const before = await rows();
  await assert.rejects(undo(id), /기억한 분류가 이후/);
  assert.deepEqual(await rows(), before);
});
test('deleted rows cannot be resurrected by category undo; reset clears history and retains rules as settings', async () => {
  const original = await seed(); const id = randomUUID();
  await change(original, id);
  await db.query('delete from public.budget_transactions where id=$1', [original[1].id]);
  await assert.rejects(undo(id), /삭제된 기록/);
  assert.equal(await count('budget_transactions'), 1);
  await db.query("select public.reset_my_app_records('budget',$1,'초기화')", [randomUUID()]);
  assert.equal(await count('budget_transactions'), 0);
  assert.equal(await count('budget_category_changes'), 0);
  assert.equal(await count('budget_category_change_items'), 0);
  assert.equal(await count('budget_category_rules'), 1);
});
test('owner RLS, composite foreign keys and anonymous function grants reject cross-account actions', async () => {
  const original = await seed(); const id = randomUUID(); await change(original, id);
  await db.exec(`set app.test_user='${other}';`);
  for (const table of ['budget_transactions', 'budget_category_rules', 'budget_category_changes', 'budget_category_change_items']) assert.equal(await count(table), 0);
  await assert.rejects(change(original)); await assert.rejects(undo(id));
  await assert.rejects(db.query("insert into public.budget_category_rules values($1,'a','카페',$2)", [owner, randomUUID()]));
  await db.exec('set role anon;');
  await assert.rejects(change(original)); await assert.rejects(undo(id));
});
test('invalid category, duplicate rows, missing expected record and invalid memory key do not commit', async () => {
  const original = await seed();
  await assert.rejects(change(original, randomUUID(), false, 'unknown'));
  await assert.rejects(change([original[0], original[0]]));
  await assert.rejects(db.query("select public.change_budget_categories($1,$2,'카페',false)", [randomUUID(), JSON.stringify([{ id: original[0].id }])]));
  await db.query("update public.budget_transactions set place='' where id=$1", [original[1].id]);
  await assert.rejects(change(await rows()));
  assert.equal(await count('budget_category_changes'), 0);
});
