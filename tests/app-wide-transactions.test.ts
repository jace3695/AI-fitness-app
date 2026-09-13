import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const task = '00000000-0000-4000-8000-000000000003';
const routineA = '00000000-0000-4000-8000-000000000004';
const routineB = '00000000-0000-4000-8000-000000000005';
const review = '00000000-0000-4000-8000-000000000006';
const batch = '00000000-0000-4000-8000-000000000007';
const timestamp = '2026-09-08T00:00:00Z';

before(async () => {
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table public.budget_income(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,date date,amount integer,name text,memo text);
    create table public.budget_savings(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,date date,amount integer,goal_name text,memo text);
    create table public.budget_transactions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,date date,amount bigint,place text,category text,payment text,transaction_type text,memo text);
    create table public.assistant_items(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,project_id uuid,kind text default 'task',title text,status text default 'open',priority integer default 3,due_at timestamptz,recurrence_rule text default 'none',source text default 'manual',completed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
  `);
  const growth = readFileSync(new URL('../supabase/migrations/20260902120000_add_growth_platform.sql', import.meta.url), 'utf8');
  await db.exec(growth.split('alter table public.growth_routines enable row level security;')[0]);
  for (const table of ['budget_income','budget_savings','budget_transactions','assistant_items','growth_routines','growth_ai_reviews']) {
    await db.exec(`alter table public.${table} enable row level security;
      create policy owner on public.${table} to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
      grant select,insert,update,delete on public.${table} to authenticated;`);
  }
  await db.exec(readFileSync(new URL('../supabase/migrations/20260908233141_app_wide_reliability.sql', import.meta.url), 'utf8'));
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`reset role; truncate public.budget_income,public.budget_savings,public.budget_transactions,public.budget_save_batches,public.assistant_items,public.growth_routines,public.growth_ai_reviews cascade;
    set app.test_user='${owner}'; set role authenticated;`);
});

const expense = (place: string, amount = 1000) => ({ type:'expense',date:'2026-09-08',amount,place });
const saveBudget = (items: unknown[]) => db.query('select public.save_budget_batch($1,$2)', [batch, JSON.stringify(items)]);
const count = async (table: string) => Number((await db.query<{count:string}>(`select count(*) from public.${table}`)).rows[0].count);

test('budget: a later SQL failure rolls back earlier entries and the receipt', async () => {
  await assert.rejects(saveBudget([expense('first'),expense('invalid',-1)]));
  assert.equal(await count('budget_transactions'),0);
  assert.equal(await count('budget_save_batches'),0);
  await saveBudget([expense('first'),expense('second')]);
  assert.equal(await count('budget_transactions'),2);
});
test('budget: retry after a lost response saves a mixed batch exactly once', async () => {
  const items=[expense('expense'),{...expense('income'),type:'income'},{...expense('saving'),type:'saving'}];
  await saveBudget(items); await saveBudget(items); await saveBudget(items);
  assert.equal(await count('budget_transactions'),1);
  assert.equal(await count('budget_income'),1);
  assert.equal(await count('budget_savings'),1);
  await assert.rejects(saveBudget([expense('changed')]));
  assert.equal(await count('budget_transactions'),1);
});
test('budget: a receipt and its records cannot be read by a different owner', async () => {
  await saveBudget([expense('private')]);
  await db.exec(`set app.test_user='${other}';`);
  assert.equal(await count('budget_transactions'),0);
  assert.equal(await count('budget_save_batches'),0);
});

async function seedTask() {
  await db.query('insert into public.assistant_items(id,user_id,title,due_at,recurrence_rule,updated_at) values($1,$2,$3,$4,$5,$6)',[task,owner,'repeat','2026-01-31T00:30:00+09:00','monthly',timestamp]);
}
test('recurrence: failed next occurrence rolls back completion', async () => {
  await seedTask();
  await db.exec(`reset role; alter table public.assistant_items add constraint test_failure check(source <> 'recurrence'); set role authenticated;`);
  try {
    await assert.rejects(db.query('select public.set_assistant_item_completion($1,true,$2)',[task,timestamp]));
    assert.equal((await db.query<{status:string}>('select status from public.assistant_items where id=$1',[task])).rows[0].status,'open');
    assert.equal(await count('assistant_items'),1);
  } finally { await db.exec('reset role; alter table public.assistant_items drop constraint test_failure; set role authenticated;'); }
});
test('recurrence: retries and undo/recomplete create one next item, with Korean date and month end', async () => {
  await seedTask();
  await db.query('select public.set_assistant_item_completion($1,true,$2)',[task,timestamp]);
  await db.query('select public.set_assistant_item_completion($1,true,$2)',[task,timestamp]);
  let row=(await db.query<{updated_at:Date}>('select updated_at from public.assistant_items where id=$1',[task])).rows[0];
  await db.query('select public.set_assistant_item_completion($1,false,$2)',[task,row.updated_at]);
  row=(await db.query<{updated_at:Date}>('select updated_at from public.assistant_items where id=$1',[task])).rows[0];
  await db.query('select public.set_assistant_item_completion($1,true,$2)',[task,row.updated_at]);
  assert.equal(await count('assistant_items'),2);
  assert.equal((await db.query<{day:string}>("select to_char(due_at at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI') as day from public.assistant_items where recurrence_parent_id=$1",[task])).rows[0].day,'2026-02-28 23:59');
});
test('recurrence: another owner cannot complete or attach a child to this task', async () => {
  await seedTask(); await db.exec(`set app.test_user='${other}';`);
  await assert.rejects(db.query('select public.set_assistant_item_completion($1,true,$2)',[task,timestamp]));
  await assert.rejects(db.query('insert into public.assistant_items(user_id,title,recurrence_parent_id) values($1,$2,$3)',[other,'bad link',task]));
});

async function seedGrowth() {
  await db.query(`insert into public.growth_routines(id,user_id,category,title,target_minutes,updated_at) values($1,$3,'custom','A',10,$4),($2,$3,'custom','B',10,$4)`,[routineA,routineB,owner,timestamp]);
  const suggestions=[{id:'a',routineId:routineA,recommendedMinutes:20},{id:'b',routineId:routineB,recommendedMinutes:20}];
  await db.query("insert into public.growth_ai_reviews(id,user_id,period_start,period_end,source,suggestions) values($1,$2,'2026-09-01','2026-09-08','local',$3)",[review,owner,JSON.stringify(suggestions)]);
}
const decide = (expected: Record<string,string>, selection=['a','b']) => db.query('select public.decide_growth_review($1,$2,$3)',[review,JSON.stringify(selection),JSON.stringify(expected)]);
test('growth: a stale second routine rolls back the first change and decision', async () => {
  await seedGrowth();
  await assert.rejects(decide({[routineA]:timestamp,[routineB]:'2026-09-07T00:00:00Z'}));
  assert.deepEqual((await db.query<{target_minutes:number}>('select target_minutes from public.growth_routines order by id')).rows.map(r=>r.target_minutes),[10,10]);
  assert.equal((await db.query<{decision:string|null}>('select decision from public.growth_ai_reviews')).rows[0].decision,null);
});
test('growth: selected changes and decision commit together; retry and changed selection are safe', async () => {
  await seedGrowth();
  await decide({[routineA]:timestamp,[routineB]:timestamp});
  await decide({[routineA]:timestamp,[routineB]:timestamp});
  assert.deepEqual((await db.query<{target_minutes:number}>('select target_minutes from public.growth_routines order by id')).rows.map(r=>r.target_minutes),[20,20]);
  assert.equal((await db.query<{decision:string}>('select decision from public.growth_ai_reviews')).rows[0].decision,'applied');
  await assert.rejects(decide({},[]));
});
test('growth: keep changes no routine, and a different owner cannot decide', async () => {
  await seedGrowth(); await db.exec(`set app.test_user='${other}';`);
  await assert.rejects(decide({},[]));
  await db.exec(`set app.test_user='${owner}';`);
  await decide({},[]);
  assert.deepEqual((await db.query<{target_minutes:number}>('select target_minutes from public.growth_routines order by id')).rows.map(r=>r.target_minutes),[10,10]);
});
