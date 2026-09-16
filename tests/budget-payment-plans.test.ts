import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const value = { name: '합성 구독 1', amount: 10000, due_day: 31, start_month: '2026-01-01', is_subscription: true, last_used_on: null, enabled: true };
before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth;
    create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  await db.exec(readFileSync(new URL('./e2e/schema.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260914225836_budget_payment_plans.sql', import.meta.url), 'utf8'));
});
after(async () => { await db.close(); });
beforeEach(async () => { await db.exec(`reset role; truncate public.budget_payment_plans,public.budget_payment_plan_requests,public.budget_transactions; set app.test_user='${owner}'; set role authenticated;`); });
const read = async () => (await db.query<{row: Record<string, unknown>}>('select to_jsonb(p) as row from public.budget_payment_plans p order by id')).rows.map(row => row.row);
const save = (id: string, expected: unknown, next: unknown, request = randomUUID()) => db.query('select public.save_budget_payment_plan($1,$2,$3,$4,$5) as result', [owner,id,request,expected === null ? null : JSON.stringify(expected),next === null ? null : JSON.stringify(next)]);

test('plan create/update/delete retries preserve later changes and cannot resurrect deleted settings or change expenses', async () => {
  await db.query("insert into public.budget_transactions(user_id,date,amount,place,category) values($1,'2026-01-01',10000,'합성 구독 1','구독')",[owner]);
  const expenses = await db.query('select * from public.budget_transactions');
  const id = randomUUID(), create = randomUUID();
  await save(id,null,value,create); const original = (await read())[0];
  await save(id,null,value,create); assert.deepEqual(await read(),[original]);
  await assert.rejects(save(id,null,{...value,amount:20000},create),/같은 요청/);
  await save(id,original,{...value,amount:20000}); const changed = (await read())[0];
  await save(id,null,value,create); assert.deepEqual(await read(),[changed]);
  await assert.rejects(save(id,original,{...value,due_day:1}),/다른 곳에서/);
  await assert.rejects(save(id,original,null),/다른 곳에서/);
  const deletion=randomUUID(); await save(id,changed,null,deletion); await save(id,changed,null,deletion);
  await save(id,null,value,create); assert.deepEqual(await read(),[]);
  await assert.rejects(save(id,changed,{...value,amount:30000}),/다른 곳에서/);
  assert.deepEqual(await db.query('select * from public.budget_transactions'),expenses);
});
test('exact merchant identity prevents duplicate plans but keeps different branches; owner RLS and invoker grants protect both tables', async () => {
  const id=randomUUID(); await save(id,null,value); const original=(await read())[0];
  await assert.rejects(save(randomUUID(),null,{...value,name:'  합성   구독 1  '}),/unique/);
  await save(randomUUID(),null,{...value,name:'합성 구독 2'});
  await db.exec(`set app.test_user='${other}';`); assert.deepEqual(await read(),[]);
  assert.equal((await db.query('select * from public.budget_payment_plan_requests')).rows.length,0);
  await assert.rejects(save(id,original,null),/계정/);
  await assert.rejects(db.query('insert into public.budget_payment_plan_requests values($1,$2,$3,$4)',[owner,randomUUID(),'hash','{}']));
  await db.exec('set role anon;'); await assert.rejects(save(randomUUID(),null,value)); await assert.rejects(read());
  const security=(await db.query<{prosecdef:boolean}>('select prosecdef from pg_proc where proname=$1',['save_budget_payment_plan'])).rows;
  assert.deepEqual(security,[{prosecdef:false}]);
});
test('invalid plans roll back both setting and receipt; real dates, whole amounts and bounded inputs are enforced', async () => {
  for (const patch of [{amount:0},{amount:1.5},{amount:9007199254740992},{amount:'10'},{due_day:0},{due_day:32},{due_day:1.1},{name:' '},{name:'a'.repeat(201)},{start_month:'2026-02-02'},{start_month:'0000-01-01'},{last_used_on:'2026-02-30'},{last_used_on:'9999-01-01'},{is_subscription:false,last_used_on:'2026-01-01'},{unknown:true},{enabled:'false'}]) {
    await assert.rejects(save(randomUUID(),null,{...value,...patch}));
  }
  await assert.rejects(save(randomUUID(),null,null));
  await assert.rejects(save(randomUUID(),null,{}));
  assert.deepEqual(await read(),[]);
  assert.equal((await db.query('select * from public.budget_payment_plan_requests')).rows.length,0);
  await save(randomUUID(),null,{...value,amount:9007199254740991,last_used_on:'2024-02-29'});
});
test('per-owner limit is checked atomically; deleting a plan makes room without erasing receipt recovery', async () => {
  for(let i=0;i<100;i++) await save(randomUUID(),null,{...value,name:`합성 ${i}`});
  await assert.rejects(save(randomUUID(),null,{...value,name:'limit'}),/최대 100/);
  const first=(await read())[0]; await save(String(first.id),first,null);
  await save(randomUUID(),null,{...value,name:'limit'}); assert.equal((await read()).length,100);
});
